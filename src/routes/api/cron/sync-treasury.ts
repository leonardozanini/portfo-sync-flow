// src/routes/api/cron/sync-treasury.ts
//
// Cron diário que chama a Edge Function do Supabase para
// atualizar o PU dos títulos do Tesouro Direto via CSV oficial
//
// Rota:  GET /api/cron/sync-treasury
// Cron:  todo dia útil às 22:00 UTC (após fechamento do TD às 18h BRT)

export default async function handler(): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";

  if (!supabaseUrl) {
    return Response.json({ ok: false, error: "SUPABASE_URL não configurado" }, { status: 500 });
  }

  try {
    console.log("[sync-treasury] Chamando Edge Function sync-treasury-prices...");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Invoca a Edge Function
    const { data, error } = await supabaseAdmin.functions.invoke("sync-treasury-prices", {
      method: "POST",
    });

    if (error) throw error;

    console.log("[sync-treasury] Resultado:", JSON.stringify(data));

    return Response.json({ ok: true, result: data });
  } catch (err: any) {
    console.error("[sync-treasury] Erro:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
