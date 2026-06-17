import { createClient } from "@supabase/supabase-js";

// ── Handler do cron — chamado pelo Vercel no último dia do mês ───────────────
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

    // Busca todos os usuários com transações
    const { data: users, error: usersErr } = await supabaseAdmin
      .from("transactions")
      .select("user_id")
      .not("user_id", "is", null);

    if (usersErr) throw new Error(usersErr.message);

    const uniqueUsers = [...new Set((users ?? []).map((u: any) => u.user_id))];
    const today = new Date().toISOString().slice(0, 10);
    let saved = 0;

    for (const userId of uniqueUsers) {
      try {
        // Busca transações do usuário
        const { data: txs } = await supabaseAdmin
          .from("transactions")
          .select("asset_id, tx_type, quantity, unit_price, fees, currency")
          .eq("user_id", userId);

        if (!txs?.length) continue;

        // Calcula investido total
        let investedBRL = 0;
        for (const t of txs) {
          const qty = Number(t.quantity);
          const price = Number(t.unit_price);
          const fees = Number(t.fees ?? 0);
          const total = qty * price + fees;

          // Converte para BRL usando fx_rates
          let rate = 1;
          if (t.currency !== "BRL") {
            const { data: fx } = await supabaseAdmin
              .from("fx_rates")
              .select("rate")
              .eq("base", t.currency)
              .eq("quote", "BRL")
              .order("rate_date", { ascending: false })
              .limit(1)
              .maybeSingle();
            rate = fx?.rate ?? 1;
          }

          if (t.tx_type === "buy") investedBRL += total * rate;
          else if (t.tx_type === "sell") investedBRL -= total * rate;
        }

        // Busca preços atuais dos ativos do usuário
        const assetIds = [...new Set(txs.map((t: any) => t.asset_id))];
        const { data: prices } = await supabaseAdmin
          .from("asset_prices")
          .select("asset_id, close_price")
          .in("asset_id", assetIds)
          .order("fetched_at", { ascending: false });

        // Pega o preço mais recente por ativo
        const latestPrices = new Map<string, number>();
        for (const p of (prices ?? [])) {
          if (!latestPrices.has(p.asset_id)) {
            latestPrices.set(p.asset_id, Number(p.close_price));
          }
        }

        // Calcula posição atual por ativo
        const positions = new Map<string, { qty: number; currency: string; assetId: string }>();
        for (const t of txs) {
          const pos = positions.get(t.asset_id) ?? { qty: 0, currency: t.currency, assetId: t.asset_id };
          if (t.tx_type === "buy") pos.qty += Number(t.quantity);
          else if (t.tx_type === "sell") pos.qty -= Number(t.quantity);
          positions.set(t.asset_id, pos);
        }

        // Calcula valor total atual em BRL
        let totalValueBRL = 0;
        for (const [assetId, pos] of positions) {
          if (pos.qty <= 0) continue;
          const price = latestPrices.get(assetId) ?? 0;
          let rate = 1;
          if (pos.currency !== "BRL") {
            const { data: fx } = await supabaseAdmin
              .from("fx_rates")
              .select("rate")
              .eq("base", pos.currency)
              .eq("quote", "BRL")
              .order("rate_date", { ascending: false })
              .limit(1)
              .maybeSingle();
            rate = fx?.rate ?? 1;
          }
          totalValueBRL += pos.qty * price * rate;
        }

        const pnlBRL = totalValueBRL - investedBRL;

        // Salva o snapshot (upsert — se rodar mais de uma vez no dia, atualiza)
        await supabaseAdmin.from("portfolio_snapshots").upsert({
          user_id: userId,
          snapshot_date: today,
          base_currency: "BRL",
          total_value: totalValueBRL,
          total_invested: investedBRL,
          pnl: pnlBRL,
        }, { onConflict: "user_id,snapshot_date" });

        saved++;
      } catch (e: any) {
        console.error(`[snapshot] erro para user ${userId}:`, e.message);
      }
    }

    console.log(`[snapshot-portfolio] ${saved}/${uniqueUsers.length} snapshots salvos em ${today}`);
    return Response.json({ ok: true, saved, date: today });
  } catch (err: any) {
    console.error("[snapshot-portfolio] erro:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
