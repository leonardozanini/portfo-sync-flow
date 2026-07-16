import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus, TrendingUp, TrendingDown, Wallet, PiggyBank, Coins, LineChart as LineIcon,
  ChevronDown, ChevronUp, BarChart3, Settings2, ArrowUpRight, ArrowDownRight,
  CheckCircle2, XCircle, MoreHorizontal, GripVertical, Landmark, Building2, Bitcoin,
  Layers, ListOrdered, Trash2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney, type Currency } from "@/lib/currency";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NewTransactionDialog, type TxPreset } from "@/components/NewTransactionDialog";
import { AssetLotsDialog } from "@/components/AssetLotsDialog";
import { AssetLogo } from "@/components/AssetLogo";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPriceMovers } from "@/lib/portfolio.functions";
import { getDashboard, getDividendSyncQueue, syncAssetDividends, removeAssetFromPortfolio, type AssetClass, type AssetGroup, type GroupedAsset } from "@/lib/portfolio.functions";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const dashboardQueryOptions = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  staleTime: 30_000,
});

// ---------- Error fallback com retry automático de sessão ----------
function DashboardErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  const isAuthError =
    error.message?.toLowerCase().includes("unauthorized") ||
    error.message?.toLowerCase().includes("invalid") ||
    error.message?.toLowerCase().includes("expired");

  useEffect(() => {
    if (!isAuthError) return;

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        reset();
        router.invalidate();
      } else {
        router.navigate({ to: "/login", replace: true });
      }
    });

    return () => { cancelled = true; };
  }, [isAuthError, reset, router]);

  if (isAuthError) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-muted-foreground text-sm">
        Atualizando sessão…
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      Não foi possível carregar o resumo: {error.message}
    </div>
  );
}

// ── Skeleton do Dashboard ────────────────────────────────────────────────────

function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted/60 ${className ?? ""}`}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Botão topo */}
      <div className="flex items-center justify-end">
        <Shimmer className="h-10 w-48 rounded-xl" />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Shimmer className="h-7 w-7 rounded-md" />
              <Shimmer className="h-4 w-28" />
            </div>
            <Shimmer className="h-8 w-36" />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-4 w-24" />
              </div>
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-4 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Evolução do Patrimônio */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Shimmer className="h-5 w-44" />
            <Shimmer className="h-8 w-28 rounded-md" />
          </div>
          <div className="flex items-end gap-1.5 h-[260px] pt-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
                <Shimmer
                  className="w-full rounded-t-md"
                  style={{ height: `${30 + Math.random() * 60}%` } as React.CSSProperties}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Ativos na Carteira */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <Shimmer className="h-5 w-36" />
          <div className="flex flex-col items-center gap-4">
            <Shimmer className="h-[180px] w-[180px] rounded-full" />
            <div className="w-full space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Shimmer className="h-2.5 w-2.5 rounded-sm" />
                    <Shimmer className="h-3.5 w-24" />
                  </div>
                  <Shimmer className="h-3.5 w-10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Meus Ativos */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shimmer className="h-6 w-32" />
          <Shimmer className="h-5 w-8 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Cabeçalho do grupo */}
            <div className="flex items-center gap-4 px-4 py-3">
              <Shimmer className="h-4 w-4 rounded" />
              <Shimmer className="h-9 w-9 rounded-lg" />
              <Shimmer className="h-4 w-24" />
              <div className="hidden md:flex flex-1 items-center justify-around">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="text-center space-y-1">
                    <Shimmer className="h-3 w-16 mx-auto" />
                    <Shimmer className="h-4 w-20 mx-auto" />
                  </div>
                ))}
              </div>
              <Shimmer className="h-8 w-8 rounded-md ml-auto" />
            </div>
            {/* Linhas da tabela */}
            <div className="border-t border-border divide-y divide-border/50">
              {Array.from({ length: i === 0 ? 3 : 2 }).map((_, j) => (
                <div key={j} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex items-center gap-2 w-28">
                    <Shimmer className="h-7 w-7 rounded" />
                    <Shimmer className="h-4 w-16" />
                  </div>
                  <div className="flex-1 grid grid-cols-7 gap-3">
                    {Array.from({ length: 7 }).map((_, k) => (
                      <Shimmer key={k} className="h-4 w-full" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Resumo — Folio" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions),
  component: Dashboard,
  pendingComponent: DashboardSkeleton,
  pendingMs: 0,
  pendingMinMs: 300,
  errorComponent: ({ error, reset }) => (
    <DashboardErrorFallback error={error} reset={reset} />
  ),
  notFoundComponent: () => <div>Não encontrado.</div>,
});

const CLASS_ICONS: Record<AssetClass, React.ComponentType<{ className?: string }>> = {
  stock: Landmark,
  reit: Building2,
  etf: Layers,
  stock_intl: Landmark,
  reit_intl: Building2,
  etf_intl: Layers,
  crypto: Bitcoin,
  fixed_income: PiggyBank,
  fund: Wallet,
  cash: Coins,
  other: Layers,
};

// ── Logo do ativo ────────────────────────────────────────────────────────────
const PIE_COLORS = [
  "#4F8EF7", "#7C5CFC", "#22C97A", "#C9A86A",
  "#38BDF8", "#F0465A", "#A78BFA", "#6B7A9A",
];

// ── Onboarding Modal ──────────────────────────────────────────────────────────

const ONBOARDING_KEY = "folio_onboarding_done";

const STEPS = [
  {
    icon: "📥",
    title: "Adicione seus lançamentos",
    description:
      "Registre suas compras e vendas de ações, FIIs, ETFs, criptomoedas e outros ativos. O Folio busca os preços automaticamente e calcula seu patrimônio em tempo real.",
    action: "Ir para Lançamentos",
    to: "/transactions",
  },
  {
    icon: "💰",
    title: "Registre seus proventos",
    description:
      "Cadastre dividendos, rendimentos de FIIs e JCP recebidos. Você pode importar por PDF, colar o extrato da corretora ou adicionar manualmente.",
    action: "Ir para Proventos",
    to: "/proventos",
  },
  {
    icon: "🎯",
    title: "Defina sua estratégia",
    description:
      "Escolha uma estratégia de alocação (KRAKEN, ARCA, All Weather ou personalize a sua) e veja em tempo real quanto rebalancear em cada classe de ativo.",
    action: "Ir para Estratégia",
    to: "/estrategia",
  },
];

function OnboardingModal({
  open,
  onClose,
  onAddFirst,
}: {
  open: boolean;
  onClose: () => void;
  onAddFirst: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleClose = () => {
    if (typeof window !== "undefined") localStorage.setItem(ONBOARDING_KEY, "1");
    onClose();
  };

  const handleNext = () => {
    if (isLast) {
      handleClose();
    } else {
      setStep((s) => s + 1);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header âmbar */}
        <div className="rounded-t-2xl bg-primary/10 px-6 pt-6 pb-4 text-center border-b border-border">
          <div className="mb-2 text-4xl">{current.icon}</div>
          <h2 className="text-lg font-bold text-foreground">Bem-vindo ao Folio!</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Veja como aproveitar ao máximo sua carteira consolidada.
          </p>
        </div>

        {/* Conteúdo do passo */}
        <div className="px-6 py-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-xl">
              {current.icon}
            </div>
            <h3 className="font-semibold text-foreground">{current.title}</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {current.description}
          </p>
        </div>

        {/* Indicadores de passo */}
        <div className="flex justify-center gap-2 pb-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Pular introdução
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
                Voltar
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                if (step === 0) {
                  handleClose();
                  onAddFirst();
                } else {
                  handleNext();
                }
              }}
            >
              {step === 0 ? "Adicionar primeiro ativo" : isLast ? "Começar!" : "Próximo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const { currency } = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<TxPreset | undefined>(undefined);
  const [lotsAsset, setLotsAsset] = useState<{ id: string; symbol: string } | null>(null);
  const [moversOpen, setMoversOpen] = useState(false);
  const { data } = useSuspenseQuery(dashboardQueryOptions);
  const qc = useQueryClient();

  const [removeAsset, setRemoveAsset] = useState<{ assetId: string; symbol: string; currentPrice: number; currency: string; qty: number } | null>(null);
  const [equityPeriod, setEquityPeriod] = useState<"6" | "12" | "24">("12");

  // Onboarding: mostra só se carteira vazia e nunca viu antes
  const isEmptyPortfolio = data.groups.length === 0;
  const neverSeen = typeof window !== "undefined"
    ? !localStorage.getItem(ONBOARDING_KEY)
    : false;
  const [showOnboarding, setShowOnboarding] = useState(isEmptyPortfolio && neverSeen);

  const openNew = (p?: TxPreset) => { setPreset(p); setOpen(true); };
  const openLots = (a: { id: string; symbol: string }) => setLotsAsset(a);

  const getQueueFn = useServerFn(getDividendSyncQueue);
  const syncAssetFn = useServerFn(syncAssetDividends);
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const queue = await getQueueFn();
        for (const asset of queue) {
          await syncAssetFn({ data: asset }).catch(() => {});
        }
      } catch { /* silent */ }
    }, 3000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" },
        () => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "asset_prices" },
        () => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const t = data.totalsBRL;
  const total = convert(t.patrimonio, currency);
  const invested = convert(t.invested, currency);
  const pnl = total - invested;
  const dividends = convert(t.dividends12m, currency);
  const totalAssets = data.groups.reduce((a, g) => a + g.assets.length, 0);

  return (
    <div className="space-y-6">
      {/* Onboarding */}
      <OnboardingModal
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onAddFirst={() => { setShowOnboarding(false); openNew(); }}
      />

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Patrimônio total</p>
          <p className="text-4xl font-bold tracking-tight tabular-nums text-foreground">
            {formatMoney(total, currency)}
          </p>
        </div>
        <Button onClick={() => openNew()} size="lg" className="rounded-xl folio-gradient text-white border-0 hover:opacity-90">
          <Plus className="mr-2 h-4 w-4" />Adicionar Lançamento
        </Button>
        <NewTransactionDialog open={open} onOpenChange={setOpen} preset={preset} />
        <PriceMoversDialog open={moversOpen} onOpenChange={setMoversOpen} />
        <AssetLotsDialog
          open={!!lotsAsset}
          onOpenChange={(v) => !v && setLotsAsset(null)}
          assetId={lotsAsset?.id ?? null}
          symbol={lotsAsset?.symbol}
        />
        <RemoveAssetDialog
          asset={removeAsset}
          open={!!removeAsset}
          onOpenChange={(v) => !v && setRemoveAsset(null)}
        />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          icon={Coins}
          title="Lucro total"
          value={formatMoney(pnl, currency)}
          valueTone={pnl >= 0 ? "success" : "destructive"}
          twoCols={[
            { label: "Ganho de Capital", value: formatMoney(pnl, currency), tone: pnl >= 0 ? "success" : "destructive" },
            { label: "Dividendos Recebidos", value: formatMoney(dividends, currency) },
          ]}
          onClick={() => setMoversOpen(true)}
        />
        <KpiCard
          icon={PiggyBank}
          title="Proventos Recebidos (12M)"
          value={formatMoney(dividends, currency)}
          subLabel="Total"
          subValue={formatMoney(dividends, currency)}
        />
        <KpiCard
          icon={LineIcon}
          title="Rentabilidade"
          value={`${t.yieldPct >= 0 ? "+" : ""}${t.yieldPct.toFixed(2)}%`}
          valueTone={t.yieldPct >= 0 ? "success" : "destructive"}
          twoCols={[
            {
              label: "Lucro/Prejuízo",
              value: formatMoney(pnl, currency),
              tone: pnl >= 0 ? "success" : "destructive",
            },
            {
              label: "Valor investido",
              value: formatMoney(invested, currency),
            },
          ]}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Evolução do Patrimônio</CardTitle>
            <Select value={equityPeriod} onValueChange={(v) => setEquityPeriod(v as "6" | "12" | "24")}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 Meses</SelectItem>
                <SelectItem value="12">12 Meses</SelectItem>
                <SelectItem value="24">24 Meses</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="h-[320px]">
            {data.equity.length === 0 || data.equity.every((e) => e.aplicado === 0) ? (
              <EmptyChart label="Adicione lançamentos para ver a evolução." />
            ) : (() => {
              const monthsToShow = parseInt(equityPeriod);
              const filteredEquity = data.equity.slice(-monthsToShow);
              const equityData = filteredEquity.map(d => {
                const aplicado = convert(d.aplicado, currency);
                const ganho = convert(d.ganho, currency);
                const patrimonio = aplicado + ganho;
                return {
                  date: d.date,
                  aplicado,
                  patrimonio,
                  // "range area" entre aplicado e patrimônio: Recharts desenha entre [min,max] do array
                  // Quando ganho >= 0: [aplicado, patrimonio] → pinta de verde (patrimônio acima)
                  // Quando ganho < 0: [patrimonio, aplicado] → pinta de vermelho (patrimônio abaixo)
                  rangePos: ganho >= 0 ? [aplicado, patrimonio] : [aplicado, aplicado],
                  rangeNeg: ganho < 0 ? [patrimonio, aplicado] : [aplicado, aplicado],
                  _ganho: ganho,
                };
              });
              const CustomTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const row = equityData.find(d => d.date === label);
                if (!row) return null;
                const { aplicado, patrimonio, _ganho: ganho } = row;
                return (
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", minWidth: 210, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                    <p style={{ color: "#374151", fontSize: 12, marginBottom: 8, fontWeight: 700 }}>{label}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: "#4F8EF7", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Patrimônio</span>
                      <span style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{formatMoney(patrimonio, currency)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: "#C9A86A", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Valor aplicado</span>
                      <span style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{formatMoney(aplicado, currency)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: ganho >= 0 ? "#22C97A" : "#F0465A", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Ganho de Capital</span>
                      <span style={{ color: ganho >= 0 ? "#22C97A" : "#F0465A", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{formatMoney(ganho, currency)}</span>
                    </div>
                  </div>
                );
              };
              return (
                <>
                  <div className="mb-2 flex items-center gap-4 text-xs">
                    <LegendDot color="#C9A86A" label="Valor aplicado" />
                    <LegendDot color="#22C97A" label="Patrimônio acima do aplicado (lucro)" />
                    <LegendDot color="#F0465A" label="Patrimônio abaixo do aplicado (prejuízo)" />
                  </div>
                  <ResponsiveContainer width="100%" height="90%">
                    <AreaChart data={equityData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gGanhoPosFolio" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22C97A" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#22C97A" stopOpacity={0.04} />
                        </linearGradient>
                        <linearGradient id="gGanhoNegFolio" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#F0465A" stopOpacity={0.12} />
                          <stop offset="100%" stopColor="#F0465A" stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="date" fontSize={11} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                      <YAxis fontSize={11} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false}
                        domain={["auto", "auto"]}
                        tickFormatter={(v) => formatMoney(Number(v), currency).replace(/[,.]00$/, "")} />
                      <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />

                      {/* Range area verde: preenche entre aplicado e patrimônio quando patrimônio > aplicado (lucro) */}
                      <Area type="monotone" dataKey="rangePos" stroke="none"
                        fill="url(#gGanhoPosFolio)" isAnimationActive={false} />

                      {/* Range area vermelha: preenche entre patrimônio e aplicado quando patrimônio < aplicado (prejuízo) */}
                      <Area type="monotone" dataKey="rangeNeg" stroke="#F0465A" strokeWidth={1} strokeOpacity={0.4}
                        fill="url(#gGanhoNegFolio)" isAnimationActive={false} />

                      {/* Linha de base: Valor Aplicado (dourado dessaturado) */}
                      <Area type="monotone" dataKey="aplicado" stroke="#C9A86A" strokeWidth={2}
                        fill="none" dot={false} activeDot={false} />

                      {/* Linha do Patrimônio real por cima de tudo */}
                      <Area type="monotone" dataKey="patrimonio" stroke="#4F8EF7" strokeWidth={2.5}
                        fill="none" dot={false} activeDot={{ r: 4, fill: "#4F8EF7" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ativos na Carteira</CardTitle>
          </CardHeader>
          <CardContent className="h-auto min-h-[320px]">
            {data.allocation.length === 0 ? (
              <EmptyChart label="Sem ativos ainda." />
            ) : (
              <div className="flex h-full flex-col items-center gap-4 sm:flex-row">
                <div className="h-[220px] w-full sm:h-[260px] sm:w-1/2 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie data={data.allocation} dataKey="pct" nameKey="name"
                        innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                        {data.allocation.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-full flex-1 space-y-1.5 text-sm">
                  {data.allocation.map((a, i) => (
                    <li key={a.assetClass} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="truncate text-muted-foreground">{a.name}</span>
                      </span>
                      <span className="tabular-nums font-medium">{a.pct.toFixed(2)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Meus Ativos */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Meus Ativos <span className="text-muted-foreground">({totalAssets})</span>
        </h2>
        {data.groups.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum ativo na carteira ainda.{" "}
            <button className="underline text-foreground" onClick={() => openNew()}>Adicionar lançamento</button>.
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {data.groups.map((g) => (
              <AssetGroupCard key={g.assetClass} group={g} currency={currency}
                onAdd={(p) => openNew(p)} onShowLots={openLots} onRemove={setRemoveAsset} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function countryFlag(country: string): string {
  const flags: Record<string, string> = {
    BR: "🇧🇷", US: "🇺🇸", EU: "🇪🇺", GB: "🇬🇧",
    JP: "🇯🇵", DE: "🇩🇪", FR: "🇫🇷", CN: "🇨🇳",
    CA: "🇨🇦", AU: "🇦🇺", WORLD: "🌐",
  };
  return flags[country?.toUpperCase()] ?? "🏳️";
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{label}</div>
  );
}

function KpiCard({
  icon: Icon, title, value, valueTone, delta, subLabel, subValue, subValueTone, twoCols, rightSlot, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  valueTone?: "success" | "destructive";
  delta?: number;
  subLabel?: string;
  subValue?: string;
  subValueTone?: "success" | "destructive";
  twoCols?: { label: string; value: string; tone?: "success" | "destructive" }[];
  rightSlot?: React.ReactNode;
  onClick?: () => void;
}) {
  const toneCls = valueTone === "success" ? "text-success" : valueTone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card
      onClick={onClick}
      className={onClick ? "cursor-pointer transition-colors hover:bg-muted/30" : undefined}
    >
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            {title}
          </div>
          {rightSlot}
        </div>
        <div className={`mt-3 text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
        {typeof delta === "number" && delta !== 0 && (
          <div className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
            delta >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          }`}>
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {delta.toFixed(2)}%
          </div>
        )}
        {twoCols ? (
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            {twoCols.map((c) => (
              <div key={c.label}>
                <div className="text-muted-foreground">{c.label}</div>
                <div className={`tabular-nums font-medium ${
                  c.tone === "success" ? "text-success" : c.tone === "destructive" ? "text-destructive" : ""
                }`}>{c.value}</div>
              </div>
            ))}
          </div>
        ) : subValue !== undefined ? (
          <div className="mt-3 text-xs">
            {subLabel && <div className="text-muted-foreground">{subLabel}</div>}
            <div className={`tabular-nums font-medium ${
              subValueTone === "success" ? "text-success" : subValueTone === "destructive" ? "text-destructive" : ""
            }`}>{subValue}</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

// ---------- RemoveAssetDialog ----------
function RemoveAssetDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: { assetId: string; symbol: string; currentPrice: number; currency: string; qty: number } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const removeFn = useServerFn(removeAssetFromPortfolio);
  const [pending, setPending] = useState<"delete" | "sell" | null>(null);

  if (!asset) return null;

  const handle = async (mode: "delete" | "sell") => {
    setPending(mode);
    try {
      await removeFn({ data: { assetId: asset.assetId, mode } });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["asset-lots"] });
      toast.success(
        mode === "sell"
          ? `Venda de ${asset.symbol} registrada e ativo removido.`
          : `${asset.symbol} e todos os lançamentos foram excluídos.`
      );
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover ativo");
    } finally {
      setPending(null);
    }
  };

  const fmtPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: asset.currency }).format(v);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[90vw] max-w-sm p-6" style={{ zIndex: 9999 }}>
        {/* Título */}
        <AlertDialogHeader className="mb-3">
          <AlertDialogTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4 text-destructive shrink-0" />
            Remover {asset.symbol} da carteira
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            Escolha como deseja remover este ativo:
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Card de informações */}
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm mb-4">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Quantidade</span>
            <span className="font-medium tabular-nums">
              {asset.qty.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Preço atual</span>
            <span className="font-medium tabular-nums">{fmtPrice(asset.currentPrice)}</span>
          </div>
          <div className="flex justify-between py-1 border-t border-border mt-1 pt-2">
            <span className="text-muted-foreground">Valor de venda</span>
            <span className="font-semibold tabular-nums">{fmtPrice(asset.qty * asset.currentPrice)}</span>
          </div>
        </div>

        {/* Botões — sempre empilhados verticalmente */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            disabled={!!pending}
            onClick={() => handle("sell")}
          >
            {pending === "sell"
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <TrendingDown className="mr-2 h-4 w-4" />}
            Registrar venda
          </Button>
          <Button
            variant="outline"
            className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={!!pending}
            onClick={() => handle("delete")}
          >
            {pending === "delete"
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Trash2 className="mr-2 h-4 w-4" />}
            Excluir permanentemente
          </Button>
          <AlertDialogCancel disabled={!!pending} className="w-full mt-1">
            Cancelar
          </AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AssetGroupCard({
  group, currency, onAdd, onShowLots, onRemove,
}: {
  group: AssetGroup;
  currency: Currency;
  onAdd: (preset?: TxPreset) => void;
  onShowLots: (a: { id: string; symbol: string }) => void;
  onRemove: (a: { assetId: string; symbol: string; currentPrice: number; currency: string; qty: number }) => void;
}) {
  const [open, setOpen] = useState(true);
  const Icon = CLASS_ICONS[group.assetClass] ?? Layers;

  return (
    <Card className="overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/40 transition">
            <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-background shrink-0">
              <Icon className="h-4 w-4" />
            </span>
            <div className="font-semibold min-w-[140px] flex items-baseline gap-1.5">
              {group.label}
              <span className="text-sm font-normal text-muted-foreground">({group.assets.length})</span>
            </div>
            <div className="hidden md:flex flex-1 items-center justify-around text-sm">
              <StatMini label="Valor total" value={formatMoney(convert(group.totalValueBRL, currency), currency)} />
              <StatMini label="Variação" value={`${group.variation.toFixed(2)}%`}
                tone={group.variation >= 0 ? "success" : "destructive"} />
              <StatMini label="Rentabilidade" value={`${group.yieldPct.toFixed(2)}%`}
                tone={group.yieldPct >= 0 ? "success" : "destructive"} />
              <StatMini label="% na carteira" value={`${group.pctWallet.toFixed(0)}%`} />
            </div>
            <span className="ml-auto grid h-8 w-8 place-items-center rounded-md border border-border bg-background">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ativo</TableHead>
                    <TableHead className="text-right">Quant.</TableHead>
                    <TableHead className="text-right">Preço Médio</TableHead>
                    <TableHead className="text-right">Preço Atual</TableHead>
                    <TableHead className="text-right">Variação</TableHead>
                    <TableHead className="text-right">Rentabilidade</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">% Carteira</TableHead>
                    <TableHead className="text-center">Comprar?</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.assets.map((a) => (
                    <AssetRow key={a.assetId} a={a} currency={currency}
                      groupValue={group.totalValueBRL}
                      onAdd={onAdd} onShowLots={onShowLots} onRemove={onRemove} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <Button variant="outline" size="sm">
                <BarChart3 className="mr-2 h-4 w-4" />Gráficos
              </Button>
              <Button variant="outline" size="sm">
                <Settings2 className="mr-2 h-4 w-4" />Editar colunas
              </Button>
              <Button size="sm" onClick={() => onAdd()}>
                <Plus className="mr-2 h-4 w-4" />Adicionar Lançamento
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function AssetRow({
  a, currency, groupValue, onAdd, onShowLots, onRemove,
}: {
  a: GroupedAsset; currency: Currency; groupValue: number;
  onAdd: (preset?: TxPreset) => void;
  onShowLots: (a: { id: string; symbol: string }) => void;
  onRemove: (a: { assetId: string; symbol: string; currentPrice: number; currency: string; qty: number }) => void;
}) {
  const pctInGroup = groupValue > 0 ? (a.balanceBRL / groupValue) * 100 : 0;
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <AssetLogo symbol={a.symbol} assetClass={a.assetClass} size={28} />
          <div className="flex flex-col leading-tight">
            <button
              type="button"
              className="font-medium hover:underline text-left"
              onClick={() => onShowLots({ id: a.assetId, symbol: a.symbol })}
            >
              {a.symbol}
            </button>
            <span className="text-[11px] text-muted-foreground" title={a.country}>
              {countryFlag(a.country)}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{a.qty.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(a.avgPrice, a.currency)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(a.currentPrice, a.currency)}</TableCell>
      <TableCell className="text-right">
        <VariationPill
          value={a.variation}
          moneyAmount={(a.currentPrice - a.avgPrice) * a.qty}
          assetCurrency={a.currency as Currency}
          displayCurrency={currency}
        />
      </TableCell>
      <TableCell className="text-right"><Pill value={a.yieldPct} suffix="%" arrow /></TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(convert(a.balanceBRL, currency), currency)}</TableCell>
      <TableCell className="text-right tabular-nums">{pctInGroup.toFixed(2)}%</TableCell>
      <TableCell className="text-center">
        {a.currentPrice <= a.avgPrice ? (
          <Badge variant="outline" className="border-success/40 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" />Sim
          </Badge>
        ) : (
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            <XCircle className="mr-1 h-3 w-3" />Não
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => onAdd({
              symbol: a.symbol, assetClass: a.assetClass, currency: a.currency, lockAsset: true,
            })}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar lançamento de {a.symbol}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onShowLots({ id: a.assetId, symbol: a.symbol })}>
              <ListOrdered className="mr-2 h-4 w-4" />
              Ver lançamentos detalhados
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onClick={() => {
                // Aguarda o DropdownMenu fechar antes de abrir o AlertDialog
                setTimeout(() => onRemove({
                  assetId: a.assetId,
                  symbol: a.symbol,
                  currentPrice: a.currentPrice,
                  currency: a.currency,
                  qty: a.qty,
                }), 100);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover {a.symbol} da carteira
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function StatMini({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "";
  return (
    <div className="text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function Pill({ value, suffix = "", arrow = false }: { value: number; suffix?: string; arrow?: boolean }) {
  const pos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
      pos ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
    }`}>
      {value.toFixed(2)}{suffix}
      {arrow ? (pos ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)
            : (pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
    </span>
  );
}

// Pill de variação com popover — ao passar o mouse (desktop) ou tocar (mobile),
// mostra quanto aquela % representa em valor monetário, na moeda de exibição do Folio.
function VariationPill({
  value, moneyAmount, assetCurrency, displayCurrency,
}: {
  value: number; moneyAmount: number; assetCurrency: Currency; displayCurrency: Currency;
}) {
  const pos = value >= 0;
  const converted = convert(moneyAmount, displayCurrency, assetCurrency);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-block">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums cursor-pointer transition-opacity hover:opacity-80 ${
            pos ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          }`}>
            {value.toFixed(2)}%
            {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto px-3 py-2 text-xs" side="top">
        <p className="text-muted-foreground">Essa variação representa</p>
        <p className={`font-semibold tabular-nums ${pos ? "text-success" : "text-destructive"}`}>
          {pos ? "+" : ""}{formatMoney(converted, displayCurrency)}
        </p>
      </PopoverContent>
    </Popover>
  );
}

// ── Maiores Altas / Maiores Baixas ────────────────────────────────────────────

function PriceMoversDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { currency } = useDisplayCurrency();
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const getMoversFn = useServerFn(getPriceMovers);

  const { data, isLoading } = useQuery({
    queryKey: ["price-movers", period],
    queryFn: () => getMoversFn({ data: { period } }),
    enabled: open,
    staleTime: 60_000,
  });

  const PERIOD_LABEL = { day: "Dia", week: "Semana", month: "Mês" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Maiores Altas e Baixas</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          {(["day", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !data || (data.gainers.length === 0 && data.losers.length === 0) ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Sem dados suficientes pra esse período ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-success mb-2">📈 Maiores Altas</p>
              <div className="space-y-1.5">
                {data.gainers.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma alta no período.</p>
                )}
                {data.gainers.map((m) => (
                  <div key={m.assetId} className="flex items-center justify-between gap-2 rounded-lg bg-success/5 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AssetLogo symbol={m.symbol} assetClass={m.assetClass} size={22} />
                      <span className="font-mono text-sm font-semibold truncate">{m.symbol}</span>
                    </div>
                    <span className="text-sm font-bold text-success shrink-0">+{m.changePct.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2">📉 Maiores Baixas</p>
              <div className="space-y-1.5">
                {data.losers.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma baixa no período.</p>
                )}
                {data.losers.map((m) => (
                  <div key={m.assetId} className="flex items-center justify-between gap-2 rounded-lg bg-destructive/5 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AssetLogo symbol={m.symbol} assetClass={m.assetClass} size={22} />
                      <span className="font-mono text-sm font-semibold truncate">{m.symbol}</span>
                    </div>
                    <span className="text-sm font-bold text-destructive shrink-0">{m.changePct.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          Comparação entre o preço de fechamento mais recente e o fechamento de referência do período — atualizado 1x ao dia.
        </p>
      </DialogContent>
    </Dialog>
  );
}
