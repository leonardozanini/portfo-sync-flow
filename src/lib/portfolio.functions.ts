import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Types ----------
export type AssetClass =
  | "stock" | "reit" | "etf"
  | "stock_intl" | "reit_intl" | "etf_intl"
  | "crypto" | "fixed_income" | "fund" | "cash" | "other";
export type TxType = "buy" | "sell" | "dividend" | "deposit" | "withdraw";
export type CurrencyCode = "BRL" | "USD" | "EUR" | "GBP" | "JPY";
export type MarketCode = "B3" | "NYSE" | "NASDAQ" | "LSE" | "XETRA" | "TSE" | "CRYPTO" | "OTHER";

// Horários de pregão (UTC, aproximados, sem ajuste DST). Seg-Sex.
// Crypto: 24/7. OTHER: sempre considerado fechado para refresh automático.
const MARKET_HOURS_UTC: Record<MarketCode, { open: number; close: number } | "always" | "never"> = {
  B3:       { open: 13 * 60,        close: 20 * 60 + 30 }, // 10:00-17:30 BRT
  NYSE:     { open: 14 * 60 + 30,   close: 21 * 60 },      // 09:30-16:00 EST
  NASDAQ:   { open: 14 * 60 + 30,   close: 21 * 60 },
  LSE:      { open: 8 * 60,         close: 16 * 60 + 30 }, // 08:00-16:30 GMT
  XETRA:    { open: 8 * 60,         close: 16 * 60 + 30 }, // 08:00-16:30 CET
  TSE:      { open: 0,              close: 6 * 60 },       // 09:00-15:00 JST
  CRYPTO:   "always",
  TREASURY: "always", // Tesouro Direto: PU atualizado diariamente, buscamos sempre
  OTHER:    "never",
};

export const MARKET_LABEL: Record<MarketCode, string> = {
  B3: "B3 (Brasil)", NYSE: "NYSE", NASDAQ: "NASDAQ",
  LSE: "LSE (Londres)", TSE: "TSE (Tóquio)", XETRA: "XETRA (Frankfurt)",
  CRYPTO: "Cripto (24/7)", TREASURY: "Tesouro Direto", OTHER: "Outro",
};

export function isMarketOpen(market: MarketCode, when: Date = new Date()): boolean {
  const cfg = MARKET_HOURS_UTC[market];
  if (cfg === "always") return true;
  if (cfg === "never") return false;
  const day = when.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const minutes = when.getUTCHours() * 60 + when.getUTCMinutes();
  return minutes >= cfg.open && minutes <= cfg.close;
}

export function defaultMarketFor(currency: CurrencyCode, klass: AssetClass): MarketCode {
  if (klass === "crypto") return "CRYPTO";
  if (klass === "fixed_income") return "TREASURY";
  if (currency === "BRL") return "B3";
  if (currency === "USD") return "NYSE";
  if (currency === "EUR") return "XETRA";
  if (currency === "GBP") return "LSE";
  if (currency === "JPY") return "TSE";
  return "OTHER";
}

export type GroupedAsset = {
  assetId: string;
  symbol: string;
  name: string | null;
  assetClass: AssetClass;
  currency: CurrencyCode;
  country: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  balanceBRL: number;
  investedBRL: number;
  variation: number;
  yieldPct: number;
  dy: number;   // Dividend Yield — proventos (12m, anualizado se histórico < 11 meses) / preço atual, em %
  yoc: number;  // Yield on Cost — mesma base do DY, sobre o preço médio de compra, em %
  dyEstimated: boolean; // true = DY/YoC foram anualizados por falta de 12m de histórico completo
  bookValue: number | null;    // VPA — Valor Patrimonial por Ação/Cota (Brapi, só B3)
  priceToBook: number | null;  // P/VP (Brapi, só B3)
  cmcId: number | null;    // ID da CoinMarketCap (cripto) — usado pro logo
  logoUrl: string | null;  // Logo customizado (prioridade máxima no AssetLogo)
};

export type AssetGroup = {
  assetClass: AssetClass;
  label: string;
  assets: GroupedAsset[];
  totalValueBRL: number;
  totalInvestedBRL: number;
  variation: number;
  yieldPct: number;
  pctWallet: number;
};

export type DividendRow = {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  asset_class?: string;
  ex_date: string;
  payment_date?: string | null;
  amount: number;
  currency: string;
  dividend_type: string;
  amount_per_share?: number | null;
  quantity_held?: number | null;
  ir_withheld?: number | null;
  gross_amount?: number | null;
  notes?: string | null;
  created_at?: string;
};

export type DashboardData = {
  totalsBRL: {
    patrimonio: number;
    invested: number;
    pnl: number;
    yieldPct: number;
    dayVariation: number;     // placeholder until daily snapshots
    dividends12m: number;
  };
  allocation: { name: string; assetClass: AssetClass; valueBRL: number; pct: number }[];
  brokerAllocation: { id: string | null; name: string; color: string; valueBRL: number; pct: number }[];
  equity: { date: string; aplicado: number; ganho: number }[];
  groups: AssetGroup[];
};

const CLASS_LABEL: Record<AssetClass, string> = {
  stock: "Ações",
  reit: "FIIs",
  etf: "ETFs",
  stock_intl: "Stocks",
  reit_intl: "REITs",
  etf_intl: "ETFs Internacionais",
  crypto: "Criptomoedas",
  fixed_income: "Renda Fixa",
  fund: "Fundos",
  cash: "Caixa",
  other: "Outros",
};

// ---------- Price fetching via Twelve Data (stocks/ETFs) + Yahoo (crypto) ----------

function priceSymbolFor(symbol: string, klass: AssetClass, currency: CurrencyCode, quoteUrl?: string | null): { stooq: string; yahoo: string; twelve: string } {
  const s = symbol.toUpperCase();
  const yahooTicker = (() => {
    if (quoteUrl) {
      const m = quoteUrl.match(/\/quote\/([^/?#]+)/i);
      if (m) return m[1].toUpperCase();
    }
    return s;
  })();

  const stooqSymbol = (() => {
    if (klass === "crypto") return `${s}-${currency}.FX`.toLowerCase();
    if (yahooTicker.includes(".")) return yahooTicker.toLowerCase();
    if (currency === "USD") return `${s}.US`.toLowerCase();
    if (currency === "BRL") return `${s}.SA`.toLowerCase();
    if (currency === "EUR") return `${s}.DE`.toLowerCase();
    if (currency === "GBP") return `${s}.UK`.toLowerCase();
    return yahooTicker.toLowerCase();
  })();

  // Twelve Data uses plain ticker for US stocks, ticker:exchange for others
  const twelveSymbol = (() => {
    if (klass === "crypto") return `${s}/USD`; // crypto via Yahoo instead
    if (yahooTicker.includes(".DE") || currency === "EUR") return `${s}:XETR`; // Twelve Data uses XETR not XETRA
    if (currency === "BRL") return `${s}:BOVESPA`;
    return s; // US stocks: plain symbol
  })();

  return { stooq: stooqSymbol, yahoo: `${s}-${currency}`, twelve: twelveSymbol };
}

async function fetchTwelveDataPrice(symbol: string): Promise<number | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const json = await res.json() as { price?: string; code?: number; message?: string };
    if (json.code || json.message) return null; // error response
    const p = parseFloat(json.price ?? "");
    return Number.isFinite(p) && p > 0 && p < 10_000_000 ? p : null;
  } catch { return null; }
}

async function fetchBrapiPrice(symbol: string): Promise<number | null> {
  const token = process.env.BRAPI_TOKEN;
  if (!token) return null;
  try {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(symbol)}?token=${token}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const json = await res.json() as { results?: Array<{ regularMarketPrice?: number }> };
    const p = json?.results?.[0]?.regularMarketPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch { return null; }
}

// Mapa de nomes de ativos de renda fixa → nome oficial no Tesouro Direto (Brapi)
const TREASURY_SLUG_MAP: Record<string, string> = {
  // Renda+ — vencimento 15/12/AAAA, slug: tesouro-renda-aposentadoria-extra-<DDMMAAAA>
  "RENDA+ 2065": "tesouro-renda-aposentadoria-extra-15122084",
  "RENDA+ APOSENTADORIA EXTRA 2065": "tesouro-renda-aposentadoria-extra-15122084",
  "RENDA+ 2060": "tesouro-renda-aposentadoria-extra-15122079",
  "RENDA+ APOSENTADORIA EXTRA 2060": "tesouro-renda-aposentadoria-extra-15122079",
  "RENDA+ 2055": "tesouro-renda-aposentadoria-extra-15122074",
  "RENDA+ APOSENTADORIA EXTRA 2055": "tesouro-renda-aposentadoria-extra-15122074",
  "RENDA+ 2050": "tesouro-renda-aposentadoria-extra-15122069",
  "RENDA+ 2045": "tesouro-renda-aposentadoria-extra-15122064",
  "RENDA+ 2040": "tesouro-renda-aposentadoria-extra-15122059",
  "RENDA+ 2035": "tesouro-renda-aposentadoria-extra-15122054",
  "RENDA+ 2030": "tesouro-renda-aposentadoria-extra-15122049",
  // Educa+
  "EDUCA+ 2036": "tesouro-educa-15122036",
  "EDUCA+ 2033": "tesouro-educa-15122033",
  "EDUCA+ 2031": "tesouro-educa-15122031",
  "EDUCA+ 2030": "tesouro-educa-15122030",
  // IPCA+
  "TESOURO IPCA+ 2055": "tesouro-ipca-15052055",
  "TESOURO IPCA+ 2045": "tesouro-ipca-15052045",
  "TESOURO IPCA+ 2040": "tesouro-ipca-15082040",
  "TESOURO IPCA+ 2035": "tesouro-ipca-15052035",
  "TESOURO IPCA+ 2032": "tesouro-ipca-15082032",
  "TESOURO IPCA+ 2029": "tesouro-ipca-15052029",
  // Prefixado
  "TESOURO PREFIXADO 2031": "tesouro-prefixado-01012031",
  "TESOURO PREFIXADO 2029": "tesouro-prefixado-01012029",
  "TESOURO PREFIXADO 2027": "tesouro-prefixado-01012027",
  // Selic
  "TESOURO SELIC 2029": "tesouro-selic-01032029",
  "TESOURO SELIC 2027": "tesouro-selic-01032027",
};

function resolveTreasurySlug(symbol: string): string | null {
  const upper = symbol.toUpperCase().trim();
  if (TREASURY_SLUG_MAP[upper]) return TREASURY_SLUG_MAP[upper];
  for (const [key, slug] of Object.entries(TREASURY_SLUG_MAP)) {
    if (upper.includes(key) || key.includes(upper)) return slug;
  }
  return null;
}

// Busca PU do Tesouro Direto via Edge Function sync-treasury-prices
// A Edge Function baixa o CSV oficial do Tesouro Transparente e retorna o PU mais recente
async function fetchTreasuryPrice(symbol: string): Promise<number | null> {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
    if (!supabaseUrl) return null;

    // Chama a Edge Function que já fez o upsert — busca o preço salvo
    // A Edge Function sync-treasury-prices roda via cron às 21h
    // Para busca individual, consultamos diretamente o asset_prices
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Busca o ativo pelo símbolo
    const { data: asset } = await supabaseAdmin
      .from("assets")
      .select("id")
      .eq("symbol", symbol)
      .eq("asset_class", "fixed_income")
      .single();

    if (!asset?.id) return null;

    // Busca o PU mais recente
    const { data: price } = await supabaseAdmin
      .from("asset_prices")
      .select("close_price")
      .eq("asset_id", asset.id)
      .order("price_date", { ascending: false })
      .limit(1)
      .single();

    return price?.close_price ? Number(price.close_price) : null;
  } catch (err: any) {
    console.error(`[treasury] Erro: ${err.message}`);
    return null;
  }
}

// Mantém o alias para compatibilidade com o código existente
const fetchBrapiTreasuryPrice = fetchTreasuryPrice;

async function fetchStooqPrice(stooqSymbol: string): Promise<number | null> {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Folio/1.0)" },
    });
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[1].split(",");
    const close = parseFloat(cols[6]);
    if (Number.isFinite(close) && close > 0 && close < 10_000_000) return close;
    return null;
  } catch { return null; }
}

async function fetchYahooCryptoPrice(ySymbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const p = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch { return null; }
}

async function fetchYahooPrice(ySymbol: string): Promise<number | null> {
  return fetchYahooCryptoPrice(ySymbol);
}

async function fetchPriceFromUrl(_url: string): Promise<number | null> {
  return null; // disabled — scraping unreliable
}

async function fetchPriceFor(
  a: { symbol: string; asset_class: string; currency: string; quote_url?: string | null },
  _neverFetched: boolean,
): Promise<{ price: number | null; source: string }> {
  const klass = a.asset_class as AssetClass;
  const currency = a.currency as CurrencyCode;
  const { stooq, yahoo, twelve } = priceSymbolFor(a.symbol, klass, currency, a.quote_url);

  // Renda fixa (Tesouro Direto, etc): Brapi Treasury API → PU atual de mercado
  if (klass === "fixed_income") {
    const p = await fetchBrapiTreasuryPrice(a.symbol);
    if (p != null) return { price: p, source: "brapi_treasury" };
    // Fallback: CDB/LCI/LCA sem cotação de mercado — mantém o último valor registrado
    return { price: null, source: "none" };
  }

  // Crypto: Yahoo works reliably for pairs like BTC-EUR
  if (klass === "crypto") {
    const p = await fetchYahooCryptoPrice(yahoo);
    if (p != null) return { price: p, source: "yahoo" };
    const p2 = await fetchStooqPrice(stooq);
    if (p2 != null) return { price: p2, source: "stooq" };
    return { price: null, source: "none" };
  }

  // BRL assets (FIIs, Brazilian stocks): Brapi first, then Stooq
  if (currency === "BRL") {
    const p = await fetchBrapiPrice(a.symbol);
    if (p != null) return { price: p, source: "brapi" };
    const p2 = await fetchStooqPrice(stooq);
    if (p2 != null) return { price: p2, source: "stooq" };
    return { price: null, source: "none" };
  }

  // International stocks/ETFs: Twelve Data first, then Stooq, then Yahoo (for EUR ETFs like VUAA.DE)
  const p = await fetchTwelveDataPrice(twelve);
  if (p != null) return { price: p, source: "twelve" };
  const p2 = await fetchStooqPrice(stooq);
  if (p2 != null) return { price: p2, source: "stooq" };
  // Fallback para ETFs europeus: Yahoo Finance com sufixo .DE
  if (currency === "EUR") {
    const ySymbol = yahoo.includes(".DE") ? yahoo : `${a.symbol}.DE`;
    const p3 = await fetchYahooPrice(ySymbol);
    if (p3 != null) return { price: p3, source: "yahoo" };
  }

  return { price: null, source: "none" };
}

// ---------- getDashboard ----------
export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { supabase, userId } = context;

    const since12m = new Date();
    since12m.setMonth(since12m.getMonth() - 12);
    const since12mStr = since12m.toISOString().slice(0, 10);

    const [txRes, assetsRes, pricesRes, fxRes, rolesRes, brokersRes, snapshotsRes, dividendsRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", userId).order("occurred_at", { ascending: true }),
      supabase.from("assets").select("*"),
      supabase.from("asset_prices").select("asset_id, close_price, price_date, fetched_at").order("fetched_at", { ascending: false }),
      supabase.from("fx_rates").select("base, quote, rate, rate_date").order("rate_date", { ascending: false }),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      (supabase as any).from("brokers").select("id, name, color").eq("user_id", userId),
      supabase.from("portfolio_snapshots").select("snapshot_date, total_value, total_invested, pnl").eq("user_id", userId).order("snapshot_date", { ascending: true }),
      (supabase as any).from("dividends").select("asset_id, amount, amount_per_share, quantity_held, currency, payment_date, ex_date").eq("user_id", userId).gte("payment_date", since12mStr),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);

    const txs = txRes.data ?? [];
    const dividendRows = (dividendsRes.data ?? []) as Array<{ asset_id: string; amount: number; amount_per_share: number | null; quantity_held: number | null; currency: string; payment_date: string | null; ex_date: string }>;

    // Soma de proventos POR COTA/AÇÃO dos últimos 12 meses, por ativo.
    // IMPORTANTE: usa amount_per_share (valor por cota), NÃO amount (valor total recebido).
    // Bug anterior somava "amount" — como a quantidade possuída cresce com o tempo
    // (compras adicionais), o total recebido cresce proporcionalmente à posição, e
    // dividir isso pelo preço atual (que é "por cota") inflava o DY/YoC absurdamente
    // para quem fez múltiplas compras ao longo do período. amount_per_share já vem
    // normalizado por cota desde a origem (nota manual, PDF ou IA), então é isso que
    // deve ser comparado com o preço — não o total em R$/US$ recebido.
    const dividendsByAsset = new Map<string, number>();
    // Data do pagamento mais ANTIGO dentro da janela de 12m, por ativo — usada pra
    // saber se já temos histórico de um ano completo, ou se é uma posição/ativo mais
    // novo no Folio (compra recente, ou histórico ainda não todo importado).
    const earliestPaymentByAsset = new Map<string, string>();
    for (const d of dividendRows) {
      if (!d.asset_id) continue;
      // Fallback: se amount_per_share não veio preenchido (dado legado), estima
      // dividindo o total pela quantidade possuída naquele pagamento.
      const perShare = d.amount_per_share != null && d.amount_per_share > 0
        ? Number(d.amount_per_share)
        : (d.quantity_held && d.quantity_held > 0 ? Number(d.amount) / Number(d.quantity_held) : 0);
      dividendsByAsset.set(d.asset_id, (dividendsByAsset.get(d.asset_id) ?? 0) + perShare);

      if (d.payment_date) {
        const prevEarliest = earliestPaymentByAsset.get(d.asset_id);
        if (!prevEarliest || d.payment_date < prevEarliest) {
          earliestPaymentByAsset.set(d.asset_id, d.payment_date);
        }
      }
    }

    // Quando o histórico disponível é MENOR que ~11 meses (compra recente, ou
    // histórico ainda não todo importado), o DY/YoC "cru" dos últimos 12m SUBESTIMA
    // muito o rendimento real (ex: 5 meses de proventos ÷ preço, tratado como se
    // fosse 1 ano inteiro). Anualiza proporcionalmente (regra de 3 sobre os dias
    // cobertos) quando há dados suficientes (≥ 45 dias) pra uma extrapolação
    // minimamente confiável; caso contrário, mantém o valor bruto disponível.
    const todayStr = new Date().toISOString().slice(0, 10);
    const dividendsAnnualized = new Map<string, { perShare: number; isEstimated: boolean }>();
    for (const [assetId, perShareSum] of dividendsByAsset) {
      const earliest = earliestPaymentByAsset.get(assetId);
      if (!earliest) { dividendsAnnualized.set(assetId, { perShare: perShareSum, isEstimated: false }); continue; }

      const daysCovered = Math.max(1, Math.round(
        (new Date(todayStr).getTime() - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24)
      ));

      if (daysCovered < 330 && daysCovered >= 45) {
        const annualized = perShareSum * (365 / daysCovered);
        dividendsAnnualized.set(assetId, { perShare: annualized, isEstimated: true });
      } else {
        dividendsAnnualized.set(assetId, { perShare: perShareSum, isEstimated: daysCovered < 330 });
      }
    }
    const assets = assetsRes.data ?? [];
    const prices = pricesRes.data ?? [];
    const fxRows = fxRes.data ?? [];
    const isAdmin = (rolesRes.data ?? []).some((r) => r.role === "admin");
    const brokerMap = new Map<string, { id: string; name: string; color: string }>(
      ((brokersRes.data ?? []) as any[]).map((b: any) => [b.id, b])
    );

    const assetById = new Map(assets.map((a) => [a.id, a]));

    // Última cotação + frescor por ativo
    const latestPrice = new Map<string, number>();
    const latestFetchedAt = new Map<string, number>();
    for (const p of prices) {
      if (!latestPrice.has(p.asset_id)) {
        latestPrice.set(p.asset_id, Number(p.close_price));
        const ts = p.fetched_at ? new Date(p.fetched_at as unknown as string).getTime() : 0;
        latestFetchedAt.set(p.asset_id, ts);
      }
    }

    // Refresh com TTL: admin 15min, usuário padrão 60min. Só para ativos da carteira.
    const ttlMs = (isAdmin ? 15 : 60) * 60 * 1000;
    const nowMs = Date.now();
    const heldAssetIds = new Set(txs.map((t) => t.asset_id));
    const toRefresh = assets.filter((a) =>
      heldAssetIds.has(a.id) && (nowMs - (latestFetchedAt.get(a.id) ?? 0) > ttlMs),
    );
    if (toRefresh.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const today = new Date().toISOString().slice(0, 10);
      await Promise.all(toRefresh.map(async (a) => {
        const neverFetched = !latestFetchedAt.get(a.id);
        const { price, source } = await fetchPriceFor(
          { symbol: a.symbol, asset_class: a.asset_class, currency: a.currency, quote_url: (a as { quote_url?: string | null }).quote_url },
          neverFetched,
        );
        if (price == null) {
          await supabaseAdmin.from("price_fetch_failures").insert({
            asset_id: a.id, symbol: a.symbol, reason: `refresh:${source}:no-data`,
          });
          return;
        }
        await supabaseAdmin.from("asset_prices").insert({
          asset_id: a.id, price_date: today, source, close_price: price,
        });
        latestPrice.set(a.id, price);
        latestFetchedAt.set(a.id, nowMs);
      }));
    }

    // FX: latest rate per (base,quote). Convert from any currency -> BRL.
    const fxKey = (b: string, q: string) => `${b}->${q}`;
    const fxLatest = new Map<string, number>();
    for (const f of fxRows) {
      const k = fxKey(f.base, f.quote);
      if (!fxLatest.has(k)) fxLatest.set(k, Number(f.rate));
    }
    // Fallback FX (BRL units per 1 unit of foreign currency).
    // Used when fx_rates table has no entry yet (MVP / pre-Forex sync).
    const FALLBACK_TO_BRL: Record<CurrencyCode, number> = {
      BRL: 1,
      USD: 5.25,
      EUR: 5.85,
      GBP: 6.70,
      JPY: 0.035,
    };
    const toBRL = (amount: number, cur: CurrencyCode): number => {
      if (cur === "BRL") return amount;
      const direct = fxLatest.get(fxKey(cur, "BRL"));
      if (direct) return amount * direct;
      const inverse = fxLatest.get(fxKey("BRL", cur));
      if (inverse && inverse !== 0) return amount / inverse;
      return amount * (FALLBACK_TO_BRL[cur] ?? 1);
    };

    // Aggregate per asset
    type Agg = { qty: number; invested: number; lastPrice: number; currency: CurrencyCode };
    const perAsset = new Map<string, Agg>();

    // Proventos dos últimos 12 meses — soma da tabela dividends (já filtrada por payment_date na query)
    const totalDividends12mBRL = dividendRows.reduce((sum, d) => {
      return sum + toBRL(Number(d.amount), d.currency as CurrencyCode);
    }, 0);

    for (const t of txs) {
      const cur = t.currency as CurrencyCode;
      const qty = Number(t.quantity);
      const price = Number(t.unit_price);
      const fees = Number(t.fees ?? 0);

      if (t.tx_type === "dividend") continue; // legado — proventos agora vêm da tabela dividends
      if (t.tx_type === "deposit" || t.tx_type === "withdraw") continue;

      const agg = perAsset.get(t.asset_id) ?? { qty: 0, invested: 0, lastPrice: price, currency: cur };
      if (t.tx_type === "buy") {
        agg.qty += qty;
        agg.invested += qty * price + fees;
      } else if (t.tx_type === "sell") {
        const avg = agg.qty > 0 ? agg.invested / agg.qty : price;
        agg.qty -= qty;
        agg.invested -= qty * avg;
      } else if (t.tx_type === "transfer") {
        // Transferência interna (entre corretora e carteira própria, por ex.) — não é
        // compra nem venda, só muda "onde está guardado". A quantidade total só diminui
        // pela taxa de rede paga (fee_quantity, em unidades do próprio ativo); o capital
        // investido continua o mesmo, o que naturalmente eleva um pouco o preço médio
        // do saldo restante — reflexo correto do custo da transferência no patrimônio.
        const feeQty = Number((t.metadata as any)?.fee_quantity ?? 0);
        agg.qty -= feeQty;
      }
      agg.lastPrice = price;
      agg.currency = cur;
      perAsset.set(t.asset_id, agg);
    }

    // Build grouped assets
    const groupsMap = new Map<AssetClass, AssetGroup>();
    for (const [assetId, agg] of perAsset) {
      if (agg.qty <= 0.0000001) continue;
      const asset = assetById.get(assetId);
      if (!asset) continue;
      const klass = asset.asset_class as AssetClass;
      const cur = (asset.currency ?? agg.currency) as CurrencyCode;
      const avgPrice = agg.invested / agg.qty;
      // Para renda fixa sem preço de mercado: usa PU médio de compra (neutro)
      // Quando o cron buscar o PU atual via Brapi, latestPrice terá o valor real
      const currentPrice = latestPrice.get(assetId) ??
        (asset?.asset_class === "fixed_income" ? avgPrice : agg.lastPrice);
      const balanceBRL = toBRL(agg.qty * currentPrice, cur);
      const investedBRL = toBRL(agg.invested, cur);
      const yieldPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
      const variation = yieldPct; // placeholder until intraday day-prior data

      // DY e YoC — proventos dos últimos 12 meses (moeda nativa do ativo) sobre
      // preço atual (DY) ou preço médio de compra (YoC). Ambos em %.
      // Quando o histórico é menor que ~11 meses, já vem anualizado (ver acima) —
      // dyEstimated sinaliza isso pro front-end mostrar um indicador visual.
      const divInfo = dividendsAnnualized.get(assetId) ?? { perShare: 0, isEstimated: false };
      const dy = currentPrice > 0 ? (divInfo.perShare / currentPrice) * 100 : 0;
      const yoc = avgPrice > 0 ? (divInfo.perShare / avgPrice) * 100 : 0;
      const dyEstimated = divInfo.isEstimated;

      const ga: GroupedAsset = {
        assetId,
        symbol: asset.symbol,
        name: asset.name,
        assetClass: klass,
        currency: cur,
        country: (asset as any).country ?? "US",
        qty: agg.qty,
        avgPrice,
        currentPrice,
        balanceBRL,
        investedBRL,
        variation,
        yieldPct,
        dy,
        yoc,
        dyEstimated,
        bookValue: (asset as any).book_value != null ? Number((asset as any).book_value) : null,
        priceToBook: (asset as any).price_to_book != null ? Number((asset as any).price_to_book) : null,
        cmcId: (asset as any).cmc_id ?? null,
        logoUrl: (asset as any).logo_url ?? null,
      };

      const grp = groupsMap.get(klass) ?? {
        assetClass: klass, label: CLASS_LABEL[klass], assets: [],
        totalValueBRL: 0, totalInvestedBRL: 0, variation: 0, yieldPct: 0, pctWallet: 0,
      };
      grp.assets.push(ga);
      grp.totalValueBRL += balanceBRL;
      grp.totalInvestedBRL += investedBRL;
      groupsMap.set(klass, grp);
    }

    const groups = Array.from(groupsMap.values());
    const totalValueBRL = groups.reduce((a, g) => a + g.totalValueBRL, 0);
    const totalInvestedBRL = groups.reduce((a, g) => a + g.totalInvestedBRL, 0);
    for (const g of groups) {
      g.assets.sort((a, b) => b.balanceBRL - a.balanceBRL);
      g.pctWallet = totalValueBRL > 0 ? (g.totalValueBRL / totalValueBRL) * 100 : 0;
      g.yieldPct = g.totalInvestedBRL > 0
        ? ((g.totalValueBRL - g.totalInvestedBRL) / g.totalInvestedBRL) * 100
        : 0;
      g.variation = g.yieldPct;
    }
    groups.sort((a, b) => b.totalValueBRL - a.totalValueBRL);

    const pnl = totalValueBRL - totalInvestedBRL;
    const yieldPct = totalInvestedBRL > 0 ? (pnl / totalInvestedBRL) * 100 : 0;

    // Allocation
    const allocation = groups.map((g) => ({
      name: g.label,
      assetClass: g.assetClass,
      valueBRL: g.totalValueBRL,
      pct: totalValueBRL > 0 ? (g.totalValueBRL / totalValueBRL) * 100 : 0,
    }));

    // Equity history: cumulative invested + value-at-month-end from snapshots if present,
    // otherwise derive monthly cumulative invested from transactions.
    const snapshots = (snapshotsRes.data ?? []) as Array<{ snapshot_date: string; total_value: number; total_invested: number; pnl: number }>;
    const equity = buildEquityHistory(txs, toBRL, totalValueBRL, snapshots);

    // Broker allocation
    const brokerValueMap = new Map<string, number>(); // brokerId → totalValueBRL
    let unassignedValueBRL = 0;
    for (const t of txs) {
      if (t.tx_type !== "buy" && t.tx_type !== "sell") continue;
      const asset = assetById.get(t.asset_id);
      if (!asset) continue;
      const currentPrice = latestPrice.get(t.asset_id);
      if (currentPrice == null) continue;
      const qty = Number(t.quantity);
      const valueBRL = toBRL(qty * currentPrice, asset.currency as CurrencyCode);
      const bid = (t as any).broker_id;
      if (bid && brokerMap.has(bid)) {
        brokerValueMap.set(bid, (brokerValueMap.get(bid) ?? 0) + valueBRL);
      } else {
        unassignedValueBRL += valueBRL;
      }
    }
    // Deduplicate by keeping only current holdings per asset per broker
    // (simplified: use group totals proportionally)
    const brokerAllocation: { id: string | null; name: string; color: string; valueBRL: number; pct: number }[] = [];
    for (const [bid, val] of brokerValueMap.entries()) {
      const b = brokerMap.get(bid);
      if (!b) continue;
      brokerAllocation.push({ id: bid, name: b.name, color: b.color, valueBRL: val, pct: totalValueBRL > 0 ? (val / totalValueBRL) * 100 : 0 });
    }
    if (unassignedValueBRL > 0) {
      brokerAllocation.push({ id: null, name: "Sem corretora", color: "#9ca3af", valueBRL: unassignedValueBRL, pct: totalValueBRL > 0 ? (unassignedValueBRL / totalValueBRL) * 100 : 0 });
    }
    brokerAllocation.sort((a, b) => b.valueBRL - a.valueBRL);

    // Variação do dia: compara valor atual com snapshot de ontem
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const yesterdaySnapshot = snapshots
      .filter(s => s.snapshot_date <= yesterdayKey)
      .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
    const dayVariation = yesterdaySnapshot && Number(yesterdaySnapshot.total_value) > 0
      ? ((totalValueBRL - Number(yesterdaySnapshot.total_value)) / Number(yesterdaySnapshot.total_value)) * 100
      : 0;

    return {
      totalsBRL: {
        patrimonio: totalValueBRL,
        invested: totalInvestedBRL,
        pnl,
        yieldPct,
        dayVariation,
        dividends12m: totalDividends12mBRL,
      },
      allocation,
      brokerAllocation,
      equity,
      groups,
    };
  });

function buildEquityHistory(
  txs: Array<{ occurred_at: string; tx_type: string; quantity: number | string; unit_price: number | string; fees: number | string | null; currency: string }>,
  toBRL: (amount: number, cur: CurrencyCode) => number,
  totalCurrentValueBRL: number,
  snapshots: Array<{ snapshot_date: string; total_value: number; total_invested: number; pnl: number }> = [],
) {
  const sortedTxs = [...txs].sort((a, b) =>
    new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  if (sortedTxs.length === 0) return [];

  // Mês atual = último mês mostrado (lado direito do gráfico)
  const now = new Date();
  const currentMonthKey = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;

  // Mês do primeiro lançamento
  const firstTxDate = new Date(sortedTxs[0].occurred_at);

  // Janela: do primeiro lançamento até o mês atual, máximo 24 meses
  const totalMonths = Math.min(
    (now.getFullYear() - firstTxDate.getFullYear()) * 12 + (now.getMonth() - firstTxDate.getMonth()) + 1,
    24
  );

  // Gera lista de monthKeys do mais antigo para o mais recente (termina sempre no mês atual)
  const monthKeys: string[] = [];
  for (let i = totalMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    monthKeys.push(key);
  }

  // Acumula investido até o fim de cada mês
  const monthlyInvested = new Map<string, number>();
  let cumInvested = 0;
  for (const t of sortedTxs) {
    const d = new Date(t.occurred_at);
    const cur = t.currency as CurrencyCode;
    const qty = Number(t.quantity);
    const price = Number(t.unit_price);
    const fees = Number(t.fees ?? 0);
    if (t.tx_type === "buy") cumInvested += toBRL(qty * price + fees, cur);
    else if (t.tx_type === "sell") cumInvested -= toBRL(qty * price - fees, cur);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    monthlyInvested.set(key, cumInvested);
  }

  const finalCumInvested = cumInvested;
  const currentPnL = totalCurrentValueBRL - finalCumInvested;

  const out: { date: string; aplicado: number; ganho: number }[] = [];
  let lastInvested = 0;

  for (const key of monthKeys) {
    if (monthlyInvested.has(key)) {
      lastInvested = monthlyInvested.get(key)!;
    }
    const aplicado = lastInvested;

    let ganho: number;
    if (key === currentMonthKey) {
      // Mês atual: ganho aberto — usa valor real atual do portfólio
      ganho = finalCumInvested > 0 && aplicado > 0
        ? currentPnL * (aplicado / finalCumInvested)
        : 0;
    } else {
      // Meses passados: busca o snapshot travado do último dia do mês
      // O snapshot_date é YYYY-MM-DD, o key é MM/YY
      const [mm, yy] = key.split("/");
      const fullYear = `20${yy}`;
      const snapshotForMonth = snapshots
        .filter(s => s.snapshot_date.startsWith(`${fullYear}-${mm}`))
        .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];

      if (snapshotForMonth) {
        // Usa o PnL real travado do snapshot do último dia do mês
        ganho = Number(snapshotForMonth.pnl);
        // Sobrescreve aplicado com o investido real do snapshot
        out.push({ date: key, aplicado: Number(snapshotForMonth.total_invested), ganho });
        continue;
      } else {
        // Sem snapshot ainda: usa estimativa proporcional
        ganho = finalCumInvested > 0 && aplicado > 0
          ? currentPnL * (aplicado / finalCumInvested)
          : 0;
      }
    }

    out.push({ date: key, aplicado, ganho });
  }

  return out;
}

// ---------- createTransaction ----------
const createTxSchema = z.object({
  symbol: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._+%-]+$/),
  name: z.string().max(120).optional(),
  assetClass: z.enum(["stock","reit","etf","stock_intl","reit_intl","etf_intl","crypto","fixed_income","fund","cash","other"]),
  txType: z.enum(["buy","sell","dividend","deposit","withdraw","transfer"]),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().positive().max(1e12),
  unitPrice: z.number().min(0).max(1e12),
  fees: z.number().min(0).max(1e9).default(0),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
  brokerId: z.string().uuid().optional(),
  metadata: z.object({
    benchmark: z.string().optional(),
    rate: z.number().optional(),
    maturity_date: z.string().nullable().optional(),
    issuer: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    product_type: z.string().optional(),
    applied_amount: z.number().optional(),
    // Transferência interna (só cripto): de onde saiu + taxa de rede (em unidades do próprio ativo)
    from_broker_id: z.string().uuid().nullable().optional(),
    fee_quantity: z.number().min(0).optional(),
  }).optional(),
}).refine(
  (d) => d.txType !== "transfer" || d.assetClass === "crypto",
  { message: "Transferência interna só é permitida para criptoativos" }
).refine(
  (d) => d.txType !== "transfer" || !!d.brokerId,
  { message: "Informe a carteira/corretora de destino da transferência" }
).refine(
  (d) => d.txType !== "transfer" || !!d.metadata?.from_broker_id,
  { message: "Informe a carteira/corretora de origem da transferência" }
).refine(
  (d) => d.txType !== "transfer" || d.metadata?.from_broker_id !== d.brokerId,
  { message: "Origem e destino da transferência devem ser diferentes" }
);

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createTxSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Upsert asset by (symbol, currency)
    const symbol = data.symbol.toUpperCase();
    let { data: asset, error: aErr } = await supabase
      .from("assets")
      .select("id")
      .eq("symbol", symbol)
      .eq("currency", data.currency)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);

    if (!asset) {
      const isAdmin = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      const autoApprove = !!isAdmin.data;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Deriva o país automaticamente pela moeda do ativo
      const currencyToCountry: Record<string, string> = {
        BRL: "BR", USD: "US", EUR: "EU", GBP: "GB", JPY: "JP",
      };
      const country = currencyToCountry[data.currency] ?? "US";

      const ins = await supabaseAdmin.from("assets").insert({
        symbol,
        name: data.name ?? symbol,
        asset_class: data.assetClass,
        currency: data.currency,
        country,
        status: autoApprove ? "approved" : "pending",
        requested_by: userId,
      }).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      asset = ins.data;
    }

    const { error: tErr } = await (supabase as any).from("transactions").insert({
      user_id: userId,
      asset_id: asset.id,
      tx_type: data.txType,
      occurred_at: data.occurredAt,
      quantity: data.quantity,
      unit_price: data.unitPrice,
      fees: data.fees ?? 0,
      currency: data.currency,
      broker_id: data.brokerId ?? null,
      metadata: data.metadata ?? null,
    });
    if (tErr) throw new Error(tErr.message);
    return { ok: true as const };
  });

// ---------- listTransactions ----------
export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [txRes, assetsRes, brokersRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", userId).order("occurred_at", { ascending: false }),
      supabase.from("assets").select("id, symbol, name, asset_class, currency"),
      (supabase as any).from("brokers").select("id, name, color").eq("user_id", userId),
      supabase.from("portfolio_snapshots").select("snapshot_date, total_value, total_invested, pnl").eq("user_id", userId).order("snapshot_date", { ascending: true }),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);
    const assetById = new Map((assetsRes.data ?? []).map((a) => [a.id, a]));
    const brokerById = new Map<string, { id: string; name: string; color: string }>(
      ((brokersRes.data ?? []) as any[]).map((b: any) => [b.id, b])
    );
    return (txRes.data ?? []).map((t) => {
      const a = assetById.get(t.asset_id);
      const tAny = t as any;
      const b = tAny.broker_id ? brokerById.get(tAny.broker_id) : null;
      return {
        id: t.id,
        symbol: a?.symbol ?? "?",
        assetClass: (a?.asset_class ?? "other") as AssetClass,
        classLabel: CLASS_LABEL[(a?.asset_class ?? "other") as AssetClass],
        txType: t.tx_type as TxType,
        occurredAt: t.occurred_at,
        quantity: Number(t.quantity),
        unitPrice: Number(t.unit_price),
        fees: Number(t.fees ?? 0),
        currency: t.currency as CurrencyCode,
        brokerId: tAny.broker_id ?? null,
        brokerName: b?.name ?? null,
        brokerColor: b?.color ?? null,
        metadata: tAny.metadata ?? null,
      };
    });
  });

// ---------- updateTransaction ----------
const updateTxSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  txType: z.enum(["buy","sell","dividend","deposit","withdraw"]),
  quantity: z.number().positive().max(1e12),
  unitPrice: z.number().min(0).max(1e12),
  fees: z.number().min(0).max(1e9).default(0),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
});

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateTxSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("transactions")
      .update({
        occurred_at: data.occurredAt,
        tx_type: data.txType,
        quantity: data.quantity,
        unit_price: data.unitPrice,
        fees: data.fees ?? 0,
        currency: data.currency,
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------- deleteTransaction ----------
export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------- getAssetLots ----------
export type AssetLot = {
  id: string;
  txType: TxType;
  occurredAt: string;
  quantity: number;
  unitPrice: number;
  fees: number;
  currency: CurrencyCode;
  costBasis: number;       // qty*unitPrice + fees (compra), proceeds (venda)
  currentValue: number;    // qty * currentPrice (somente compras)
  pnl: number;             // currentValue - costBasis (compras); proceeds - avgAtTime (vendas) — simplificado
  pnlPct: number;
};

export type AssetLotsResult = {
  asset: {
    id: string;
    symbol: string;
    name: string | null;
    assetClass: AssetClass;
    currency: CurrencyCode;
    currentPrice: number;
  };
  lots: AssetLot[];
  totals: { qty: number; invested: number; currentValue: number; pnl: number; pnlPct: number };
};

export const getAssetLots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ assetId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<AssetLotsResult> => {
    const { supabase, userId } = context;
    const [txRes, assetRes, priceRes] = await Promise.all([
      supabase.from("transactions").select("*")
        .eq("user_id", userId).eq("asset_id", data.assetId)
        .order("occurred_at", { ascending: false }),
      supabase.from("assets").select("*").eq("id", data.assetId).single(),
      supabase.from("asset_prices").select("close_price, fetched_at")
        .eq("asset_id", data.assetId)
        .order("fetched_at", { ascending: false }).limit(1),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);
    if (assetRes.error) throw new Error(assetRes.error.message);

    const asset = assetRes.data;
    const txs = txRes.data ?? [];
    const currentPrice = priceRes.data?.[0]?.close_price
      ? Number(priceRes.data[0].close_price)
      : Number(txs.find((t) => t.tx_type === "buy")?.unit_price ?? 0);

    const lots: AssetLot[] = txs.map((t) => {
      const qty = Number(t.quantity);
      const price = Number(t.unit_price);
      const fees = Number(t.fees ?? 0);
      const costBasis = qty * price + fees;
      const currentValue = t.tx_type === "buy" ? qty * currentPrice : 0;
      const pnl = t.tx_type === "buy" ? currentValue - costBasis : 0;
      const pnlPct = costBasis > 0 && t.tx_type === "buy" ? (pnl / costBasis) * 100 : 0;
      return {
        id: t.id,
        txType: t.tx_type as TxType,
        occurredAt: t.occurred_at,
        quantity: qty,
        unitPrice: price,
        fees,
        currency: t.currency as CurrencyCode,
        costBasis,
        currentValue,
        pnl,
        pnlPct,
      };
    });

    // Totals (apenas compras abertas — simplificado: soma todas as compras menos vendas em qty)
    let qty = 0, invested = 0;
    for (const t of txs) {
      const q = Number(t.quantity);
      const p = Number(t.unit_price);
      const f = Number(t.fees ?? 0);
      if (t.tx_type === "buy") { qty += q; invested += q * p + f; }
      else if (t.tx_type === "sell") {
        const avg = qty > 0 ? invested / qty : p;
        qty -= q; invested -= q * avg;
      } else if (t.tx_type === "transfer") {
        const feeQty = Number((t.metadata as any)?.fee_quantity ?? 0);
        qty -= feeQty; // só a taxa de rede reduz o saldo; capital investido não muda
      }
    }
    const currentValue = qty * currentPrice;
    const pnl = currentValue - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

    return {
      asset: {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.asset_class as AssetClass,
        currency: asset.currency as CurrencyCode,
        currentPrice,
      },
      lots,
      totals: { qty, invested, currentValue, pnl, pnlPct },
    };
  });

// ---------- searchAssets (autocomplete) ----------
export type CatalogAsset = {
  id: string;
  symbol: string;
  name: string | null;
  assetClass: AssetClass;
  currency: CurrencyCode;
};

export const forceRefreshPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const i = input as { assetId: string };
    if (!i?.assetId) throw new Error("assetId required");
    return i;
  })
  .handler(async ({ data, context }): Promise<{ price: number; source: string }> => {
    const { supabase } = context;
    const { assetId } = data;

    const { data: asset, error } = await supabase
      .from("assets")
      .select("id, symbol, asset_class, currency, quote_url")
      .eq("id", assetId)
      .single();
    if (error || !asset) throw new Error("Asset not found");

    // Force fresh fetch
    let { price: _price, source: _source } = await fetchPriceFor(asset, true);

    if (_price == null && asset.quote_url) {
      const uPrice = await fetchPriceFromUrl(asset.quote_url);
      if (uPrice != null) { _price = uPrice; _source = "url"; }
    }

    if (_price == null) throw new Error("Não foi possível obter cotação para este ativo.");

    // Upsert the fresh price
    await supabase.from("asset_prices").upsert({
      asset_id: assetId,
      price_date: new Date().toISOString().slice(0, 10),
      close_price: _price,
      source: _source,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "asset_id,price_date" });

    // Clear any failure records
    await supabase.from("price_fetch_failures")
      .delete()
      .eq("asset_id", assetId)
      .eq("resolved", false);

    return { price: _price, source: _source };
  });

// ---------- listBrokers ----------
// ---------- Dividend sync ----------

async function fetchFintzDividends(
  symbol: string,
  since: string,
): Promise<Array<{ ex_date: string; payment_date?: string; amount: number }>> {
  try {
    const url = `https://api.fintz.com.br/bolsa/b3/avista/eventos/proventos?ticker=${encodeURIComponent(symbol)}&dataInicio=${since}`;
    const res = await fetch(url, {
      headers: {
        "X-API-Key": "chave-de-testes-api-fintz",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      console.log(`[fintz] ${symbol} HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as any[];
    console.log(`[fintz] ${symbol} total: ${json?.length ?? 0}`);
    if (!Array.isArray(json) || json.length === 0) return [];

    return json.map((d: any) => ({
      ex_date: (d.dataEx ?? d.dataCom ?? d.data ?? "").slice(0, 10),
      payment_date: d.dataPagamento ? d.dataPagamento.slice(0, 10) : undefined,
      amount: Number(d.valor ?? d.valorProvento ?? 0),
    })).filter(d => d.amount > 0 && d.ex_date);
  } catch (e) {
    console.log(`[fintz] ${symbol} error: ${e}`);
    return [];
  }
}

async function fetchBrapiDividends(
  symbol: string,
  token: string,
  since: string,
): Promise<Array<{ ex_date: string; payment_date?: string; amount: number }>> {
  try {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(symbol)}?dividends=true&token=${token}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      console.log(`[brapi] ${symbol} HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as any;
    const result = json?.results?.[0];
    const divData = result?.dividendsData;
    const cashDivs = divData?.cashDividends ?? [];
    console.log(`[brapi] ${symbol} cashDividends: ${cashDivs.length}`);

    if (!cashDivs.length) return [];
    const out: Array<{ ex_date: string; payment_date?: string; amount: number }> = [];
    for (const d of cashDivs) {
      const payDate = d.paymentDate ?? d.payDate ?? d.date ?? null;
      const exDate = d.lastDatePrior ?? d.approvedOn ?? d.referenceDate ?? payDate;
      const amount = Number(d.rate ?? d.value ?? d.amount ?? 0);
      if (!exDate || amount <= 0) continue;
      if (exDate.slice(0, 10) < since) continue;
      out.push({ ex_date: exDate.slice(0, 10), payment_date: payDate?.slice(0, 10), amount });
    }
    return out;
  } catch { return []; }
}

async function fetchTwelveDataDividends(
  symbol: string,
  apiKey: string,
  since: string,
): Promise<Array<{ ex_date: string; payment_date?: string; amount: number }>> {
  try {
    const url = `https://api.twelvedata.com/dividends?symbol=${encodeURIComponent(symbol)}&start_date=${since}&apikey=${apiKey}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const divs = json?.dividends ?? [];
    return divs
      .map((d: any) => ({
        ex_date: d.ex_date ?? d.date,
        payment_date: d.payment_date,
        amount: Number(d.amount ?? 0),
      }))
      .filter((d: any) => d.amount > 0 && d.ex_date);
  } catch { return []; }
}

// Returns list of assets that need dividend sync (client calls syncAssetDividends for each)
export const getDividendSyncQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: txs } = await supabase
      .from("transactions")
      .select("asset_id, occurred_at")
      .eq("user_id", userId)
      .eq("tx_type", "buy")
      .order("occurred_at", { ascending: true });

    if (!txs?.length) return [];

    const firstBuyMap = new Map<string, string>();
    for (const t of txs) {
      if (!firstBuyMap.has(t.asset_id)) {
        const d = new Date(t.occurred_at);
        const since = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        firstBuyMap.set(t.asset_id, since);
      }
    }

    const assetIds = Array.from(firstBuyMap.keys());
    const { data: assets } = await supabase
      .from("assets")
      .select("id, symbol, currency, asset_class")
      .in("id", assetIds)
      .eq("status", "approved");

    return (assets ?? [])
      .filter(a => a.asset_class !== "crypto")
      .map(a => ({
        assetId: a.id,
        symbol: a.symbol,
        currency: a.currency as CurrencyCode,
        assetClass: a.asset_class as AssetClass,
        since: firstBuyMap.get(a.id) ?? "2020-01-01",
      }));
  });

export const syncAssetDividends = createServerFn({ method: "POST" }) // v2 2026-06-13
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const i = input as { assetId: string; symbol: string; currency: string; assetClass: string; since: string };
    if (!i?.assetId) throw new Error("assetId required");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
    const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

    let divs: Array<{ ex_date: string; payment_date?: string; amount: number }> = [];
    console.log(`[sync] ${data.symbol} currency=${data.currency} class=${data.assetClass} hasBrapi=${!!BRAPI_TOKEN} hasTwelve=${!!TWELVE_KEY}`);

    if (data.currency === "BRL" && BRAPI_TOKEN) {
      if (data.assetClass === "reit" || data.assetClass === "etf") {
        // FIIs: use Fintz API (data from B3)
        divs = await fetchFintzDividends(data.symbol, data.since);
      } else {
        // Brazilian stocks: try Brapi first
        divs = await fetchBrapiDividends(data.symbol, BRAPI_TOKEN, data.since);
      }
    } else if (data.currency !== "BRL" && TWELVE_KEY) {
      divs = await fetchTwelveDataDividends(data.symbol, TWELVE_KEY, data.since);
    }

    console.log(`[dividends] ${data.symbol}: ${divs.length} found since ${data.since}`);

    if (!divs.length) return { synced: 0 };

    // Check existing to avoid duplicates
    const { data: existing } = await (supabase as any)
      .from("dividends")
      .select("ex_date")
      .eq("user_id", userId)
      .eq("asset_id", data.assetId);

    const existingDates = new Set((existing ?? []).map((d: any) => d.ex_date));

    const toInsert = divs
      .filter(d => !existingDates.has(d.ex_date))
      .map(d => ({
        user_id: userId,
        asset_id: data.assetId,
        ex_date: d.ex_date,
        payment_date: d.payment_date ?? null,
        amount: d.amount,
        currency: data.currency,
        source: data.currency === "BRL" ? "brapi" : "twelve",
      }));

    if (toInsert.length > 0) {
      await (supabase as any)
        .from("dividends")
        .upsert(toInsert, { onConflict: "asset_id,ex_date,user_id" });
    }

    return { synced: toInsert.length };
  });

// Keep for backwards compat
export const syncDividends = getDividendSyncQueue;

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify caller is admin
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Unauthorized");

    // List all users from auth
    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);

    // Get all roles
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, string[]>();
    for (const r of roles ?? []) {
      if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, []);
      rolesByUser.get(r.user_id)!.push(r.role);
    }

    return (authData.users ?? []).map(u => ({
      id: u.id,
      email: u.email ?? "",
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at ?? null,
      roles: rolesByUser.get(u.id) ?? [],
    }));
  });

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const i = input as { targetUserId: string; role: string; action: "add" | "remove" };
    if (!i?.targetUserId || !i?.role) throw new Error("targetUserId and role required");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Unauthorized");

    if (data.action === "add") {
      await supabaseAdmin.from("user_roles").upsert({
        user_id: data.targetUserId,
        role: data.role,
      }, { onConflict: "user_id,role" });
    } else {
      await supabaseAdmin.from("user_roles")
        .delete()
        .eq("user_id", data.targetUserId)
        .eq("role", data.role);
    }
    return { ok: true };
  });

export const listBrokers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("brokers")
      .select("id, name, type, country, color")
      .eq("user_id", userId)
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string; type: string; country: string; color: string }[];
  });

const brokerSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(["broker", "brazil", "international", "wallet"]).default("broker"),
  country: z.string().max(10).default("BR"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6366f1"),
});

export const createBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => brokerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inserted, error } = await (supabase as any)
      .from("brokers")
      .insert({ user_id: userId, name: data.name, type: data.type, country: data.country, color: data.color })
      .select("id, name, type, country, color")
      .single();
    if (error) throw new Error(error.message);
    return inserted as { id: string; name: string; type: string; country: string; color: string };
  });

export const updateBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => brokerSchema.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any)
      .from("brokers")
      .update({ name: data.name, type: data.type, country: data.country, color: data.color })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verifica se há lançamentos usando essa corretora antes de excluir
    const { count } = await (supabase as any)
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("broker_id", data.id)
      .eq("user_id", userId);
    if (count && count > 0) {
      throw new Error(`Não é possível excluir — ${count} lançamento(s) usam essa corretora/wallet. Edite os lançamentos primeiro.`);
    }
    const { error } = await (supabase as any).from("brokers").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const searchAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      q: z.string().min(1).max(32),
      assetClass: z.enum(["stock","reit","etf","stock_intl","reit_intl","etf_intl","crypto","fixed_income","fund","cash","other"]).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CatalogAsset[]> => {
    const { supabase } = context;
    const q = data.q.trim().toUpperCase();
    let query = supabase.from("assets")
      .select("id, symbol, name, asset_class, currency, status")
      .or(`symbol.ilike.${q}%,name.ilike.%${q}%`)
      .order("symbol", { ascending: true })
      .limit(20);
    if (data.assetClass) query = query.eq("asset_class", data.assetClass);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id, symbol: r.symbol, name: r.name,
      assetClass: r.asset_class as AssetClass, currency: r.currency as CurrencyCode,
    }));
  });

// ---------- requestAssetInclusion (qualquer usuário) ----------
const requestAssetSchema = z.object({
  symbol: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._+%-]+$/),
  name: z.string().max(120).optional(),
  assetClass: z.enum(["stock","reit","etf","stock_intl","reit_intl","etf_intl","crypto","fixed_income","fund","cash","other"]),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
});

export const requestAssetInclusion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => requestAssetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const symbol = data.symbol.toUpperCase();
    const existing = await supabase.from("assets").select("id, status")
      .eq("symbol", symbol).eq("currency", data.currency).maybeSingle();
    if (existing.data) {
      return { ok: true as const, id: existing.data.id, status: existing.data.status as string };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ins = await supabaseAdmin.from("assets").insert({
      symbol, name: data.name ?? symbol,
      asset_class: data.assetClass, currency: data.currency,
      status: "approved", requested_by: userId,
    }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    return { ok: true as const, id: ins.data.id, status: "approved" };
  });

// ---------- listCatalog (admin) ----------
export type CatalogRow = CatalogAsset & {
  lastPrice: number | null;
  fetchedAt: string | null;
  status: "pending" | "approved";
  dataSource: string | null;
  quoteUrl: string | null;
  requestedBy: string | null;
  market: MarketCode;
  marketOpen: boolean;
};

export type CatalogPage = {
  rows: CatalogRow[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
};

export const listCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      q: z.string().max(64).optional(),
      assetClass: z.string().max(32).optional(),
      status: z.enum(["all", "pending", "approved"]).default("all"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CatalogPage> => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!roles?.some((r) => r.role === "admin")) throw new Error("Acesso restrito.");

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = supabase.from("assets").select("*", { count: "exact" })
      .order("status", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, to);
    if (data.assetClass && data.assetClass !== "all") q = q.eq("asset_class", data.assetClass as AssetClass);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.q && data.q.trim().length > 0) {
      const term = data.q.trim().toUpperCase();
      q = q.or(`symbol.ilike.%${term}%,name.ilike.%${term}%`);
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    const priceMap = new Map<string, { price: number; fetchedAt: string | null }>();
    if (ids.length > 0) {
      const { data: prices } = await supabase
        .from("asset_prices")
        .select("asset_id, close_price, fetched_at")
        .in("asset_id", ids)
        .order("fetched_at", { ascending: false });
      for (const p of prices ?? []) {
        if (!priceMap.has(p.asset_id)) {
          priceMap.set(p.asset_id, {
            price: Number(p.close_price),
            fetchedAt: (p.fetched_at as unknown as string) ?? null,
          });
        }
      }
    }

    const { count: pendingCount } = await supabase.from("assets")
      .select("id", { count: "exact", head: true }).eq("status", "pending");

    return {
      rows: (rows ?? []).map((r) => {
        const market = ((r as { market?: MarketCode }).market ?? "OTHER") as MarketCode;
        return {
          id: r.id, symbol: r.symbol, name: r.name,
          assetClass: r.asset_class as AssetClass, currency: r.currency as CurrencyCode,
          lastPrice: priceMap.get(r.id)?.price ?? null,
          fetchedAt: priceMap.get(r.id)?.fetchedAt ?? null,
          status: (r as { status: "pending" | "approved" }).status,
          dataSource: (r as { data_source: string | null }).data_source ?? null,
          quoteUrl: (r as { quote_url: string | null }).quote_url ?? null,
          requestedBy: (r as { requested_by: string | null }).requested_by ?? null,
          market,
          marketOpen: isMarketOpen(market),
        };
      }),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      pendingCount: pendingCount ?? 0,
    };
  });

// ---------- Admin: criar / atualizar / aprovar / rejeitar ativo ----------
async function assertAdmin(supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!roles?.some((r: { role: string }) => r.role === "admin")) throw new Error("Acesso restrito.");
}

const ASSET_CLASS_ENUM = z.enum([
  "stock","reit","etf","stock_intl","reit_intl","etf_intl",
  "crypto","fixed_income","fund","cash","other",
]);
const MARKET_ENUM = z.enum(["B3","NYSE","NASDAQ","LSE","XETRA","TSE","CRYPTO","TREASURY","OTHER"]);

const adminCreateSchema = z.object({
  symbol: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._+%-]+$/),
  name: z.string().min(1).max(120),
  assetClass: ASSET_CLASS_ENUM,
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
  market: MARKET_ENUM.optional(),
  dataSource: z.string().max(40).optional(),
  quoteUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const adminCreateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => adminCreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertAdmin(context.supabase as any, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const market = data.market ?? defaultMarketFor(data.currency, data.assetClass);
    const ins = await supabaseAdmin.from("assets").insert({
      symbol: data.symbol.toUpperCase(),
      name: data.name,
      asset_class: data.assetClass,
      currency: data.currency,
      market,
      data_source: data.dataSource || "yahoo",
      quote_url: data.quoteUrl || null,
      status: "approved",
    }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    return { ok: true as const, id: ins.data.id };
  });

const adminUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  assetClass: ASSET_CLASS_ENUM.optional(),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]).optional(),
  market: MARKET_ENUM.optional(),
  dataSource: z.string().max(40).optional(),
  quoteUrl: z.string().max(500).optional(),
  country: z.string().max(10).optional(),
});

export const adminUpdateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => adminUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertAdmin(context.supabase as any, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      name?: string; asset_class?: AssetClass; currency?: CurrencyCode;
      market?: MarketCode;
      data_source?: string | null; quote_url?: string | null;
      country?: string;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.assetClass) patch.asset_class = data.assetClass;
    if (data.currency) patch.currency = data.currency;
    if (data.market) patch.market = data.market;
    if (data.dataSource !== undefined) patch.data_source = data.dataSource || null;
    if (data.quoteUrl !== undefined) patch.quote_url = data.quoteUrl || null;
    if (data.country !== undefined) patch.country = data.country;
    const upd = await supabaseAdmin.from("assets").update(patch as any).eq("id", data.id);
    if (upd.error) throw new Error(upd.error.message);
    return { ok: true as const };
  });

export const adminApproveAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertAdmin(context.supabase as any, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const upd = await supabaseAdmin.from("assets").update({ status: "approved" }).eq("id", data.id);
    if (upd.error) throw new Error(upd.error.message);
    return { ok: true as const };
  });

export const adminRejectAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertAdmin(context.supabase as any, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hasTx = await supabaseAdmin.from("transactions").select("id", { head: true, count: "exact" }).eq("asset_id", data.id);
    if ((hasTx.count ?? 0) > 0) {
      throw new Error("Ativo possui lançamentos. Aprove ou apague-os antes.");
    }
    const del = await supabaseAdmin.from("assets").delete().eq("id", data.id);
    if (del.error) throw new Error(del.error.message);
    return { ok: true as const };
  });

// ---------- Admin: testar conexão com fontes de preço ----------
export type PriceSourceTest = {
  ok: boolean;
  yahoo: { ok: boolean; latencyMs: number; price: number | null; error?: string };
  url: { ok: boolean; latencyMs: number; price: number | null; sampleHost?: string; error?: string };
  staleAssets: number;        // ativos com fetch > 48h
  neverFetched: number;
  totalApproved: number;
};

export const adminTestPriceSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PriceSourceTest> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertAdmin(context.supabase as any, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Stooq: testa com símbolo conhecido (AAPL.US)
    const t0 = Date.now();
    const yPrice = await fetchStooqPrice("aapl.us");
    const yahoo = {
      ok: yPrice != null,
      latencyMs: Date.now() - t0,
      price: yPrice,
      error: yPrice == null ? "Stooq não respondeu." : undefined,
    };

    // 2) URL: tenta primeiro ativo aprovado com quote_url
    let url: PriceSourceTest["url"] = { ok: false, latencyMs: 0, price: null };
    const { data: sample } = await supabaseAdmin.from("assets")
      .select("quote_url").eq("status", "approved").not("quote_url", "is", null).limit(1).maybeSingle();
    if (sample?.quote_url) {
      const u0 = Date.now();
      const p = await fetchPriceFromUrl(sample.quote_url);
      url = {
        ok: p != null, latencyMs: Date.now() - u0, price: p,
        sampleHost: (() => { try { return new URL(sample.quote_url!).hostname; } catch { return undefined; } })(),
        error: p == null ? "Não foi possível extrair preço da URL configurada." : undefined,
      };
    } else {
      url = { ok: true, latencyMs: 0, price: null, error: "Nenhum ativo com URL configurada para testar." };
    }

    // 3) Saúde geral: stale (>48h) + nunca atualizados
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: approved } = await supabaseAdmin.from("assets")
      .select("id").eq("status", "approved");
    const totalApproved = approved?.length ?? 0;
    const ids = (approved ?? []).map((a) => a.id);
    let neverFetched = 0, staleAssets = 0;
    if (ids.length > 0) {
      const { data: latest } = await supabaseAdmin
        .from("asset_prices").select("asset_id, fetched_at")
        .in("asset_id", ids).order("fetched_at", { ascending: false });
      const last = new Map<string, string>();
      for (const p of latest ?? []) {
        if (!last.has(p.asset_id)) last.set(p.asset_id, p.fetched_at as unknown as string);
      }
      for (const id of ids) {
        const f = last.get(id);
        if (!f) neverFetched++;
        else if (f < cutoff) staleAssets++;
      }
    }

    return { ok: yahoo.ok, yahoo, url, staleAssets, neverFetched, totalApproved };
  });

// ---------- refreshAllPrices (called by cron) ----------
export async function refreshAllPricesInternal(): Promise<{
  updated: number; failed: number; skippedClosed: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: txAssetIds } = await supabaseAdmin
    .from("transactions").select("asset_id");
  const heldIds = Array.from(new Set((txAssetIds ?? []).map((t) => t.asset_id)));
  if (heldIds.length === 0) return { updated: 0, failed: 0, skippedClosed: 0 };

  const { data: assets } = await supabaseAdmin
    .from("assets").select("id, symbol, asset_class, currency, quote_url, market")
    .in("id", heldIds)
    .eq("status", "approved");

  const { data: priceRows } = await supabaseAdmin
    .from("asset_prices").select("asset_id").in("asset_id", (assets ?? []).map((a) => a.id));
  const everFetched = new Set((priceRows ?? []).map((p) => p.asset_id));

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  let updated = 0, failed = 0, skippedClosed = 0;
  await Promise.all((assets ?? []).map(async (a) => {
    const market = ((a as { market?: MarketCode }).market ?? "OTHER") as MarketCode;
    const neverFetched = !everFetched.has(a.id);
    // Mercado fechado: pula, exceto se nunca foi atualizado (primeira carga)
    if (!neverFetched && !isMarketOpen(market, now)) {
      skippedClosed++;
      return;
    }
    const { price, source } = await fetchPriceFor(
      { symbol: a.symbol, asset_class: a.asset_class, currency: a.currency, quote_url: a.quote_url },
      neverFetched,
    );
    if (price == null) {
      failed++;
      await supabaseAdmin.from("price_fetch_failures").insert({
        asset_id: a.id, symbol: a.symbol, reason: `cron:${market}:${source}:no-data`,
      });
      return;
    }
    await supabaseAdmin.from("asset_prices").insert({
      asset_id: a.id, price_date: today, source, close_price: price,
    });
    updated++;
  }));
  return { updated, failed, skippedClosed };
}



// ---------- deleteAsset (admin only) ----------
export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) throw new Error("Forbidden");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!roles?.some((r: { role: string }) => r.role === "admin")) throw new Error("Acesso restrito.");
    const { error } = await supabase.from("assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- removeAssetFromPortfolio ----------
// Remove um ativo da carteira do usuário — duas modalidades:
// mode "delete": apaga todos os lançamentos do ativo para o usuário
// mode "sell"  : cria um lançamento de venda pelo preço atual e apaga os demais (saldo zerado)
export const removeAssetFromPortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      assetId: z.string().uuid(),
      mode: z.enum(["delete", "sell"]),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Busca todos os lançamentos de compra do ativo para o usuário
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("id, quantity, unit_price, currency, tx_type")
      .eq("asset_id", data.assetId)
      .eq("user_id", userId);

    if (txErr) throw new Error(txErr.message);
    if (!txs || txs.length === 0) throw new Error("Nenhum lançamento encontrado para este ativo.");

    if (data.mode === "sell") {
      // Calcula quantidade líquida (compras - vendas)
      let netQty = 0;
      for (const tx of txs) {
        if (tx.tx_type === "buy") netQty += Number(tx.quantity);
        if (tx.tx_type === "sell") netQty -= Number(tx.quantity);
      }

      if (netQty > 0) {
        // Busca o preço atual do ativo
        const { data: priceRow } = await supabase
          .from("asset_prices")
          .select("close_price")
          .eq("asset_id", data.assetId)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const currentPrice = priceRow?.close_price ?? txs.find(t => t.tx_type === "buy")?.unit_price ?? 0;
        const currency = txs.find(t => t.tx_type === "buy")?.currency ?? "BRL";

        // Insere lançamento de venda com a quantidade líquida ao preço atual
        const { error: sellErr } = await supabase.from("transactions").insert({
          user_id: userId,
          asset_id: data.assetId,
          tx_type: "sell",
          quantity: netQty,
          unit_price: currentPrice,
          currency,
          occurred_at: new Date().toISOString().slice(0, 10),
          notes: "Venda gerada automaticamente ao remover ativo da carteira",
        });
        if (sellErr) throw new Error(sellErr.message);
      }
    }

    // Apaga todos os lançamentos do ativo para o usuário (exceto a venda que acabamos de criar no modo sell)
    const idsToDelete = data.mode === "sell"
      ? txs.map((t: { id: string }) => t.id) // apaga todos os antigos; a venda nova não está na lista
      : txs.map((t: { id: string }) => t.id);

    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .in("id", idsToDelete)
      .eq("user_id", userId);

    if (delErr) throw new Error(delErr.message);

    return { ok: true as const };
  });

// ---------- User Strategies ----------

export const listUserStrategies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_strategies")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveUserStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1),
      buckets: z.array(z.object({
        label: z.string(),
        target: z.number(),
        classes: z.array(z.string()),
        color: z.string(),
      })),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase
        .from("user_strategies")
        .update({ name: data.name, buckets: data.buckets, updated_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("user_strategies")
        .insert({ user_id: userId, name: data.name, buckets: data.buckets });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteUserStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_strategies")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------- Asset Analysis (IA) ----------

const ANALYSIS_PROMPTS: Record<string, string> = {
  fundamentalista: `Você é um analista fundamentalista experiente. Analise o ativo fornecido seguindo rigorosamente estes três pilares:

## Pilar 1 — Qualidade do Lucro
- O lucro é recorrente ou há itens não-recorrentes distorcendo o resultado?
- O crescimento de receita é orgânico ou via aquisições?
- A margem está expandindo ou comprimindo?
- O fluxo de caixa confirma o lucro reportado?

## Pilar 2 — Retorno sobre Capital
- Qual o ROIC/ROE nos últimos anos? Está acima do custo de capital?
- A empresa consegue reinvestir o capital com bons retornos?
- Qual o histórico de alocação de capital (dividendos, recompras, M&A)?

## Pilar 3 — Risco
- Qual o nível de endividamento? A empresa consegue honrar seus compromissos?
- Há riscos regulatórios, competitivos ou macroeconômicos relevantes?
- A gestão tem histórico de entrega e alinhamento com acionistas?

Ao final, dê um veredito: EXCELENTE / BOM+ / BOM / NEUTRO / EVITAR, com justificativa em 2-3 linhas.`,

  bancos: `Você é um analista especializado em instituições financeiras. Analise o banco/financeira seguindo:

## Rentabilidade
- ROTCE (Return on Tangible Common Equity): está acima de 15%?
- NIM (Net Interest Margin) e tendência
- Índice de eficiência operacional

## Qualidade de Crédito
- NPL ratio (inadimplência): nível e tendência
- Coverage ratio (provisões/NPL)
- NCO (Net Charge-Off rate)
- Composição da carteira de crédito (PF, PJ, corporate)

## Solidez de Capital
- CET1 ratio vs mínimo regulatório
- RWA growth vs capital growth
- Capacidade de distribuição de dividendos/JCP

## Posicionamento
- Market share e tendência
- Vantagens competitivas (funding, relacionamento, tecnologia)
- Exposição macro (juros, câmbio, ciclo de crédito)

Veredito final: EXCELENTE / BOM+ / BOM / NEUTRO / EVITAR`,

  fiis: `Você é um analista especializado em fundos imobiliários e REITs. Analise seguindo:

## Qualidade dos Ativos
- Tipo de ativo (lajes, galpões, shopping, recebíveis, híbrido)
- Localização e qualidade dos imóveis
- Idade e estado de conservação

## Métricas Operacionais
- Taxa de vacância física e financeira
- Prazo médio dos contratos (WAULT)
- Qualidade e diversificação dos locatários
- Índice de inadimplência

## Métricas Financeiras
- Dividend yield anualizado
- P/VP (preço vs valor patrimonial)
- Cap rate implícito
- FFO (Funds From Operations)

## Gestão
- Histórico do gestor
- Alinhamento com cotistas
- Pipeline de novos ativos

Veredito: EXCELENTE / BOM+ / BOM / NEUTRO / EVITAR`,

  tech: `Você é um analista especializado em empresas de tecnologia. Analise seguindo:

## Crescimento
- Revenue growth YoY e tendência
- ARR/MRR e crescimento de assinantes/usuários
- Net Revenue Retention (NRR)

## Unit Economics
- LTV/CAC ratio
- Payback period
- Contribuição marginal por cliente

## Margens e Escalabilidade
- Margem bruta e tendência
- Burn rate e runway (se pre-lucro)
- Path to profitability

## Moat e Competitividade
- Switching costs
- Network effects
- Vantagem tecnológica sustentável

Veredito: EXCELENTE / BOM+ / BOM / NEUTRO / EVITAR`,

  macro: `Você é um economista e estrategista de investimentos. Faça uma análise macro do ativo:

## Sensibilidade Macroeconômica
- Como o ativo performa em cenários de juros altos vs baixos?
- Exposição cambial (USD, EUR, BRL)
- Correlação com commodities ou ciclo econômico

## Posicionamento no Ciclo
- Em que fase do ciclo econômico esse ativo tende a performar melhor?
- Qual o consenso atual de mercado e há divergência relevante?

## Riscos Geopolíticos e Regulatórios
- Exposição a riscos geopolíticos
- Risco regulatório no setor

## Conclusão Estratégica
- O ativo é defensivo, cíclico ou de crescimento?
- Faz sentido no portfólio atual dado o cenário macro?

Veredito: INTERESSANTE AGORA / AGUARDAR / EVITAR NO CICLO ATUAL`,
};

export const analyzeAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      ticker: z.string().min(1).max(20),
      framework: z.string().default("fundamentalista"),
      mode: z.enum(["web", "pdf", "both"]).default("web"),
      pdfBase64: z.string().optional(),
      pdfName: z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");

    const systemPrompt = ANALYSIS_PROMPTS[data.framework] ?? ANALYSIS_PROMPTS.fundamentalista;

    const userMessage: any[] = [];

    // Se tiver PDF, inclui como documento
    if ((data.mode === "pdf" || data.mode === "both") && data.pdfBase64) {
      userMessage.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: data.pdfBase64,
        },
        title: data.pdfName ?? "Documento de análise",
      });
    }

    // Texto da requisição
    const searchContext = data.mode === "web" || data.mode === "both"
      ? `Por favor, use a ferramenta de busca web para encontrar informações recentes sobre ${data.ticker}: últimos resultados trimestrais, notícias relevantes, dados fundamentalistas atualizados. `
      : "";

    userMessage.push({
      type: "text",
      text: `${searchContext}Analise o ativo ${data.ticker} usando o framework solicitado. Seja objetivo, use dados concretos quando disponíveis, e termine com um veredito claro. Responda em português brasileiro.`,
    });

    // Configura ferramentas baseado no modo
    const tools: any[] = [];
    if (data.mode === "web" || data.mode === "both") {
      tools.push({ type: "web_search_20250305", name: "web_search" });
    }

    const body: any = {
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    };

    if (tools.length > 0) body.tools = tools;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const apiData = await response.json();

    // Extrai o texto da resposta (pode ter blocos de tool_use intercalados)
    const resultText = apiData.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    if (!resultText) throw new Error("Nenhuma análise gerada");

    // Salva no histórico
    await supabase.from("asset_analyses").insert({
      user_id: userId,
      ticker: data.ticker,
      framework: data.framework,
      mode: data.mode,
      result: resultText,
    });

    return { ok: true as const, result: resultText };
  });

export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("asset_analyses")
      .select("id, ticker, framework, mode, result, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("asset_analyses")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const askFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      ticker: z.string().min(1).max(20),
      analysisText: z.string(),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");

    const systemPrompt = `Você é um analista financeiro especializado. O usuário acabou de receber uma análise fundamentalista do ativo ${data.ticker} e tem perguntas sobre ela.

Contexto da análise gerada:
---
${data.analysisText.slice(0, 6000)}
---

Responda as perguntas do usuário de forma clara, objetiva e em português brasileiro. Use os dados da análise como base. Se a pergunta for sobre algo não coberto na análise, pode complementar com seu conhecimento geral sobre o ativo ou o setor. Sempre que possível, use exemplos numéricos concretos. Nunca faça recomendações de compra ou venda.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: systemPrompt,
        messages: data.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const apiData = await response.json();
    const answer = apiData.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    if (!answer) throw new Error("Nenhuma resposta gerada");

    return { ok: true as const, answer };
  });

// ---------- Dividends / Proventos ----------

export const listDividends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("dividends")
      .select(`
        *,
        assets(symbol, asset_class)
      `)
      .eq("user_id", userId)
      .order("ex_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      symbol: r.assets?.symbol ?? null,
      asset_class: r.assets?.asset_class ?? null,
    }));
  });

export const saveDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      asset_symbol: z.string().min(1),
      dividend_type: z.string().default("dividendo"),
      ex_date: z.string().nullable().optional(),
      payment_date: z.string().nullable().optional(),
      amount_per_share: z.number().default(0),
      quantity_held: z.number().nullable().optional(),
      ir_withheld: z.number().default(0),
      gross_amount: z.number().nullable().optional(),
      amount: z.number(),
      currency: z.string().default("BRL"),
      notes: z.string().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve asset_id from symbol — cria o ativo automaticamente se não existir
    let { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("symbol", data.asset_symbol)
      .maybeSingle();

    if (!asset) {
      // Infere classe e moeda pelo sufixo do ticker
      const sym = data.asset_symbol.toUpperCase();
      const isFII = sym.endsWith("11") && !["BOVA11","IVVB11","SMAL11","HASH11"].includes(sym);
      const assetClass = isFII ? "reit" : sym.length <= 5 && /[0-9]$/.test(sym) ? "stock" : "etf";
      const currency = data.currency ?? "BRL";

      const { data: newAsset, error: createErr } = await (supabase as any)
        .from("assets")
        .insert({
          symbol: sym,
          name: sym,
          asset_class: assetClass,
          currency,
          country: currency === "BRL" ? "BR" : currency === "EUR" ? "EU" : "US",
          status: "pending",
          requested_by: userId,
        })
        .select("id")
        .single();

      if (createErr) throw new Error(`Erro ao criar ativo "${sym}": ${createErr.message}`);
      asset = newAsset;
    }

    // Usa hoje como data EX se não vier do arquivo
    const today = new Date().toISOString().slice(0, 10);

    const payload = {
      user_id: userId,
      asset_id: asset.id,
      dividend_type: data.dividend_type ?? "dividendo",
      ex_date: data.ex_date ?? today,
      payment_date: data.payment_date || null,
      amount_per_share: data.amount_per_share ?? 0,
      quantity_held: data.quantity_held ?? 0,
      ir_withheld: data.ir_withheld ?? 0,
      gross_amount: data.gross_amount ?? data.amount,
      amount: data.amount,
      currency: data.currency ?? "BRL",
      notes: data.notes || null,
      source: "manual",
    };

    if (data.id) {
      const { error } = await (supabase as any).from("dividends").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabase as any).from("dividends")
        .upsert(payload, { onConflict: "asset_id,ex_date,user_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("dividends").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const parseDividendText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ text: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: `Você é um parser de extratos de proventos de investimentos brasileiros. 
Extraia os dados e retorne APENAS um JSON válido no formato:
{
  "rows": [
    {
      "asset_symbol": "CPTS11",
      "dividend_type": "rendimento",
      "ex_date": "2026-05-12",
      "payment_date": "2026-05-20",
      "amount_per_share": 0.10,
      "quantity_held": 170,
      "ir_withheld": 0,
      "gross_amount": 17.00,
      "amount": 17.00,
      "currency": "BRL"
    }
  ]
}

Tipos válidos: dividendo, jcp, rendimento, amortizacao, bonificacao
Datas no formato YYYY-MM-DD.
Não inclua markdown, apenas JSON puro.`,
        messages: [{ role: "user", content: `Parse este extrato de proventos:

${data.text}` }],
      }),
    });

    if (!response.ok) throw new Error("Erro ao chamar API de IA");
    const apiData = await response.json();
    const text = apiData.content?.[0]?.text ?? "{}";
    try {
      const clean = text.replace(/```json?|```/g, "").trim();
      return JSON.parse(clean);
    } catch {
      throw new Error("Não foi possível interpretar o extrato. Tente reformatar o texto.");
    }
  });

export const importDividendFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      fileBase64: z.string(),
      fileName: z.string(),
      fileType: z.enum(["excel", "pdf"]),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");

    const messages: any[] = [];

    if (data.fileType === "pdf") {
      // PDF — envia como documento direto
      messages.push({
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: data.fileBase64,
            },
            title: data.fileName,
          },
          {
            type: "text",
            text: "Extraia todos os proventos deste documento e retorne APENAS JSON válido conforme o formato especificado.",
          },
        ],
      });
    } else {
      // Excel/CSV — converte base64 para texto e envia como texto
      messages.push({
        role: "user",
        content: `Arquivo Excel/CSV em base64: ${data.fileName}

Conteúdo (base64): ${data.fileBase64.slice(0, 50000)}

Extraia todos os proventos e retorne APENAS JSON válido conforme o formato especificado.`,
      });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: `Você é um parser de extratos de proventos de investimentos brasileiros da B3 e outras bolsas.
Analise o arquivo fornecido e extraia TODOS os proventos encontrados.
Retorne APENAS um JSON válido no formato:
{
  "rows": [
    {
      "asset_symbol": "CPTS11",
      "dividend_type": "rendimento",
      "ex_date": "2026-05-12",
      "payment_date": "2026-05-20",
      "amount_per_share": 0.10,
      "quantity_held": 170,
      "ir_withheld": 0,
      "gross_amount": 17.00,
      "amount": 17.00,
      "currency": "BRL"
    }
  ]
}

Tipos válidos: dividendo, jcp, rendimento, amortizacao, bonificacao
Datas no formato YYYY-MM-DD.
Se não encontrar a quantidade de cotas, use 1 e coloque o valor total em amount_per_share.
Se não houver IR, use 0.
Não inclua markdown, apenas JSON puro.`,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Erro na API: ${err}`);
    }

    const apiData = await response.json();
    const text = apiData.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") ?? "{}";

    try {
      const clean = text.replace(/```json?|```/g, "").trim();
      return JSON.parse(clean);
    } catch {
      throw new Error("Não foi possível interpretar o arquivo. Tente o modo de colar texto.");
    }
  });

// ── adminRunSecurityAudit ─────────────────────────────────────────────────────

export const adminRunSecurityAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica se é admin
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .single();

    if (!roleData) throw new Error("Acesso negado — apenas admins");

    const startedAt = Date.now();
    const findings: Array<{ severity: string; category: string; message: string; detail?: string }> = [];

    const execSQL = async (sql: string) => {
      let data = null, error = null;
      try {
        const result = await supabaseAdmin.rpc("exec_sql" as any, { query: sql });
        data = result.data; error = result.error;
      } catch (_) { /* rpc não disponível */ }
      // Fallback: usa from com raw query
      if (error || !data) return null;
      return data;
    };

    // Helper para queries diretas via REST com service role
    const queryDirect = async (sql: string): Promise<any[] | null> => {
      try {
        const url = `${process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL}/rest/v1/rpc/exec_sql`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
            "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: sql }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return null;
        return res.json().catch(() => null);
      } catch { return null; }
    };

    // Check 1: Tabelas sem RLS
    const noRLS = await queryDirect(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false ORDER BY tablename`
    );
    if (Array.isArray(noRLS)) {
      for (const row of noRLS) {
        findings.push({ severity: "critical", category: "RLS", message: `Tabela '${row.tablename}' sem RLS ativo`, detail: "Todos os dados desta tabela estão acessíveis sem restrição de usuário" });
      }
    }

    // Check 2: Grants anon em tabelas sensíveis
    const anonGrants = await queryDirect(`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = 'anon'
        AND table_name IN ('transactions','dividends','profiles','brokers','portfolio_snapshots','user_strategies','asset_analyses','user_roles','price_fetch_failures')
      ORDER BY table_name, privilege_type
    `);
    if (Array.isArray(anonGrants)) {
      for (const row of anonGrants) {
        findings.push({ severity: "critical", category: "Grants", message: `Role 'anon' tem ${row.privilege_type} em '${row.table_name}'`, detail: "Usuários não autenticados não devem acessar dados sensíveis" });
      }
    }

    // Check 3: Políticas com role 'public'
    const publicPolicies = await queryDirect(`
      SELECT tablename, policyname, cmd FROM pg_policies
      WHERE schemaname = 'public' AND roles::text LIKE '%public%' AND roles::text NOT LIKE '%authenticated%'
    `);
    if (Array.isArray(publicPolicies)) {
      for (const row of publicPolicies) {
        findings.push({ severity: "warning", category: "RLS Policy", message: `Política '${row.policyname}' em '${row.tablename}' usa role 'public'`, detail: "Usar 'authenticated' para restringir a usuários logados" });
      }
    }

    // Check 4: Tabelas com RLS mas sem políticas
    const noPolicies = await queryDirect(`
      SELECT t.tablename FROM pg_tables t
      WHERE t.schemaname = 'public' AND t.rowsecurity = true
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.tablename)
      ORDER BY t.tablename
    `);
    if (Array.isArray(noPolicies)) {
      for (const row of noPolicies) {
        findings.push({ severity: "critical", category: "RLS", message: `Tabela '${row.tablename}' com RLS mas sem políticas`, detail: "RLS sem políticas bloqueia todos os acessos, inclusive legítimos" });
      }
    }

    // Check 5: TRUNCATE/TRIGGER concedidos
    const dangerGrants = await queryDirect(`
      SELECT table_name, privilege_type, grantee FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND privilege_type IN ('TRUNCATE','TRIGGER') AND grantee IN ('anon','authenticated')
      ORDER BY table_name
    `);
    if (Array.isArray(dangerGrants)) {
      for (const row of dangerGrants) {
        findings.push({ severity: "warning", category: "Grants", message: `Role '${row.grantee}' tem ${row.privilege_type} em '${row.table_name}'`, detail: "Permissões destrutivas não devem ser concedidas a usuários da aplicação" });
      }
    }

    // Check 6: Contagem de admins (info)
    const admins = await queryDirect(`
      SELECT u.email FROM user_roles ur JOIN auth.users u ON u.id = ur.user_id WHERE ur.role = 'admin'
    `);
    if (Array.isArray(admins)) {
      findings.push({ severity: "info", category: "Users", message: `${admins.length} admin(s) ativo(s)`, detail: admins.map((r: any) => r.email).join(", ") });
    }

    const durationMs = Date.now() - startedAt;
    const critical = findings.filter(f => f.severity === "critical").length;
    const warnings = findings.filter(f => f.severity === "warning").length;
    const infos = findings.filter(f => f.severity === "info").length;

    // Salva o resultado
    try {
      await (supabaseAdmin as any).from("security_audit_logs").insert({
        duration_ms: durationMs,
        critical_count: critical,
        warning_count: warnings,
        info_count: infos,
        findings,
      });
    } catch (_) { /* ignora erro de log */ }

    return {
      ok: true as const,
      status: critical > 0 ? "critical" : warnings > 0 ? "warning" : "ok",
      summary: { critical, warnings, info: infos, duration_ms: durationMs },
      findings,
    };
  });

// ── adminSyncTreasury ─────────────────────────────────────────────────────────

export const adminSyncTreasury = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica admin
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .single();
    if (!roleData) throw new Error("Acesso negado");

    // Invoca a Edge Function
    const { data, error } = await supabaseAdmin.functions.invoke("sync-treasury-prices", {
      method: "POST",
    });

    if (error) throw new Error(error.message ?? "Erro na Edge Function");
    return data as { ok: boolean; summary: { ok: number; not_found: number; errors: number }; results: any[] };
  });

// ── Valuation (DCF / Fluxo de Caixa Descontado) ────────────────────────────────
// Modelo: projeta N anos de fluxo de caixa (Lucro Líquido ou FCF), traz a valor
// presente, soma o valor terminal em perpetuidade, e divide pelo nº de ações
// para chegar ao "preço-teto" (fair price). Baseado no método Bazin/Buffett.

const valuationInputSchema = z.object({
  assetId: z.string().uuid(),
  method: z.enum(["classic", "buffett", "bazin"]).default("classic"),

  // ── Campos do FCD (clássico e Buffett) — opcionais quando method === "bazin" ──
  discountRate: z.number().min(0.001).max(1).optional(),        // ex: 0.08 = 8%
  perpetuityGrowth: z.number().min(-0.1).max(0.15).optional(),  // ex: 0.025 = 2.5%
  perpetuityDiscountRate: z.number().min(0.001).max(1).optional(),
  baseCashFlow: z.number().optional(),
  cashFlowLabel: z.enum(["Lucro Líquido", "Fluxo de Caixa Livre"]).default("Lucro Líquido"),
  yearlyGrowthRates: z.array(z.number().min(-1).max(2)).max(10).optional(),

  // ── Campos do Método Bazin — obrigatórios quando method === "bazin" ──────────
  desiredYield: z.number().min(0.001).max(1).optional(),  // ex: 0.07 = 7%
  payout: z.number().min(0).max(1).optional(),            // ex: 0.85 = 85%
  projectedProfit: z.number().optional(),                  // lucro projetado total da empresa
  unitMultiplier: z.number().min(1).max(20).default(1),    // ex: 3 para units compostas por 3 ações

  priceAtCalc: z.number().positive(),
  sharesOutstanding: z.number().positive(),
  currency: z.enum(["BRL", "USD", "EUR", "GBP", "JPY"]),
  notes: z.string().max(2000).optional(),
});

// ── Método Bazin (Dividend Yield) ─────────────────────────────────────────────
// Preço Teto = DPA ÷ Yield desejado
// DPA = (Lucro projetado × Payout ÷ Nº de ações) × Multiplicador da unit
// Yield Projetivo = DPA ÷ Cotação atual
// Margem de Segurança = (Preço Teto ÷ Cotação atual) − 1
// Fórmulas calibradas empiricamente contra a plataforma de referência do usuário.
function computeBazin(input: {
  desiredYield: number;
  payout: number;
  projectedProfit: number;
  sharesOutstanding: number;
  unitMultiplier: number;
  priceAtCalc: number;
}) {
  const { desiredYield, payout, projectedProfit, sharesOutstanding, unitMultiplier, priceAtCalc } = input;

  if (desiredYield <= 0) throw new Error("O Dividend Yield desejado deve ser maior que zero");
  if (!sharesOutstanding) throw new Error("Informe o número de ações");

  const dpa = (projectedProfit * payout / sharesOutstanding) * unitMultiplier;
  const fairPrice = dpa / desiredYield;
  const projectedYield = priceAtCalc > 0 ? dpa / priceAtCalc : 0;
  const safetyMargin = priceAtCalc > 0 ? (fairPrice / priceAtCalc) - 1 : 0;
  const fairMarketCap = fairPrice * sharesOutstanding / unitMultiplier;
  const upsidePct = safetyMargin; // mesma métrica, nomenclatura diferente do FCD

  return { dpa, fairPrice, fairMarketCap, projectedYield, safetyMargin, upsidePct };
}

function computeValuation(input: {
  discountRate: number;
  perpetuityGrowth: number;
  perpetuityDiscountRate?: number;
  method?: "classic" | "buffett";
  baseCashFlow: number;
  yearlyGrowthRates: number[];
  priceAtCalc: number;
  sharesOutstanding: number;
}) {
  const { discountRate, baseCashFlow, yearlyGrowthRates, priceAtCalc, sharesOutstanding } = input;
  const method = input.method ?? "classic";
  // Método clássico: perpetuidade usa a mesma taxa dos anos projetados, crescimento positivo normal.
  // Método Buffett (calibrado empiricamente contra a plataforma de referência do usuário):
  //   - taxa de desconto do perpétuo é fixa (ex: 10% — custo de oportunidade do mercado)
  //   - o crescimento perpétuo é aplicado como NEGATIVO (fluxo em declínio no longuíssimo prazo,
  //     compensando a taxa de desconto mais baixa e evitando um valor terminal inflado)
  //   - o valor terminal é descontado por (n-1) anos em vez de n
  const perpDiscountRate = input.perpetuityDiscountRate ?? discountRate;
  const perpetuityGrowth = method === "buffett" ? -Math.abs(input.perpetuityGrowth) : input.perpetuityGrowth;

  if (discountRate <= 0 || perpDiscountRate <= perpetuityGrowth) {
    throw new Error("A taxa de desconto do perpétuo deve ser maior que o crescimento na perpetuidade");
  }

  let cashFlow = baseCashFlow;
  let npvSum = 0;
  const projectedYears: Array<{ year: number; cashFlow: number; growth: number; npv: number }> = [];

  yearlyGrowthRates.forEach((growth, i) => {
    const n = i + 1;
    cashFlow = cashFlow * (1 + growth);
    const npv = cashFlow / Math.pow(1 + discountRate, n);
    npvSum += npv;
    projectedYears.push({ year: n, cashFlow, growth, npv });
  });

  // Valor terminal (perpetuidade) a partir do último fluxo projetado.
  const terminalCashFlow = cashFlow * (1 + perpetuityGrowth);
  const terminalValue = terminalCashFlow / (perpDiscountRate - perpetuityGrowth);
  const n = yearlyGrowthRates.length;
  // Método Buffett desconta o valor terminal por (n-1) anos em vez de n — calibrado
  // empiricamente para bater com a plataforma de referência.
  const terminalDiscountYears = method === "buffett" ? Math.max(n - 1, 1) : n;
  const terminalNpv = terminalValue / Math.pow(1 + perpDiscountRate, terminalDiscountYears);

  const fairMarketCap = npvSum + terminalNpv;
  const fairPrice = fairMarketCap / sharesOutstanding;
  const upsidePct = (fairPrice - priceAtCalc) / priceAtCalc;

  return { fairPrice, fairMarketCap, upsidePct, projectedYears, terminalNpv };
}

function runValuation(data: any) {
  if (data.method === "bazin") {
    if (data.desiredYield == null) throw new Error("Informe o Dividend Yield desejado");
    if (data.projectedProfit == null) throw new Error("Informe o lucro projetado");
    return computeBazin({
      desiredYield: data.desiredYield,
      payout: data.payout ?? 0,
      projectedProfit: data.projectedProfit,
      sharesOutstanding: data.sharesOutstanding,
      unitMultiplier: data.unitMultiplier ?? 1,
      priceAtCalc: data.priceAtCalc,
    });
  }
  if (data.discountRate == null || data.perpetuityGrowth == null || data.baseCashFlow == null || !data.yearlyGrowthRates?.length) {
    throw new Error("Preencha todas as premissas do FCD (taxa de desconto, crescimento, lucro base e anos projetados)");
  }
  return computeValuation({
    discountRate: data.discountRate,
    perpetuityGrowth: data.perpetuityGrowth,
    perpetuityDiscountRate: data.perpetuityDiscountRate,
    method: data.method,
    baseCashFlow: data.baseCashFlow,
    yearlyGrowthRates: data.yearlyGrowthRates,
    priceAtCalc: data.priceAtCalc,
    sharesOutstanding: data.sharesOutstanding,
  });
}

export const calculateValuationPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => valuationInputSchema.omit({ assetId: true, notes: true }).parse(input))
  .handler(async ({ data }) => {
    return runValuation(data);
  });

export const saveValuation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => valuationInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const result = runValuation(data) as any;

    const { error } = await (supabase as any).from("asset_valuations").insert({
      user_id: userId,
      asset_id: data.assetId,
      method: data.method,
      discount_rate: data.discountRate ?? null,
      perpetuity_growth: data.perpetuityGrowth ?? null,
      perpetuity_discount_rate: data.perpetuityDiscountRate ?? null,
      base_cash_flow: data.baseCashFlow ?? null,
      cash_flow_label: data.cashFlowLabel,
      projection_years: data.yearlyGrowthRates?.length ?? null,
      yearly_growth_rates: data.yearlyGrowthRates ?? null,
      desired_yield: data.desiredYield ?? null,
      payout: data.payout ?? null,
      projected_profit: data.projectedProfit ?? null,
      unit_multiplier: data.unitMultiplier ?? 1,
      price_at_calc: data.priceAtCalc,
      shares_outstanding: data.sharesOutstanding,
      currency: data.currency,
      fair_price: result.fairPrice,
      fair_market_cap: result.fairMarketCap,
      upside_pct: result.upsidePct,
      notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, ...result };
  });

export const listValuations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [valRes, assetsRes] = await Promise.all([
      (supabase as any).from("asset_valuations").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("assets").select("id, symbol, name, currency, asset_class"),
    ]);
    if (valRes.error) throw new Error(valRes.error.message);
    const assetById = new Map((assetsRes.data ?? []).map((a: any) => [a.id, a]));

    return (valRes.data ?? []).map((v: any) => {
      const asset = assetById.get(v.asset_id) as any;
      return {
        id: v.id,
        assetId: v.asset_id,
        symbol: asset?.symbol ?? "?",
        name: asset?.name ?? "?",
        assetClass: asset?.asset_class ?? "other",
        method: v.method ?? "classic",
        discountRate: v.discount_rate != null ? Number(v.discount_rate) : null,
        perpetuityGrowth: v.perpetuity_growth != null ? Number(v.perpetuity_growth) : null,
        perpetuityDiscountRate: v.perpetuity_discount_rate != null ? Number(v.perpetuity_discount_rate) : null,
        baseCashFlow: v.base_cash_flow != null ? Number(v.base_cash_flow) : null,
        cashFlowLabel: v.cash_flow_label,
        yearlyGrowthRates: v.yearly_growth_rates ?? null,
        desiredYield: v.desired_yield != null ? Number(v.desired_yield) : null,
        payout: v.payout != null ? Number(v.payout) : null,
        projectedProfit: v.projected_profit != null ? Number(v.projected_profit) : null,
        unitMultiplier: v.unit_multiplier != null ? Number(v.unit_multiplier) : 1,
        priceAtCalc: Number(v.price_at_calc),
        sharesOutstanding: Number(v.shares_outstanding),
        currency: v.currency,
        fairPrice: Number(v.fair_price),
        fairMarketCap: Number(v.fair_market_cap),
        upsidePct: Number(v.upside_pct),
        notes: v.notes,
        createdAt: v.created_at,
      };
    });
  });

export const deleteValuation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("asset_valuations").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ── Liquidez de Criptoativos (CoinMarketCap) ──────────────────────────────────
// Regra de bolso:
//   Volume 24h / Market Cap entre 2% e 4%   → liquidez saudável no curto prazo
//   Volume 7d  / Market Cap entre 10% e 20% → liquidez saudável na semana

export type CryptoLiquidityRow = {
  assetId: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  volume24h: number | null;
  volume7d: number | null;
  ratio24h: number | null;
  ratio7d: number | null;
  status24h: string | null;
  status7d: string | null;
  overallStatus: string | null;
  checkedAt: string | null;
};

export const listCryptoLiquidity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CryptoLiquidityRow[]> => {
    const { supabase } = context;

    const [assetsRes, checksRes] = await Promise.all([
      supabase.from("assets").select("id, symbol, name").eq("asset_class", "crypto").eq("status", "approved"),
      (supabase as any).from("crypto_liquidity_checks").select("*"),
    ]);

    if (assetsRes.error) throw new Error(assetsRes.error.message);

    const checkByAsset = new Map((checksRes.data ?? []).map((c: any) => [c.asset_id, c]));

    // Deduplica por símbolo (o catálogo pode ter o mesmo símbolo em moedas diferentes)
    const seenSymbols = new Set<string>();
    const rows: CryptoLiquidityRow[] = [];

    for (const a of (assetsRes.data ?? [])) {
      const sym = a.symbol.toUpperCase();
      if (seenSymbols.has(sym)) continue;
      seenSymbols.add(sym);

      const check = checkByAsset.get(a.id) as any;
      rows.push({
        assetId: a.id,
        symbol: a.symbol,
        name: a.name ?? a.symbol,
        marketCap: check?.market_cap != null ? Number(check.market_cap) : null,
        volume24h: check?.volume_24h != null ? Number(check.volume_24h) : null,
        volume7d: check?.volume_7d != null ? Number(check.volume_7d) : null,
        ratio24h: check?.ratio_24h != null ? Number(check.ratio_24h) : null,
        ratio7d: check?.ratio_7d != null ? Number(check.ratio_7d) : null,
        status24h: check?.status_24h ?? null,
        status7d: check?.status_7d ?? null,
        overallStatus: check?.overall_status ?? null,
        checkedAt: check?.checked_at ?? null,
      });
    }

    // Ordena: piores primeiro (low > warning > healthy > unknown), depois por market cap desc
    const STATUS_ORDER: Record<string, number> = { low: 0, warning: 1, unknown: 2, healthy: 3 };
    rows.sort((a, b) => {
      const oa = STATUS_ORDER[a.overallStatus ?? "unknown"] ?? 2;
      const ob = STATUS_ORDER[b.overallStatus ?? "unknown"] ?? 2;
      if (oa !== ob) return oa - ob;
      return (b.marketCap ?? 0) - (a.marketCap ?? 0);
    });

    return rows;
  });

export const adminRunCryptoLiquidityCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica admin
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .single();
    if (!roleData) throw new Error("Acesso negado — apenas admins");

    const { data, error } = await supabaseAdmin.functions.invoke("check-crypto-liquidity", {
      method: "POST",
    });
    if (error) throw new Error(error.message ?? "Erro na Edge Function");
    return data as { ok: boolean; summary?: Record<string, number>; error?: string };
  });

export const checkSpecificCryptoAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ symbol: z.string().min(1).max(20) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: result, error } = await supabaseAdmin.functions.invoke("check-crypto-liquidity", {
      method: "POST",
      body: { symbol: data.symbol },
    });

    if (error) throw new Error(error.message ?? "Erro ao verificar o ativo");
    if (!result?.ok) throw new Error(result?.error ?? "Ativo não encontrado");

    return result as { ok: true; symbol: string; name: string; is_new: boolean; overall_status: string };
  });

// ── Maiores Altas / Maiores Baixas ────────────────────────────────────────────
// Compara o preço de fechamento mais recente com o de referência (D-1, D-7 ou
// D-30) para cada ativo que o usuário possui atualmente, ranqueando por variação.

export type PriceMover = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  currentPrice: number;
  referencePrice: number;
  changePct: number;
};

export const getPriceMovers = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ period: z.enum(["day", "week", "month"]).default("day") }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ gainers: PriceMover[]; losers: PriceMover[] }> => {
    const { supabase, userId } = context;

    const [txRes, assetsRes] = await Promise.all([
      supabase.from("transactions").select("asset_id, tx_type, quantity").eq("user_id", userId),
      supabase.from("assets").select("id, symbol, name, asset_class"),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);

    const assetById = new Map((assetsRes.data ?? []).map((a: any) => [a.id, a]));

    // Quantidade líquida por ativo — só entram no ranking ativos que o usuário possui hoje
    const netQty = new Map<string, number>();
    for (const t of (txRes.data ?? [])) {
      if (!t.asset_id) continue;
      const sign = t.tx_type === "sell" ? -1 : t.tx_type === "buy" ? 1 : 0;
      if (sign === 0) continue;
      netQty.set(t.asset_id, (netQty.get(t.asset_id) ?? 0) + sign * Number(t.quantity));
    }
    const heldAssetIds = Array.from(netQty.entries()).filter(([, q]) => q > 1e-8).map(([id]) => id);
    if (!heldAssetIds.length) return { gainers: [], losers: [] };

    const daysBack = data.period === "day" ? 1 : data.period === "week" ? 7 : 30;
    const referenceDate = new Date();
    referenceDate.setDate(referenceDate.getDate() - daysBack);
    const referenceDateStr = referenceDate.toISOString().slice(0, 10);

    const { data: priceRows, error: priceErr } = await supabase
      .from("asset_prices")
      .select("asset_id, close_price, price_date")
      .in("asset_id", heldAssetIds)
      .order("price_date", { ascending: false });
    if (priceErr) throw new Error(priceErr.message);

    // Para cada ativo: preço mais recente + preço mais próximo (igual ou anterior) da data de referência
    const latestByAsset = new Map<string, { price: number; date: string }>();
    const referenceByAsset = new Map<string, { price: number; date: string }>();

    for (const row of (priceRows ?? [])) {
      const id = row.asset_id;
      if (!latestByAsset.has(id)) {
        latestByAsset.set(id, { price: Number(row.close_price), date: row.price_date });
      }
      if (row.price_date <= referenceDateStr && !referenceByAsset.has(id)) {
        referenceByAsset.set(id, { price: Number(row.close_price), date: row.price_date });
      }
    }

    const movers: PriceMover[] = [];
    for (const assetId of heldAssetIds) {
      const asset = assetById.get(assetId);
      const latest = latestByAsset.get(assetId);
      const reference = referenceByAsset.get(assetId);
      if (!asset || !latest || !reference || reference.price <= 0) continue;
      if (latest.date === reference.date) continue; // sem histórico suficiente pro período

      const changePct = ((latest.price - reference.price) / reference.price) * 100;
      movers.push({
        assetId,
        symbol: asset.symbol,
        name: asset.name ?? asset.symbol,
        assetClass: asset.asset_class,
        currentPrice: latest.price,
        referencePrice: reference.price,
        changePct,
      });
    }

    movers.sort((a, b) => b.changePct - a.changePct);
    const gainers = movers.filter(m => m.changePct > 0).slice(0, 5);
    const losers = movers.filter(m => m.changePct < 0).slice(-5).reverse();

    return { gainers, losers };
  });

// ── Desdobramento / Grupamento de Ações (Stock Split) ─────────────────────────
// Ajusta retroativamente todos os lançamentos de compra/venda de um ativo,
// preservando o valor total investido: quantidade × (novo/antigo), preço ÷ (novo/antigo).
// Ex: desdobramento 2:1 (cada 1 ação vira 2) → multiplicador = 2.
//     grupamento 1:5 (cada 5 ações viram 1) → multiplicador = 0.2.

export const applyStockSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    assetId: z.string().uuid(),
    fromQty: z.number().positive(),   // "de" quantas ações antigas
    toQty: z.number().positive(),     // "para" quantas ações novas
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const multiplier = data.toQty / data.fromQty;

    let query = (supabase as any)
      .from("transactions")
      .select("id, quantity, unit_price, occurred_at, tx_type")
      .eq("asset_id", data.assetId)
      .eq("user_id", userId)
      .in("tx_type", ["buy", "sell"]);

    if (data.effectiveDate) {
      query = query.lte("occurred_at", data.effectiveDate);
    }

    const { data: rows, error: fetchErr } = await query;
    if (fetchErr) throw new Error(fetchErr.message);
    if (!rows?.length) {
      throw new Error("Nenhum lançamento de compra/venda encontrado para esse ativo (na data informada).");
    }

    // Atualiza um por um — mantém RLS e evita updates em lote sem controle
    let updated = 0;
    for (const row of rows) {
      const { error: updErr } = await (supabase as any)
        .from("transactions")
        .update({
          quantity: Number(row.quantity) * multiplier,
          unit_price: Number(row.unit_price) / multiplier,
        })
        .eq("id", row.id)
        .eq("user_id", userId);
      if (!updErr) updated++;
    }

    return { ok: true as const, updated, multiplier };
  });

export const adminSyncFundamentals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .single();
    if (!roleData) throw new Error("Acesso negado");

    const { data, error } = await supabaseAdmin.functions.invoke("sync-fundamentals", {
      method: "POST",
    });
    if (error) throw new Error(error.message ?? "Erro na Edge Function");
    return data as { ok: boolean; summary?: Record<string, number>; error?: string };
  });

// ── Cotações de câmbio (para setLiveFxRates no front) ──────────────────────────
// Lê a tabela fx_rates (alimentada pelo cron sync-fx) e devolve as taxas mais
// recentes no formato { BRL: 1, USD: x, EUR: y, ... } — pronto pra alimentar
// convert() via setLiveFxRates(), sem precisar mexer em cada componente que
// já chama convert() pelo app inteiro.
export const getFxRates = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("fx_rates")
    .select("base, quote, rate, rate_date")
    .eq("base", "BRL")
    .order("rate_date", { ascending: false })
    .limit(20); // pega os últimos registros; filtramos o mais recente por moeda abaixo

  if (error) throw new Error(error.message);

  const rates: Record<string, number> = { BRL: 1 };
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.quote)) continue; // já pegamos a linha mais recente dessa moeda
    seen.add(row.quote);
    rates[row.quote] = Number(row.rate);
  }

  const mostRecentDate = data?.[0]?.rate_date ?? null;

  return { rates, asOfDate: mostRecentDate };
});
