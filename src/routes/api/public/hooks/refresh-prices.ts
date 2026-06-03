import { createFileRoute } from "@tanstack/react-router";
import { refreshAllPricesInternal } from "@/lib/portfolio.functions";

// Cron-acionado: refresh de cotações de todos ativos com transações.
// Protegido pelo apikey == SUPABASE_PUBLISHABLE_KEY para evitar abuso público.
export const Route = createFileRoute("/api/public/hooks/refresh-prices")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const result = await refreshAllPricesInternal();
          return new Response(JSON.stringify({ ok: true, ...result, at: new Date().toISOString() }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown";
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
