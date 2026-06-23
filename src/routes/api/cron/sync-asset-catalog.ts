// src/routes/api/cron/sync-asset-catalog.ts
//
// Cron semanal que sincroniza o catálogo de ativos a partir de:
//   - Brapi      → B3 (ações + FIIs)
//   - Twelve Data → NYSE / NASDAQ / XETRA (ETFs europeus)
//   - CoinGecko   → Top 100 criptomoedas (sem chave de API)
//
// Rota: GET /api/cron/sync-asset-catalog
// Cron: toda segunda-feira às 06:00 UTC (vercel.json)

// ── Tipos ────────────────────────────────────────────────────────────────────

type AssetRow = {
  symbol: string;
  name: string;
  asset_class: string;
  currency: string;
  country: string;
  status: "approved";
  data_source: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

// ── Brapi — B3 completa ───────────────────────────────────────────────────────

async function fetchBrapiAssets(): Promise<AssetRow[]> {
  const token = process.env.BRAPI_TOKEN;
  if (!token) {
    console.warn("[sync-catalog] BRAPI_TOKEN não configurado — pulando B3");
    return [];
  }

  try {
    const url = `https://brapi.dev/api/available?token=${token}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Brapi HTTP ${res.status}`);

    const json = (await res.json()) as { stocks?: string[] };
    const tickers = json.stocks ?? [];

    return tickers.map((ticker: string) => {
      const sym = normalizeSymbol(ticker);
      // FIIs terminam em 11 (mas não todos — ex: BRBI11 é stock)
      // Heurística: sufixo 11 com >5 chars = reit; <5 chars = stock
      const isLikelyFii = sym.endsWith("11") && sym.length >= 6;
      return {
        symbol: sym,
        name: sym, // Brapi /available não retorna nome — será atualizado na próxima sync
        asset_class: isLikelyFii ? "reit" : "stock",
        currency: "BRL",
        country: "BR",
        status: "approved",
        data_source: "brapi",
      };
    });
  } catch (err: any) {
    console.error("[sync-catalog] Brapi erro:", err.message);
    return [];
  }
}

// ── Twelve Data — NYSE, NASDAQ, XETRA ─────────────────────────────────────────

async function fetchTwelveDataAssets(
  exchange: string,
  assetClass: string,
  currency: string,
  country: string,
): Promise<AssetRow[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.warn("[sync-catalog] TWELVE_DATA_API_KEY não configurado — pulando", exchange);
    return [];
  }

  try {
    const url = `https://api.twelvedata.com/stocks?exchange=${exchange}&apikey=${apiKey}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const json = (await res.json()) as {
      data?: Array<{ symbol: string; name: string }>;
      message?: string;
    };

    if (json.message) throw new Error(json.message);

    return (json.data ?? []).map((item) => ({
      symbol: normalizeSymbol(item.symbol),
      name: item.name ?? normalizeSymbol(item.symbol),
      asset_class: assetClass,
      currency,
      country,
      status: "approved",
      data_source: "twelve_data",
    }));
  } catch (err: any) {
    console.error(`[sync-catalog] Twelve Data (${exchange}) erro:`, err.message);
    return [];
  }
}

// ── CoinGecko — Top 100 cripto (sem chave) ────────────────────────────────────

async function fetchCoinGeckoAssets(): Promise<AssetRow[]> {
  try {
    const url =
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=100&page=1";
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const json = (await res.json()) as Array<{
      symbol: string;
      name: string;
    }>;

    const assets: AssetRow[] = [];
    for (const coin of json) {
      const sym = normalizeSymbol(coin.symbol);
      // EUR
      assets.push({
        symbol: sym,
        name: coin.name,
        asset_class: "crypto",
        currency: "EUR",
        country: "GLOBAL",
        status: "approved",
        data_source: "coingecko",
      });
      // USD (mesmo ativo, moeda diferente)
      assets.push({
        symbol: sym,
        name: coin.name,
        asset_class: "crypto",
        currency: "USD",
        country: "GLOBAL",
        status: "approved",
        data_source: "coingecko",
      });
    }
    return assets;
  } catch (err: any) {
    console.error("[sync-catalog] CoinGecko erro:", err.message);
    return [];
  }
}

// ── Upsert no Supabase ────────────────────────────────────────────────────────

async function upsertAssets(
  supabaseAdmin: any,
  assets: AssetRow[],
): Promise<number> {
  if (!assets.length) return 0;

  // Remove duplicatas por (symbol, currency)
  const seen = new Set<string>();
  const unique = assets.filter((a) => {
    const key = `${a.symbol}:${a.currency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Valida enums do banco
  const validClasses = new Set([
    "stock", "reit", "etf", "crypto", "fixed_income",
    "fund", "cash", "other", "stock_intl", "reit_intl", "etf_intl",
  ]);
  const validCurrencies = new Set(["BRL", "USD", "EUR", "GBP", "JPY"]);

  const filtered = unique.filter(
    (a) =>
      validClasses.has(a.asset_class) &&
      validCurrencies.has(a.currency) &&
      a.symbol.length >= 1 &&
      a.symbol.length <= 20,
  );

  // Insere em lotes de 200 para não estourar limites
  const BATCH = 200;
  let inserted = 0;

  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    const { error } = await supabaseAdmin
      .from("assets")
      .upsert(batch, {
        onConflict: "symbol,currency",
        ignoreDuplicates: true, // não sobrescreve dados existentes
      });

    if (error) {
      console.error(`[sync-catalog] Upsert batch ${i}-${i + BATCH} erro:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  return inserted;
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  // Valida secret do cron
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const startedAt = Date.now();
  console.log("[sync-catalog] Iniciando sincronização do catálogo...");

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Busca em paralelo — se uma falhar não bloqueia as outras
    const [brapiAssets, nyseAssets, nasdaqAssets, xetraAssets, cryptoAssets] =
      await Promise.all([
        fetchBrapiAssets(),
        fetchTwelveDataAssets("NYSE", "stock_intl", "USD", "US"),
        fetchTwelveDataAssets("NASDAQ", "stock_intl", "USD", "US"),
        fetchTwelveDataAssets("XETRA", "etf_intl", "EUR", "DE"),
        fetchCoinGeckoAssets(),
      ]);

    const allAssets = [
      ...brapiAssets,
      ...nyseAssets,
      ...nasdaqAssets,
      ...xetraAssets,
      ...cryptoAssets,
    ];

    console.log(`[sync-catalog] Ativos coletados:
      B3 (Brapi):        ${brapiAssets.length}
      NYSE (TwelveData): ${nyseAssets.length}
      NASDAQ (TwelveData):${nasdaqAssets.length}
      XETRA (TwelveData): ${xetraAssets.length}
      Cripto (CoinGecko): ${cryptoAssets.length}
      Total:             ${allAssets.length}`);

    const inserted = await upsertAssets(supabaseAdmin, allAssets);
    const elapsed = Date.now() - startedAt;

    console.log(`[sync-catalog] Concluído em ${elapsed}ms — ${inserted} ativos processados`);

    return Response.json({
      ok: true,
      sources: {
        brapi: brapiAssets.length,
        nyse: nyseAssets.length,
        nasdaq: nasdaqAssets.length,
        xetra: xetraAssets.length,
        crypto: cryptoAssets.length,
      },
      total: allAssets.length,
      processed: inserted,
      elapsed_ms: elapsed,
    });
  } catch (err: any) {
    console.error("[sync-catalog] Erro crítico:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
