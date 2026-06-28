import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Database, AlertTriangle, SlidersHorizontal, ShieldCheck, Star, Loader2, ArrowLeft, RefreshCw, Clock, XCircle, CheckCircle2 } from "lucide-react";
import { adminListUsers, adminSetUserRole, forceRefreshPrice } from "@/lib/portfolio.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/admin")({
  head: () => ({ meta: [{ title: "Administração — Folio" }] }),
  component: AdminHome,
});

function AdminHome() {
  const [view, setView] = useState<"home" | "users" | "price-failures">("home");

  if (view === "users") return <UsersPanel onBack={() => setView("home")} />;
  if (view === "price-failures") return <PriceFailuresPanel onBack={() => setView("home")} />;

  const sections = [
    { icon: Users, title: "Usuários e papéis", desc: "Ver contas, atribuir Premium / Admin.", action: () => setView("users") },
    { icon: Database, title: "Catálogo de ativos", desc: "Lista completa de ativos disponíveis para lançamento.", to: "/catalog" as const },
    { icon: AlertTriangle, title: "Falhas de cotação", desc: "Fila de ativos sem preço — defina fonte ou valor manual.", action: () => setView("price-failures") },
    { icon: SlidersHorizontal, title: "Limites Free vs Premium", desc: "Configure quotas e funcionalidades por plano.", to: null },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
        <p className="text-sm text-muted-foreground">Painel do operador do sistema.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => {
          const card = (
            <Card className={(s.to || s.action) ? "transition hover:border-primary/50 hover:shadow-sm cursor-pointer h-full" : "h-full opacity-60"}>
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <s.icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s.desc}</CardContent>
            </Card>
          );

          if (s.action) return (
            <button key={s.title} onClick={s.action} className="block h-full text-left w-full">{card}</button>
          );
          if (s.to) return (
            <Link key={s.title} to={s.to} className="block h-full">{card}</Link>
          );
          return <div key={s.title}>{card}</div>;
        })}
      </div>
    </div>
  );
}

function UsersPanel({ onBack }: { onBack: () => void }) {
  const listFn = useServerFn(adminListUsers);
  const setRoleFn = useServerFn(adminSetUserRole);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });

  const roleMutation = useMutation({
    mutationFn: setRoleFn,
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = (targetUserId: string, role: string, hasRole: boolean) => {
    roleMutation.mutate({ data: { targetUserId, role, action: hasRole ? "remove" : "add" } });
  };

  const fmt = (date: string | null) =>
    date ? new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" /> Usuários
          </h1>
          <p className="text-sm text-muted-foreground">{users.length} conta(s) registrada(s)</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => {
            const isAdmin = u.roles.includes("admin");
            const isPremium = u.roles.includes("premium");
            return (
              <Card key={u.id}>
                <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Criado em {fmt(u.createdAt)} · Último acesso {fmt(u.lastSignIn)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {isAdmin && (
                        <Badge variant="outline" className="border-primary/40 text-primary gap-1">
                          <ShieldCheck className="h-3 w-3" /> Admin
                        </Badge>
                      )}
                      {isPremium && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-600 gap-1">
                          <Star className="h-3 w-3" /> Premium
                        </Badge>
                      )}
                      {!isAdmin && !isPremium && (
                        <Badge variant="outline" className="text-muted-foreground">Free</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant={isPremium ? "destructive" : "outline"}
                      disabled={roleMutation.isPending}
                      onClick={() => toggleRole(u.id, "premium", isPremium)}>
                      {isPremium ? "Remover Premium" : "Dar Premium"}
                    </Button>
                    <Button size="sm" variant={isAdmin ? "destructive" : "outline"}
                      disabled={roleMutation.isPending}
                      onClick={() => toggleRole(u.id, "admin", isAdmin)}>
                      {isAdmin ? "Remover Admin" : "Dar Admin"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── Price Failures Panel ──────────────────────────────────────────────────────

type PriceIssueRow = {
  id: string;
  symbol: string;
  asset_class: string;
  currency: string;
  market: string;
  lastPrice: number | null;
  priceDate: string | null;
  fetchedAt: string | null;
  failReason: string | null;
  failCount: number;
  issue: "never" | "stale" | "failing";
};

function PriceFailuresPanel({ onBack }: { onBack: () => void }) {
  const forceRefreshFn = useServerFn(forceRefreshPrice);
  const qc = useQueryClient();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [manualId, setManualId] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState<string>("");
  const [savingManual, setSavingManual] = useState(false);
  const [batchFilter, setBatchFilter] = useState<"stale" | "failing" | "never" | "all">("stale");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; ok: number; fail: number } | null>(null);

  const { data: issues = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-price-failures"],
    queryFn: async (): Promise<PriceIssueRow[]> => {
      // Busca todos os ativos em carteira de algum usuário
      const { data: assets } = await (supabase as any)
        .from("assets")
        .select("id, symbol, asset_class, currency, market")
        .in("status", ["approved"])
        .order("symbol");

      if (!assets?.length) return [];

      // Busca últimos preços
      const { data: prices } = await (supabase as any)
        .from("asset_prices")
        .select("asset_id, close_price, price_date, fetched_at")
        .order("fetched_at", { ascending: false });

      // Busca falhas recentes (últimos 7 dias)
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: failures } = await (supabase as any)
        .from("price_fetch_failures")
        .select("asset_id, symbol, reason, created_at")
        .gte("created_at", since);

      const priceByAsset = new Map<string, { close_price: number; price_date: string; fetched_at: string }>();
      for (const p of (prices ?? [])) {
        if (!priceByAsset.has(p.asset_id)) priceByAsset.set(p.asset_id, p);
      }

      const failCountByAsset = new Map<string, { count: number; reason: string }>();
      for (const f of (failures ?? [])) {
        const existing = failCountByAsset.get(f.asset_id);
        if (!existing) failCountByAsset.set(f.asset_id, { count: 1, reason: f.reason });
        else existing.count++;
      }

      const now = Date.now();
      const STALE_MS = 48 * 60 * 60 * 1000; // 48h

      const result: PriceIssueRow[] = [];
      for (const a of assets) {
        const price = priceByAsset.get(a.id);
        const fail = failCountByAsset.get(a.id);

        const fetchedAt = price?.fetched_at ? new Date(price.fetched_at).getTime() : null;
        const isStale = fetchedAt ? (now - fetchedAt) > STALE_MS : false;
        const neverFetched = !price;

        if (neverFetched) {
          result.push({ ...a, lastPrice: null, priceDate: null, fetchedAt: null, failReason: fail?.reason ?? null, failCount: fail?.count ?? 0, issue: "never" });
        } else if (fail && fail.count >= 3) {
          result.push({ ...a, lastPrice: price.close_price, priceDate: price.price_date, fetchedAt: price.fetched_at, failReason: fail.reason, failCount: fail.count, issue: "failing" });
        } else if (isStale) {
          result.push({ ...a, lastPrice: price.close_price, priceDate: price.price_date, fetchedAt: price.fetched_at, failReason: fail?.reason ?? null, failCount: fail?.count ?? 0, issue: "stale" });
        }
      }

      return result.sort((a, b) => {
        const order = { never: 0, failing: 1, stale: 2 };
        return order[a.issue] - order[b.issue];
      });
    },
    staleTime: 60_000,
  });

  const handleForce = async (assetId: string) => {
    setRefreshingId(assetId);
    try {
      await forceRefreshFn({ data: { assetId } });
      toast.success("Cotação atualizada via API!");
      refetch();
    } catch (e: any) {
      const msg = e?.message ?? "Erro desconhecido";
      toast.error(`API: ${msg}`, {
        description: "Use 'Inserir manualmente' para definir o preço.",
        duration: 6000,
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleSaveManual = async (assetId: string) => {
    const price = parseFloat(manualPrice.replace(",", "."));
    if (!price || price <= 0) { toast.error("Preço inválido"); return; }
    setSavingManual(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await (supabase as any).from("asset_prices").upsert({
        asset_id: assetId,
        price_date: today,
        close_price: price,
        source: "manual",
        fetched_at: new Date().toISOString(),
      }, { onConflict: "asset_id,price_date" });
      if (error) throw error;
      toast.success(`Preço R$${price.toFixed(2)} salvo!`);
      setManualId(null);
      setManualPrice("");
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSavingManual(false);
    }
  };

  const handleBatch = async () => {
    const BATCH_SIZE = 5;
    const DELAY_MS = 8_000; // 8s entre lotes para respeitar rate limits

    const targets = batchFilter === "all"
      ? issues
      : issues.filter(r => r.issue === batchFilter);

    if (!targets.length) { toast.error("Nenhum ativo no filtro selecionado"); return; }

    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length, ok: 0, fail: 0 });
    let ok = 0; let fail = 0;

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (row) => {
        try {
          await forceRefreshFn({ data: { assetId: row.id } });
          ok++;
        } catch {
          fail++;
        }
      }));
      const done = Math.min(i + BATCH_SIZE, targets.length);
      setBatchProgress({ done, total: targets.length, ok, fail });
      if (done < targets.length) {
        await new Promise(res => setTimeout(res, DELAY_MS));
      }
    }

    setBatchRunning(false);
    toast.success(`Lote concluído: ${ok} atualizados, ${fail} falhas`);
    refetch();
    setTimeout(() => setBatchProgress(null), 4000);
  };

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  const ISSUE_LABEL = {
    never: { label: "Sem cotação", color: "text-destructive", icon: XCircle },
    failing: { label: "Falhas repetidas", color: "text-orange-500", icon: AlertTriangle },
    stale: { label: "Desatualizado", color: "text-yellow-500", icon: Clock },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-6 w-6" /> Falhas de cotação
          </h1>
          <p className="text-sm text-muted-foreground">
            {batchFilter === "all" ? issues.length : issues.filter(r => r.issue === batchFilter).length} ativo(s)
            {batchFilter !== "all" && {
              stale: " desatualizados",
              failing: " com falhas repetidas",
              never: " sem cotação",
            }[batchFilter]}
            {" "}· {issues.length} total
          </p>
        </div>
      </div>

      {/* Batch controls */}
      {!isLoading && issues.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold">Atualização em lote</p>
                <p className="text-xs text-muted-foreground">
                  Lotes de 5 ativos com 8s de intervalo para respeitar os limites das APIs
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filter selector */}
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  {(["stale", "failing", "never", "all"] as const).map((f) => {
                    const labels = { stale: "Desatualizados", failing: "Com falhas", never: "Sem cotação", all: "Todos" };
                    const counts = {
                      stale: issues.filter(r => r.issue === "stale").length,
                      failing: issues.filter(r => r.issue === "failing").length,
                      never: issues.filter(r => r.issue === "never").length,
                      all: issues.length,
                    };
                    return (
                      <button
                        key={f}
                        onClick={() => setBatchFilter(f)}
                        disabled={batchRunning}
                        className={`px-3 py-1.5 transition-colors ${
                          batchFilter === f
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {labels[f]} ({counts[f]})
                      </button>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  onClick={handleBatch}
                  disabled={batchRunning}
                  className="shrink-0"
                >
                  {batchRunning
                    ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Processando…</>
                    : <><RefreshCw className="mr-2 h-3.5 w-3.5" /> Iniciar lote</>
                  }
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            {batchProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {batchProgress.done}/{batchProgress.total} processados
                    {batchProgress.ok > 0 && <span className="text-emerald-500 ml-2">✓ {batchProgress.ok} ok</span>}
                    {batchProgress.fail > 0 && <span className="text-destructive ml-2">✗ {batchProgress.fail} falhas</span>}
                  </span>
                  <span>{Math.round((batchProgress.done / batchProgress.total) * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500 rounded-full"
                    style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analisando ativos…
        </div>
      ) : issues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="font-semibold">Tudo atualizado!</p>
            <p className="text-sm text-muted-foreground">Nenhum ativo com problema de cotação.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(batchFilter === "all" ? issues : issues.filter(r => r.issue === batchFilter)).map((row) => {
            const { label, color, icon: Icon } = ISSUE_LABEL[row.issue];
            const isRefreshing = refreshingId === row.id;
            return (
              <Card key={row.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 pb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex items-center gap-1.5 ${color} shrink-0`}>
                      <Icon className="h-4 w-4" />
                      <span className="text-xs font-medium">{label}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono font-semibold">{row.symbol}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.asset_class} · {row.currency} · {row.market}
                      </p>
                      {row.lastPrice && (
                        <p className="text-xs text-muted-foreground">
                          Último: {row.currency} {Number(row.lastPrice).toFixed(2)} em {fmt(row.fetchedAt)}
                        </p>
                      )}
                      {row.failReason && (
                        <p className="text-xs text-destructive/80 mt-0.5 font-mono truncate max-w-xs">
                          {row.failReason} {row.failCount > 1 ? `(×${row.failCount})` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {manualId === row.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="Ex: 180,81"
                          value={manualPrice}
                          onChange={(e) => setManualPrice(e.target.value)}
                          className="h-8 w-28 text-sm"
                          autoFocus
                        />
                        <Button size="sm" onClick={() => handleSaveManual(row.id)} disabled={savingManual}>
                          {savingManual ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setManualId(null); setManualPrice(""); }}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleForce(row.id)}
                          disabled={isRefreshing || !!refreshingId}
                        >
                          {isRefreshing
                            ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Buscando…</>
                            : <><RefreshCw className="mr-2 h-3.5 w-3.5" /> Buscar via API</>
                          }
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-primary/40 text-primary hover:bg-primary/10"
                          onClick={() => { setManualId(row.id); setManualPrice(""); }}
                        >
                          Inserir manualmente
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
