// src/routes/api/cron/sync-fundamentals.ts
//
// Cron semanal que busca VPA (Valor Patrimonial por Ação/Cota) e P/VP de todos
// os ativos B3 (ações e FIIs) do catálogo, via Brapi.
//
// Rota:  GET /api/cron/sync-fundamentals
// Cron:  toda segunda-feira às 08:00 UTC (vercel.json)

export default async function handler(): Promise<Response> {
  try {
    console.log("[sync-fundamentals] Chamando Edge Function sync-fundamentals...");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin.functions.invoke("sync-fundamentals", {
      method: "POST",
    });

    if (error) throw error;

    console.log("[sync-fundamentals] Resultado:", JSON.stringify(data));

    return Response.json({ ok: true, result: data });
  } catch (err: any) {
    console.error("[sync-fundamentals] Erro:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
