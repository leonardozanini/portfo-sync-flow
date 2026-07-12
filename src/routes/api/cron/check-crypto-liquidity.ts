// src/routes/api/cron/check-crypto-liquidity.ts
//
// Cron diário que chama a Edge Function do Supabase para verificar a
// liquidez de todos os criptoativos do catálogo via CoinMarketCap.
//
// Regra de bolso:
//   - Volume 24h / Market Cap entre 2% e 4%  = liquidez saudável no curto prazo
//   - Volume 7d  / Market Cap entre 10% e 20% = liquidez saudável na semana
//
// Rota:  GET /api/cron/check-crypto-liquidity
// Cron:  todo dia às 22:30 UTC (vercel.json) — após o refresh-prices

export default async function handler(): Promise<Response> {
  try {
    console.log("[crypto-liquidity] Chamando Edge Function check-crypto-liquidity...");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin.functions.invoke("check-crypto-liquidity", {
      method: "POST",
    });

    if (error) throw error;

    console.log("[crypto-liquidity] Resultado:", JSON.stringify(data));

    return Response.json({ ok: true, result: data });
  } catch (err: any) {
    console.error("[crypto-liquidity] Erro:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
