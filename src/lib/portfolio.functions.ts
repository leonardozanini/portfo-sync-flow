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

export type GroupedAsset = {
  assetId: string;
  symbol: string;
  name: string | null;
  assetClass: AssetClass;
  currency: CurrencyCode;
  qty: number;
  avgPrice: number;         // native currency
  currentPrice: number;     // native currency
  balanceBRL: number;        // qty * currentPrice converted to BRL
  investedBRL: number;       // total cost basis in BRL
  variation: number;         // % vs avg
  yieldPct: number;          // % gain/loss
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

// ---------- Price refresh helpers ----------
function yahooSymbolFor(symbol: string, currency: CurrencyCode, klass: AssetClass): string {
  const s = symbol.toUpperCase();
  if (klass === "crypto") return `${s}-${currency}`;
  return s;
}

async function fetchYahooPrice(ySymbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Folio/1.0)" },
    });
    if (!res.ok) return null;
    const json = await res.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
    const p = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

// Fallback: faz scraping leve da página configurada em quote_url.
// Usado quando o ativo nunca teve cotação (campo "Atualizado" = Nunca).
async function fetchPriceFromUrl(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Folio/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const patterns: RegExp[] = [
      /"regularMarketPrice"\s*:\s*\{?\s*"raw"\s*:\s*([\d.]+)/i,
      /"price"\s*:\s*"?([\d.,]+)"?/i,
      /data-symbol-last="([\d.,]+)"/i,
      /data-test=["']qsp-price["'][^>]*>\s*([\d.,]+)/i,
      /(?:R\$|US\$|\$|€|£|¥)\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2,6})?)/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        let raw = m[1].trim();
        const hasComma = raw.includes(",");
        const hasDot = raw.includes(".");
        if (hasComma && hasDot) {
          if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
            raw = raw.replace(/\./g, "").replace(",", ".");
          } else {
            raw = raw.replace(/,/g, "");
          }
        } else if (hasComma) {
          raw = raw.replace(",", ".");
        }
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Tenta cotar um ativo. Se nunca foi cotado e tem quote_url, usa o site primeiro.
async function fetchPriceFor(
  a: { symbol: string; asset_class: string; currency: string; quote_url?: string | null },
  neverFetched: boolean,
): Promise<{ price: number | null; source: string }> {
  if (neverFetched && a.quote_url) {
    const p = await fetchPriceFromUrl(a.quote_url);
    if (p != null) return { price: p, source: "url" };
  }
  const ySym = yahooSymbolFor(a.symbol, a.currency as CurrencyCode, a.asset_class as AssetClass);
  const py = await fetchYahooPrice(ySym);
  if (py != null) return { price: py, source: "yahoo" };
  if (!neverFetched && a.quote_url) {
    const pu = await fetchPriceFromUrl(a.quote_url);
    if (pu != null) return { price: pu, source: "url" };
  }
  return { price: null, source: "none" };
}

// ---------- getDashboard ----------
export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { supabase, userId } = context;

    const [txRes, assetsRes, pricesRes, fxRes, rolesRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", userId).order("occurred_at", { ascending: true }),
      supabase.from("assets").select("*"),
      supabase.from("asset_prices").select("asset_id, close_price, price_date, fetched_at").order("fetched_at", { ascending: false }),
      supabase.from("fx_rates").select("base, quote, rate, rate_date").order("rate_date", { ascending: false }),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);

    const txs = txRes.data ?? [];
    const assets = assetsRes.data ?? [];
    const prices = pricesRes.data ?? [];
    const fxRows = fxRes.data ?? [];
    const isAdmin = (rolesRes.data ?? []).some((r) => r.role === "admin");

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
    const equity = buildEquityHistory(txs, toBRL);

    return {
      totalsBRL: {
        patrimonio: totalValueBRL,
        invested: totalInvestedBRL,
        pnl,
        yieldPct,
        dayVariation: 0,
        dividends12m: totalDividends12mBRL,
      },
      allocation,
      equity,
      groups,
    };
  });

function buildEquityHistory(
  txs: Array<{ occurred_at: string; tx_type: string; quantity: number | string; unit_price: number | string; fees: number | string | null; currency: string }>,
  toBRL: (amount: number, cur: CurrencyCode) => number,
) {
  const months = new Map<string, { aplicado: number; ganho: number }>();
  let cumInvested = 0;
  // Last 12 months window
  const start = new Date();
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    months.set(key, { aplicado: 0, ganho: 0 });
  }
  for (const t of txs) {
    const d = new Date(t.occurred_at);
    const cur = t.currency as CurrencyCode;
    const qty = Number(t.quantity);
    const price = Number(t.unit_price);
    const fees = Number(t.fees ?? 0);
    if (t.tx_type === "buy") cumInvested += toBRL(qty * price + fees, cur);
    else if (t.tx_type === "sell") cumInvested -= toBRL(qty * price - fees, cur);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    if (months.has(key)) months.set(key, { aplicado: cumInvested, ganho: 0 });
  }
  // Propagate cum forward
  let last = 0;
  const out: { date: string; aplicado: number; ganho: number }[] = [];
  for (const [date, v] of months) {
    const aplicado = v.aplicado || last;
    last = aplicado;
    out.push({ date, aplicado, ganho: 0 });
  }
  return out;
}

// ---------- createTransaction ----------
const createTxSchema = z.object({
  symbol: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().max(120).optional(),
  assetClass: z.enum(["stock","reit","etf","crypto","fixed_income","fund","cash","other"]),
  txType: z.enum(["buy","sell","dividend","deposit","withdraw"]),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().positive().max(1e12),
  unitPrice: z.number().min(0).max(1e12),
  fees: z.number().min(0).max(1e9).default(0),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
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
      // Ativo não existe: cria como PENDENTE de aprovação pelo admin.
      // O lançamento ainda é registrado normalmente — assim o usuário não perde o trabalho.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const ins = await supabaseAdmin.from("assets").insert({
        symbol,
        name: data.name ?? symbol,
        asset_class: data.assetClass,
        currency: data.currency,
        status: "pending",
        requested_by: userId,
      }).select("id").single();
      if (ins.error) throw new Error(ins.error.message);
      asset = ins.data;
    }

    const { error: tErr } = await supabase.from("transactions").insert({
      user_id: userId,
      asset_id: asset.id,
      tx_type: data.txType,
      occurred_at: data.occurredAt,
      quantity: data.quantity,
      unit_price: data.unitPrice,
      fees: data.fees ?? 0,
      currency: data.currency,
    });
    if (tErr) throw new Error(tErr.message);
    return { ok: true as const };
  });

// ---------- listTransactions ----------
export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [txRes, assetsRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", userId).order("occurred_at", { ascending: false }),
      supabase.from("assets").select("id, symbol, name, asset_class, currency"),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);
    const assetById = new Map((assetsRes.data ?? []).map((a) => [a.id, a]));
    return (txRes.data ?? []).map((t) => {
      const a = assetById.get(t.asset_id);
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
      };
    });
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

export const searchAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      q: z.string().min(1).max(32),
      assetClass: z.enum(["stock","reit","etf","crypto","fixed_income","fund","cash","other"]).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CatalogAsset[]> => {
    const { supabase } = context;
    const q = data.q.trim().toUpperCase();
    let query = supabase.from("assets")
      .select("id, symbol, name, asset_class, currency, status")
      .eq("status", "approved")
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
  assetClass: z.enum(["stock","reit","etf","crypto","fixed_income","fund","cash","other"]),
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
      status: "pending", requested_by: userId,
    }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    return { ok: true as const, id: ins.data.id, status: "pending" };
  });

// ---------- listCatalog (admin) ----------
export type CatalogRow = CatalogAsset & {
  lastPrice: number | null;
  fetchedAt: string | null;
  status: "pending" | "approved";
  dataSource: string | null;
  quoteUrl: string | null;
  requestedBy: string | null;
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
      .order("status", { ascending: true })  // pending primeiro (asc: 'approved' depois)
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
      rows: (rows ?? []).map((r) => ({
        id: r.id, symbol: r.symbol, name: r.name,
        assetClass: r.asset_class as AssetClass, currency: r.currency as CurrencyCode,
        lastPrice: priceMap.get(r.id)?.price ?? null,
        fetchedAt: priceMap.get(r.id)?.fetchedAt ?? null,
        status: (r as { status: "pending" | "approved" }).status,
        dataSource: (r as { data_source: string | null }).data_source ?? null,
        quoteUrl: (r as { quote_url: string | null }).quote_url ?? null,
        requestedBy: (r as { requested_by: string | null }).requested_by ?? null,
      })),
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

const adminCreateSchema = z.object({
  symbol: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(120),
  assetClass: z.enum(["stock","reit","etf","crypto","fixed_income","fund","cash","other"]),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]),
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
    const ins = await supabaseAdmin.from("assets").insert({
      symbol: data.symbol.toUpperCase(),
      name: data.name,
      asset_class: data.assetClass,
      currency: data.currency,
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
  assetClass: z.enum(["stock","reit","etf","crypto","fixed_income","fund","cash","other"]).optional(),
  currency: z.enum(["BRL","USD","EUR","GBP","JPY"]).optional(),
  dataSource: z.string().max(40).optional(),
  quoteUrl: z.string().max(500).optional(),
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
      data_source?: string | null; quote_url?: string | null;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.assetClass) patch.asset_class = data.assetClass;
    if (data.currency) patch.currency = data.currency;
    if (data.dataSource !== undefined) patch.data_source = data.dataSource || null;
    if (data.quoteUrl !== undefined) patch.quote_url = data.quoteUrl || null;
    const upd = await supabaseAdmin.from("assets").update(patch).eq("id", data.id);
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
    // Não deleta se tem transações — apenas mantém pending
    const hasTx = await supabaseAdmin.from("transactions").select("id", { head: true, count: "exact" }).eq("asset_id", data.id);
    if ((hasTx.count ?? 0) > 0) {
      throw new Error("Ativo possui lançamentos. Aprove ou apague-os antes.");
    }
    const del = await supabaseAdmin.from("assets").delete().eq("id", data.id);
    if (del.error) throw new Error(del.error.message);
    return { ok: true as const };
  });

// ---------- refreshAllPrices (called by cron) ----------
export async function refreshAllPricesInternal(): Promise<{ updated: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: txAssetIds } = await supabaseAdmin
    .from("transactions").select("asset_id");
  const heldIds = Array.from(new Set((txAssetIds ?? []).map((t) => t.asset_id)));
  if (heldIds.length === 0) return { updated: 0, failed: 0 };

  const { data: assets } = await supabaseAdmin
    .from("assets").select("id, symbol, asset_class, currency, quote_url")
    .in("id", heldIds)
    .eq("status", "approved");

  // Identifica ativos sem nenhum preço (Atualizado = "Nunca")
  const { data: priceRows } = await supabaseAdmin
    .from("asset_prices").select("asset_id").in("asset_id", (assets ?? []).map((a) => a.id));
  const everFetched = new Set((priceRows ?? []).map((p) => p.asset_id));

  const today = new Date().toISOString().slice(0, 10);
  let updated = 0, failed = 0;
  await Promise.all((assets ?? []).map(async (a) => {
    const neverFetched = !everFetched.has(a.id);
    const { price, source } = await fetchPriceFor(
      { symbol: a.symbol, asset_class: a.asset_class, currency: a.currency, quote_url: a.quote_url },
      neverFetched,
    );
    if (price == null) {
      failed++;
      await supabaseAdmin.from("price_fetch_failures").insert({
        asset_id: a.id, symbol: a.symbol, reason: `cron:${source}:no-data`,
      });
      return;
    }
    await supabaseAdmin.from("asset_prices").insert({
      asset_id: a.id, price_date: today, source, close_price: price,
    });
    updated++;
  }));
  return { updated, failed };
}


