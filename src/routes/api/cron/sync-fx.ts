import { createServerFn } from "@tanstack/react-start";
import { getEvent } from "@tanstack/react-start/server";

// Pares que precisamos: sempre em relação ao BRL
const PAIRS = ["USD-BRL", "EUR-BRL", "GBP-BRL", "JPY-BRL"];

interface AwesomeRate {
  code: string;   // ex: "USD"
  codein: string; // ex: "BRL"
  bid: string;    // preço de compra (usamos como referência)
  ask: string;    // preço de venda
}

async function fetchAwesomeRates(): Promise<Map<string, number>> {
  const url = `https://economia.awesomeapi.com.br/json/last/${PAIRS.join(",")}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`AwesomeAPI HTTP ${res.status}`);
  const json = await res.json() as Record<string, AwesomeRate>;

  const rates = new Map<string, number>();
  for (const key of Object.keys(json)) {
    const r = json[key];
    const mid = (parseFloat(r.bid) + parseFloat(r.ask)) / 2;
    if (Number.isFinite(mid) && mid > 0) {
      rates.set(`${r.code}->${r.codein}`, mid);       // ex: USD->BRL = 5.73
      rates.set(`${r.codein}->${r.code}`, 1 / mid);  // ex: BRL->USD = 0.1745
    }
  }
  return rates;
}

// Handler HTTP chamado pelo cron do Vercel — GET /api/cron/sync-fx
export default async function handler(req: Request): Promise<Response> {
  // Valida secret para evitar chamadas não autorizadas
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const rates = await fetchAwesomeRates();
    const today = new Date().toISOString().slice(0, 10);
    const fetchedAt = new Date().toISOString();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rows = Array.from(rates.entries()).map(([pair, rate]) => {
      const [base, quote] = pair.split("->");
      return { base, quote, rate, rate_date: today, fetched_at: fetchedAt };
    });

    const { error } = await supabaseAdmin
      .from("fx_rates")
      .upsert(rows, { onConflict: "base,quote,rate_date" });

    if (error) throw new Error(error.message);

    console.log(`[sync-fx] ${rows.length} taxas atualizadas em ${today}`);
    return Response.json({ ok: true, updated: rows.length, date: today, rates: Object.fromEntries(rates) });
  } catch (err: any) {
    console.error("[sync-fx] erro:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// Server function para sync manual (botão no admin ou dashboard)
export const syncFxRates = createServerFn({ method: "POST" }).handler(async () => {
  const rates = await fetchAwesomeRates();
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const rows = Array.from(rates.entries()).map(([pair, rate]) => {
    const [base, quote] = pair.split("->");
    return { base, quote, rate, rate_date: today, fetched_at: fetchedAt };
  });

  const { error } = await supabaseAdmin
    .from("fx_rates")
    .upsert(rows, { onConflict: "base,quote,rate_date" });

  if (error) throw new Error(error.message);

  return {
    ok: true as const,
    updated: rows.length,
    rates: Object.fromEntries(rates),
  };
});
