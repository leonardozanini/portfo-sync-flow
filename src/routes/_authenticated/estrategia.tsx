import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDashboard, listUserStrategies, saveUserStrategy, deleteUserStrategy, type AssetClass } from "@/lib/portfolio.functions";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Minus, Info, Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

// ── Tipos ────────────────────────────────────────────────────────────────────

type StrategyBucket = {
  label: string;
  target: number;
  classes: AssetClass[];
  color: string;
};

type Strategy = {
  id: string;
  name: string;
  description: string;
  buckets: StrategyBucket[];
  isCustom?: boolean;
};

// ── Classes disponíveis para métodos personalizados ──────────────────────────

const AVAILABLE_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "stock",        label: "Ações BR" },
  { value: "reit",         label: "FIIs" },
  { value: "etf",          label: "ETFs" },
  { value: "stock_intl",   label: "Stocks Internacionais" },
  { value: "reit_intl",    label: "REITs Internacionais" },
  { value: "etf_intl",     label: "ETFs Internacionais" },
  { value: "crypto",       label: "Criptomoedas" },
  { value: "fixed_income", label: "Renda Fixa" },
  { value: "cash",         label: "Caixa" },
  { value: "fund",         label: "Fundos" },
  { value: "other",        label: "Outros / Negócios" },
];

const BUCKET_COLORS = [
  "#6366f1","#0ea5e9","#22c55e","#f59e0b","#8b5cf6",
  "#f43f5e","#14b8a6","#fb923c","#a78bfa","#34d399",
];

// ── Métodos pré-definidos ────────────────────────────────────────────────────

const PRESET_STRATEGIES: Strategy[] = [
  {
    id: "kraken",
    name: "KRAKEN",
    description: "K-aixa · R-eal Estate · A-ções BR · K-ripto · E-xterior · N-egócios",
    buckets: [
      { label: "Caixa",           target: 10, classes: ["cash", "fixed_income"],          color: "#6366f1" },
      { label: "Real Estate",     target: 25, classes: ["reit", "reit_intl"],              color: "#0ea5e9" },
      { label: "Ações BR",        target: 25, classes: ["stock"],                          color: "#22c55e" },
      { label: "Cripto",          target:  5, classes: ["crypto"],                         color: "#f59e0b" },
      { label: "Exterior Stocks", target: 25, classes: ["stock_intl", "etf", "etf_intl"], color: "#8b5cf6" },
      { label: "Negócios",        target: 10, classes: ["other", "fund"],                  color: "#f43f5e" },
    ],
  },
  {
    id: "arca",
    name: "ARCA",
    description: "A-ções · R-eal Estate · C-aixa · A-tivos Internacionais",
    buckets: [
      { label: "Ações BR",              target: 25, classes: ["stock"],                                                  color: "#22c55e" },
      { label: "Real Estate",           target: 25, classes: ["reit", "reit_intl"],                                      color: "#0ea5e9" },
      { label: "Caixa",                 target: 25, classes: ["cash", "fixed_income"],                                   color: "#6366f1" },
      { label: "Ativos Internacionais", target: 25, classes: ["stock_intl", "etf", "etf_intl", "crypto", "fund", "other"], color: "#f59e0b" },
    ],
  },
  {
    id: "allweather",
    name: "All Weather",
    description: "Inspirada em Ray Dalio — adaptação brasileira para todos os cenários econômicos",
    buckets: [
      { label: "Ações Globais",        target: 30,   classes: ["stock", "stock_intl", "etf", "etf_intl"], color: "#22c55e" },
      { label: "Renda Fixa (IPCA+)",   target: 55,   classes: ["fixed_income", "cash"],                   color: "#6366f1" },
      { label: "FIIs / Imóveis",       target: 7.5,  classes: ["reit", "reit_intl"],                      color: "#0ea5e9" },
      { label: "Ouro / Commodities",   target: 7.5,  classes: ["other"],                                   color: "#f59e0b" },
    ],
  },
  {
    id: "60_40",
    name: "50/30/20",
    description: "Evolução do clássico 60/40 com uma terceira perna de ativos alternativos",
    buckets: [
      { label: "Ações (crescimento)",  target: 50, classes: ["stock", "stock_intl"],                        color: "#22c55e" },
      { label: "Renda Fixa (segurança)", target: 30, classes: ["fixed_income", "cash"],                     color: "#6366f1" },
      { label: "Alternativos",         target: 20, classes: ["reit", "reit_intl", "etf", "etf_intl", "crypto", "other", "fund"], color: "#f59e0b" },
    ],
  },
];

// ── Query options ─────────────────────────────────────────────────────────────

const dashboardQueryOptions = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  staleTime: 30_000,
});

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/60 ${className ?? ""}`} />;
}

function EstrategiaSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1.5">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="h-4 w-72" />
      </div>

      {/* Seletor de estratégia */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-9 w-28 rounded-lg" />
        ))}
      </div>

      {/* Dois cards lado a lado */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pizza alocação alvo */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <Shimmer className="h-5 w-36" />
          <div className="flex items-center gap-6">
            <Shimmer className="h-[180px] w-[180px] rounded-full shrink-0" />
            <div className="flex-1 space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Shimmer className="h-2.5 w-2.5 rounded-sm" />
                    <Shimmer className="h-3.5 w-28" />
                  </div>
                  <Shimmer className="h-3.5 w-10" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Comparativo atual vs alvo */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <Shimmer className="h-5 w-44" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Shimmer className="h-3.5 w-24" />
                  <Shimmer className="h-3.5 w-16" />
                </div>
                <Shimmer className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabela de rebalanceamento */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border">
          <Shimmer className="h-5 w-48" />
        </div>
        <div className="divide-y divide-border/50">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <Shimmer className="h-4 w-32" />
              <div className="flex-1 grid grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Shimmer key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/estrategia")({
  head: () => ({ meta: [{ title: "Estratégia — Folio" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions),
  component: StrategyPage,
  pendingComponent: EstrategiaSkeleton,
  pendingMs: 0,
  pendingMinMs: 300,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function GapPill({ gap }: { gap: number }) {
  if (Math.abs(gap) < 0.5) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      <Minus className="h-3 w-3" /> No alvo
    </span>
  );
  const pos = gap > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
      pos ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
    }`}>
      {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pos ? "+" : ""}{gap.toFixed(1)}%
    </span>
  );
}

// ── Dialog de criação/edição de método personalizado ─────────────────────────

type CustomBucket = { label: string; target: string; classes: AssetClass[]; color: string };

function StrategyDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Strategy | null;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveUserStrategy);
  const [name, setName] = useState(editing?.name ?? "");
  const [buckets, setBuckets] = useState<CustomBucket[]>(
    editing?.buckets.map((b) => ({ ...b, target: String(b.target) })) ?? [
      { label: "", target: "", classes: [], color: BUCKET_COLORS[0] },
    ]
  );

  const total = buckets.reduce((s, b) => s + (parseFloat(b.target) || 0), 0);
  const isValid = name.trim() && Math.abs(total - 100) < 0.01 && buckets.every((b) => b.label && b.classes.length > 0);

  const addBucket = () => setBuckets((prev) => [
    ...prev,
    { label: "", target: "", classes: [], color: BUCKET_COLORS[prev.length % BUCKET_COLORS.length] },
  ]);

  const removeBucket = (i: number) => setBuckets((prev) => prev.filter((_, j) => j !== i));

  const updateBucket = (i: number, patch: Partial<CustomBucket>) =>
    setBuckets((prev) => prev.map((b, j) => j === i ? { ...b, ...patch } : b));

  const toggleClass = (i: number, cls: AssetClass) => {
    const current = buckets[i].classes;
    const next = current.includes(cls) ? current.filter((c) => c !== cls) : [...current, cls];
    updateBucket(i, { classes: next });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      await saveFn({
        data: {
          id: editing?.id,
          name: name.trim(),
          buckets: buckets.map((b) => ({
            label: b.label,
            target: parseFloat(b.target),
            classes: b.classes,
            color: b.color,
          })),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-strategies"] });
      toast.success(editing ? "Método atualizado!" : "Método criado!");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar método" : "Criar método personalizado"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome do método</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Minha Estratégia" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Classes de ativos</label>
              <span className={`text-sm font-semibold tabular-nums ${
                Math.abs(total - 100) < 0.01 ? "text-emerald-500" : total > 100 ? "text-red-500" : "text-muted-foreground"
              }`}>
                {total.toFixed(1)} / 100%
              </span>
            </div>

            {buckets.map((bucket, i) => (
              <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bucket.color}
                    onChange={(e) => updateBucket(i, { color: e.target.value })}
                    className="h-7 w-7 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <Input
                    value={bucket.label}
                    onChange={(e) => updateBucket(i, { label: e.target.value })}
                    placeholder="Nome da classe"
                    className="flex-1 h-8 text-sm"
                  />
                  <div className="relative w-20">
                    <Input
                      type="number"
                      min={0} max={100} step={0.5}
                      value={bucket.target}
                      onChange={(e) => updateBucket(i, { target: e.target.value })}
                      className="h-8 text-sm pr-5"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeBucket(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_CLASSES.map((cls) => (
                    <button
                      key={cls.value}
                      onClick={() => toggleClass(i, cls.value)}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        bucket.classes.includes(cls.value)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {cls.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addBucket} className="w-full">
              <Plus className="mr-2 h-3.5 w-3.5" /> Adicionar classe
            </Button>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}>
            {mutation.isPending ? "Salvando…" : <><Check className="mr-2 h-4 w-4" /> Salvar método</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

function StrategyPage() {
  const { data } = useSuspenseQuery(dashboardQueryOptions);
  const { currency } = useDisplayCurrency();
  const qc = useQueryClient();
  const listFn = useServerFn(listUserStrategies);
  const deleteFn = useServerFn(deleteUserStrategy);

  const { data: customStrategies = [] } = useQuery({
    queryKey: ["user-strategies"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const allStrategies: Strategy[] = [
    ...PRESET_STRATEGIES,
    ...(customStrategies as any[]).map((s: any) => ({
      id: s.id,
      name: s.name,
      description: "Método personalizado",
      buckets: s.buckets,
      isCustom: true,
    })),
  ];

  const [selectedId, setSelectedId] = useState<string>("kraken");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null);

  const strategy = allStrategies.find((s) => s.id === selectedId) ?? allStrategies[0];
  const totalBRL = data.totalsBRL.patrimonio;

  const bucketData = strategy.buckets.map((bucket) => {
    const valueBRL = data.allocation
      .filter((a) => bucket.classes.includes(a.assetClass))
      .reduce((sum, a) => sum + a.valueBRL, 0);
    const currentPct = totalBRL > 0 ? (valueBRL / totalBRL) * 100 : 0;
    const gap = currentPct - bucket.target;
    const diffBRL = valueBRL - totalBRL * (bucket.target / 100);
    return { ...bucket, valueBRL, currentPct, gap, diffBRL };
  });

  const currentPieData = bucketData.filter((b) => b.currentPct > 0).map((b) => ({ name: b.label, value: parseFloat(b.currentPct.toFixed(2)), color: b.color }));
  const targetPieData = strategy.buckets.map((b) => ({ name: b.label, value: b.target, color: b.color }));

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteFn({ data: { id: deleteTarget.id } });
    qc.invalidateQueries({ queryKey: ["user-strategies"] });
    if (selectedId === deleteTarget.id) setSelectedId("kraken");
    setDeleteTarget(null);
    toast.success("Método excluído.");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estratégia</h1>
          <p className="text-sm text-muted-foreground mt-1">Compare sua carteira com um método de alocação</p>
        </div>

        {/* Seletor de método */}
        <div className="flex flex-wrap gap-2">
          {allStrategies.map((s) => (
            <div key={s.id} className="relative group">
              <button
                onClick={() => setSelectedId(s.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  selectedId === s.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {s.name}
              </button>
              {s.isCustom && (
                <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
                  <button
                    onClick={() => { setEditing(s); setDialogOpen(true); }}
                    className="h-4 w-4 rounded-full bg-primary text-primary-foreground grid place-items-center"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s)}
                    className="h-4 w-4 rounded-full bg-destructive text-destructive-foreground grid place-items-center"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Criar método
          </Button>
        </div>
      </div>

      {/* Descrição */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{strategy.name}: </span>
            {strategy.description}
          </p>
        </CardContent>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { title: "Carteira Atual", data: currentPieData, isTarget: false },
          { title: `Alvo — ${strategy.name}`, data: targetPieData, isTarget: true },
        ].map(({ title, data: pieData, isTarget }) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="h-[160px] w-[160px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v.toFixed(isTarget ? 0 : 2)}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex-1 space-y-1.5 text-xs min-w-0">
                  {(isTarget ? strategy.buckets : bucketData).map((b, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: b.color }} />
                        <span className="truncate text-muted-foreground">{b.label}</span>
                      </span>
                      <span className="tabular-nums font-medium shrink-0">
                        {isTarget ? `${(b as StrategyBucket).target}%` : `${(b as any).currentPct.toFixed(1)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Análise de Rebalanceamento</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Classe", "Atual", "Alvo", "Gap", "Valor Atual", "Ação necessária"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bucketData.map((b) => (
                  <tr key={b.label} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: b.color }} />
                        <span className="font-medium">{b.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.currentPct.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{b.target}%</td>
                    <td className="px-4 py-3 text-right"><GapPill gap={b.gap} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(convert(b.valueBRL, currency), currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.abs(b.gap) < 0.5 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : b.gap > 0 ? (
                        <span className="text-red-500 font-medium">Vender {formatMoney(convert(Math.abs(b.diffBRL), currency), currency)}</span>
                      ) : (
                        <span className="text-emerald-500 font-medium">Comprar {formatMoney(convert(Math.abs(b.diffBRL), currency), currency)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="px-4 py-3 font-semibold" colSpan={4}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold" colSpan={2}>
                    {formatMoney(convert(totalBRL, currency), currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cards por classe */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {bucketData.map((b) => (
          <Card key={b.label} className={`border ${Math.abs(b.gap) < 0.5 ? "border-border" : b.gap > 0 ? "border-red-500/30" : "border-emerald-500/30"}`}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: b.color }} />
                  <span className="text-xs font-medium text-muted-foreground truncate">{b.label}</span>
                </div>
                <GapPill gap={b.gap} />
              </div>
              <div className="text-xl font-bold tabular-nums">{b.currentPct.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">alvo: {b.target}%</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  width: `${Math.min(100, (b.currentPct / Math.max(b.target * 1.5, b.currentPct + 1)) * 100)}%`,
                  background: b.color,
                }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialog criar/editar */}
      <StrategyDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}
        editing={editing}
      />

      {/* Dialog excluir */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent className="w-[90vw] max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete}>Excluir</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
