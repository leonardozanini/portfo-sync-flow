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
  B3:     { open: 13 * 60,        close: 20 * 60 + 30 }, // 10:00-17:30 BRT
  NYSE:   { open: 14 * 60 + 30,   close: 21 * 60 },      // 09:30-16:00 EST
  NASDAQ: { open: 14 * 60 + 30,   close: 21 * 60 },
  LSE:    { open: 8 * 60,         close: 16 * 60 + 30 }, // 08:00-16:30 GMT
  XETRA:  { open: 8 * 60,         close: 16 * 60 + 30 }, // 08:00-16:30 CET
  TSE:    { open: 0,              close: 6 * 60 },       // 09:00-15:00 JST
  CRYPTO: "always",
  OTHER:  "never",
};

export const MARKET_LABEL: Record<MarketCode, string> = {
  B3: "B3 (Brasil)", NYSE: "NYSE", NASDAQ: "NASDAQ",
  LSE: "LSE (Londres)", TSE: "TSE (Tóquio)", CRYPTO: "Cripto (24/7)", OTHER: "Outro",
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
    if (yahooTicker.includes(".DE") || currency === "EUR") return `${s}:XETRA`;
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

  // International stocks/ETFs: Twelve Data first, then Stooq
  const p = await fetchTwelveDataPrice(twelve);
  if (p != null) return { price: p, source: "twelve" };
  const p2 = await fetchStooqPrice(stooq);
  if (p2 != null) return { price: p2, source: "stooq" };

  return { price: null, source: "none" };
}

// ---------- getDashboard ----------
export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { supabase, userId } = context;

    const [txRes, assetsRes, pricesRes, fxRes, rolesRes, brokersRes, snapshotsRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", userId).order("occurred_at", { ascending: true }),
      supabase.from("assets").select("*"),
      supabase.from("asset_prices").select("asset_id, close_price, price_date, fetched_at").order("fetched_at", { ascending: false }),
      supabase.from("fx_rates").select("base, quote, rate, rate_date").order("rate_date", { ascending: false }),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      (supabase as any).from("brokers").select("id, name, color").eq("user_id", userId),
      supabase.from("portfolio_snapshots").select("snapshot_date, total_value, total_invested, pnl").eq("user_id", userId).order("snapshot_date", { ascending: true }),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);

    const txs = txRes.data ?? [];
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
    let totalDividends12mBRL = 0;
    const since12m = new Date();
    since12m.setMonth(since12m.getMonth() - 12);

    for (const t of txs) {
      const cur = t.currency as CurrencyCode;
      const qty = Number(t.quantity);
      const price = Number(t.unit_price);
      const fees = Number(t.fees ?? 0);
      const occurredAt = new Date(t.occurred_at);

      if (t.tx_type === "dividend") {
        if (occurredAt >= since12m) totalDividends12mBRL += toBRL(qty * price, cur);
        continue;
      }
      if (t.tx_type === "deposit" || t.tx_type === "withdraw") continue;

      const agg = perAsset.get(t.asset_id) ?? { qty: 0, invested: 0, lastPrice: price, currency: cur };
      if (t.tx_type === "buy") {
        agg.qty += qty;
        agg.invested += qty * price + fees;
      } else if (t.tx_type === "sell") {
        const avg = agg.qty > 0 ? agg.invested / agg.qty : price;
        agg.qty -= qty;
        agg.invested -= qty * avg;
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
      const currentPrice = latestPrice.get(assetId) ?? agg.lastPrice;
      const avgPrice = agg.invested / agg.qty;
      const balanceBRL = toBRL(agg.qty * currentPrice, cur);
      const investedBRL = toBRL(agg.invested, cur);
      const yieldPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
      const variation = yieldPct; // placeholder until intraday day-prior data

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
  symbol: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().max(120).optional(),
  assetClass: z.enum(["stock","reit","etf","stock_intl","reit_intl","etf_intl","crypto","fixed_income","fund","cash","other"]),
  txType: z.enum(["buy","sell","dividend","deposit","withdraw"]),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().positive().max(1e12),
  unitPrice: z.number().min(0).max(1e12),
  fees: z.number().min(0).max(1e9).default(0),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
  brokerId: z.string().uuid().optional(),
});

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
  symbol: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
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
const MARKET_ENUM = z.enum(["B3","NYSE","NASDAQ","LSE","TSE","CRYPTO","OTHER"]);

const adminCreateSchema = z.object({
  symbol: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
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
        assets(symbol)
      `)
      .eq("user_id", userId)
      .order("ex_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      symbol: r.assets?.symbol ?? null,
    }));
  });

export const saveDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      asset_symbol: z.string().min(1),
      dividend_type: z.string().default("dividendo"),
      ex_date: z.string(),
      payment_date: z.string().nullable().optional(),
      amount_per_share: z.number().default(0),
      quantity_held: z.number().default(0),
      ir_withheld: z.number().default(0),
      gross_amount: z.number().default(0),
      amount: z.number(),
      currency: z.string().default("BRL"),
      notes: z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve asset_id from symbol
    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("symbol", data.asset_symbol)
      .maybeSingle();

    if (!asset) throw new Error(`Ativo "${data.asset_symbol}" não encontrado. Adicione-o primeiro via lançamento.`);

    const payload = {
      user_id: userId,
      asset_id: asset.id,
      dividend_type: data.dividend_type,
      ex_date: data.ex_date,
      payment_date: data.payment_date || null,
      amount_per_share: data.amount_per_share,
      quantity_held: data.quantity_held,
      ir_withheld: data.ir_withheld,
      gross_amount: data.gross_amount,
      amount: data.amount,
      currency: data.currency,
      notes: data.notes || null,
      source: "manual",
    };

    if (data.id) {
      const { error } = await (supabase as any).from("dividends").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabase as any).from("dividends").insert(payload);
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
