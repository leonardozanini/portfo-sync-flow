import { createClient } from "@supabase/supabase-js";

// ── Handler do cron — chamado pelo Vercel no último dia do mês ───────────────
//
// Reescrito pra corrigir dois problemas:
// 1. Performance: a versão anterior fazia uma consulta de câmbio SEPARADA pra
//    cada transação/posição em moeda estrangeira (N+1) — com dezenas de
//    lançamentos isso ficava lento o suficiente pra estourar o timeout do
//    Vercel, e o cron simplesmente parava de rodar silenciosamente. Agora
//    busca TODAS as taxas de uma vez só, no início.
// 2. Backfill: aceita um parâmetro opcional ?date=YYYY-MM-DD (ou uma lista de
//    datas) pra gerar snapshots de meses passados usando o PREÇO HISTÓRICO
//    daquele dia (não o preço de hoje) — só considera transações até aquela
//    data. Sem isso, "recuperar" um mês perdido usaria preço atual, o que
//    não é um valor realmente travado.

async function buildFxMap(supabaseAdmin: any, asOfDate: string): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin
    .from("fx_rates")
    .select("base, quote, rate, rate_date")
    .lte("rate_date", asOfDate)
    .order("rate_date", { ascending: false })
    .limit(200); // margem generosa pra cobrir todas as moedas × alguns dias

  const map = new Map<string, number>();
  for (const row of (data ?? [])) {
    const key = `${row.base}->${row.quote}`;
    if (!map.has(key)) map.set(key, Number(row.rate)); // primeira ocorrência = mais recente (já ordenado)
  }
  return map;
}

function getRate(fxMap: Map<string, number>, from: string, to: string): number {
  if (from === to) return 1;
  return fxMap.get(`${from}->${to}`) ?? 1; // fallback conservador se realmente não achar nada
}

async function snapshotOneUser(supabaseAdmin: any, userId: string, asOfDate: string): Promise<boolean> {
  // Só transações até a data alvo — essencial pro backfill de meses passados
  const { data: txs } = await supabaseAdmin
    .from("transactions")
    .select("asset_id, tx_type, quantity, unit_price, fees, currency, occurred_at")
    .eq("user_id", userId)
    .lte("occurred_at", asOfDate);

  if (!txs?.length) return false;

  const fxMap = await buildFxMap(supabaseAdmin, asOfDate);

  // Investido total (até a data alvo)
  let investedBRL = 0;
  for (const t of txs) {
    const qty = Number(t.quantity);
    const price = Number(t.unit_price);
    const fees = Number(t.fees ?? 0);
    const total = qty * price + fees;
    const rate = getRate(fxMap, t.currency, "BRL");
    if (t.tx_type === "buy") investedBRL += total * rate;
    else if (t.tx_type === "sell") investedBRL -= total * rate;
  }

  // Posição por ativo (até a data alvo) — compra soma, venda subtrai, transferência
  // só reduz pela taxa de rede (mesma lógica do resto do Folio)
  const positions = new Map<string, { qty: number; currency: string }>();
  for (const t of txs) {
    const pos = positions.get(t.asset_id) ?? { qty: 0, currency: t.currency };
    if (t.tx_type === "buy") pos.qty += Number(t.quantity);
    else if (t.tx_type === "sell") pos.qty -= Number(t.quantity);
    else if (t.tx_type === "transfer") {
      const feeQty = Number((t as any).metadata?.fee_quantity ?? 0);
      pos.qty -= feeQty;
    }
    positions.set(t.asset_id, pos);
  }

  // Preço de cada ativo NA DATA ALVO (histórico, não o mais recente hoje)
  const assetIds = [...positions.keys()];
  const { data: prices } = await supabaseAdmin
    .from("asset_prices")
    .select("asset_id, close_price, price_date")
    .in("asset_id", assetIds)
    .lte("price_date", asOfDate)
    .order("price_date", { ascending: false });

  const priceAsOf = new Map<string, number>();
  for (const p of (prices ?? [])) {
    if (!priceAsOf.has(p.asset_id)) priceAsOf.set(p.asset_id, Number(p.close_price));
  }

  let totalValueBRL = 0;
  for (const [assetId, pos] of positions) {
    if (pos.qty <= 0) continue;
    const price = priceAsOf.get(assetId) ?? 0;
    const rate = getRate(fxMap, pos.currency, "BRL");
    totalValueBRL += pos.qty * price * rate;
  }

  const pnlBRL = totalValueBRL - investedBRL;

  await supabaseAdmin.from("portfolio_snapshots").upsert({
    user_id: userId,
    snapshot_date: asOfDate,
    base_currency: "BRL",
    total_value: totalValueBRL,
    total_invested: investedBRL,
    pnl: pnlBRL,
  }, { onConflict: "user_id,snapshot_date" });

  return true;
}

export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Datas a processar: por padrão só hoje (uso normal do cron diário no
    // fim do mês); aceita ?dates=2026-06-30,2026-07-31 pra backfill manual.
    const url = new URL(req.url);
    const datesParam = url.searchParams.get("dates");
    const today = new Date().toISOString().slice(0, 10);
    const targetDates = datesParam ? datesParam.split(",").map(d => d.trim()) : [today];

    const { data: users } = await supabaseAdmin
      .from("transactions")
      .select("user_id")
      .not("user_id", "is", null);

    const uniqueUsers = [...new Set((users ?? []).map((u: any) => u.user_id))];
    let saved = 0;

    for (const date of targetDates) {
      for (const userId of uniqueUsers) {
        try {
          const ok = await snapshotOneUser(supabaseAdmin, userId, date);
          if (ok) saved++;
        } catch (e: any) {
          console.error(`[snapshot] erro para user ${userId} em ${date}:`, e.message);
        }
      }
    }

    console.log(`[snapshot-portfolio] ${saved} snapshot(s) salvos para ${targetDates.join(", ")}`);
    return Response.json({ ok: true, saved, dates: targetDates });
  } catch (err: any) {
    console.error("[snapshot-portfolio] erro:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
