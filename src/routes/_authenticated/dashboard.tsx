import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
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
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney, type Currency } from "@/lib/currency";
import { NewTransactionDialog, type TxPreset } from "@/components/NewTransactionDialog";
import { AssetLotsDialog } from "@/components/AssetLotsDialog";
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

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Resumo — Folio" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions),
  component: Dashboard,
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

const PIE_COLORS = [
  "#3B82F6", "#22D3EE", "#86EFAC", "#FACC15",
  "#FB923C", "#F87171", "#E879F9", "#A78BFA",
];

function Dashboard() {
  const { currency } = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<TxPreset | undefined>(undefined);
  const [lotsAsset, setLotsAsset] = useState<{ id: string; symbol: string } | null>(null);
  const { data } = useSuspenseQuery(dashboardQueryOptions);
  const qc = useQueryClient();

  const [removeAsset, setRemoveAsset] = useState<{ assetId: string; symbol: string; currentPrice: number; currency: string; qty: number } | null>(null);
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
      <div className="flex items-center justify-end">
        <Button onClick={() => openNew()} size="lg" className="rounded-xl">
          <Plus className="mr-2 h-4 w-4" />Adicionar Lançamento
        </Button>
        <NewTransactionDialog open={open} onOpenChange={setOpen} preset={preset} />
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          title="Patrimônio total"
          value={formatMoney(total, currency)}
          delta={t.dayVariation}
          subLabel="Valor investido"
          subValue={formatMoney(invested, currency)}
        />
        <KpiCard
          icon={Coins}
          title="Lucro total"
          value={formatMoney(pnl, currency)}
          valueTone={pnl >= 0 ? "success" : "destructive"}
          twoCols={[
            { label: "Ganho de Capital", value: formatMoney(pnl, currency), tone: pnl >= 0 ? "success" : "destructive" },
            { label: "Dividendos Recebidos", value: formatMoney(dividends, currency) },
          ]}
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
          title="Variação"
          value={`${t.dayVariation > 0 ? "+" : ""}${t.dayVariation.toFixed(2)}%`}
          valueTone={t.dayVariation >= 0 ? "success" : "destructive"}
          rightSlot={
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Rentabilidade</div>
              <div className={`text-lg font-semibold inline-flex items-center gap-1 ${
                t.yieldPct >= 0 ? "text-success" : "text-destructive"
              }`}>
                {t.yieldPct.toFixed(2)}%
                {t.yieldPct >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              </div>
            </div>
          }
          subLabel=""
          subValue={formatMoney(pnl, currency)}
          subValueTone={pnl >= 0 ? "success" : "destructive"}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Evolução do Patrimônio</CardTitle>
            <Select defaultValue="12">
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
              const equityData = data.equity.map(d => {
                const aplicado = convert(d.aplicado, currency);
                const ganho = convert(d.ganho, currency);
                return {
                  date: d.date,
                  aplicado: ganho >= 0 ? aplicado : aplicado,
                  ganhoPos: ganho >= 0 ? ganho : 0,
                  ganhoNeg: ganho < 0 ? ganho : 0,
                  _ganho: ganho,
                };
              });
              const CustomTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const aplicado = payload.find((p: any) => p.dataKey === "aplicado")?.value ?? 0;
                const ganhoPos = payload.find((p: any) => p.dataKey === "ganhoPos")?.value ?? 0;
                const ganhoNeg = payload.find((p: any) => p.dataKey === "ganhoNeg")?.value ?? 0;
                const ganho = ganhoPos + ganhoNeg;
                const patrimonio = aplicado + ganho;
                return (
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", minWidth: 210, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                    <p style={{ color: "#374151", fontSize: 12, marginBottom: 8, fontWeight: 700 }}>{label}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: "#3b82f6", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Patrimônio</span>
                      <span style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{formatMoney(patrimonio, currency)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: "hsl(142 71% 45%)", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Valor aplicado</span>
                      <span style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{formatMoney(aplicado, currency)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: ganho >= 0 ? "hsl(142 71% 75%)" : "#fca5a5", display: "inline-block", flexShrink: 0 }} />
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Ganho de Capital</span>
                      <span style={{ color: ganho >= 0 ? "#16a34a" : "#ef4444", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>{formatMoney(ganho, currency)}</span>
                    </div>
                  </div>
                );
              };
              return (
                <>
                  <div className="mb-2 flex items-center gap-4 text-xs">
                    <LegendDot color="hsl(142 71% 45%)" label="Valor aplicado" />
                    <LegendDot color="hsl(142 71% 75%)" label="Ganho de Capital" />
                  </div>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={equityData} barCategoryGap={10}>
                      <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="date" fontSize={11} stroke="var(--color-muted-foreground)" />
                      <YAxis fontSize={11} stroke="var(--color-muted-foreground)"
                        tickFormatter={(v) => formatMoney(Number(v), currency).replace(/[,.]00$/, "")} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                      <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
                      <Bar dataKey="aplicado" stackId="a" fill="hsl(142 71% 45%)" />
                      <Bar dataKey="ganhoPos" stackId="a" fill="hsl(142 71% 75%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ganhoNeg" fill="#fca5a5" radius={[0, 0, 4, 4]} />
                    </BarChart>
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
  icon: Icon, title, value, valueTone, delta, subLabel, subValue, subValueTone, twoCols, rightSlot,
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
}) {
  const toneCls = valueTone === "success" ? "text-success" : valueTone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-muted">
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
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Remover {asset.symbol} da carteira
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 pt-1">
            <p>Escolha como deseja remover este ativo:</p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quantidade</span>
                <span className="font-medium">{asset.qty.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Preço atual</span>
                <span className="font-medium">{fmtPrice(asset.currentPrice)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 mt-1">
                <span className="text-muted-foreground">Valor de venda</span>
                <span className="font-semibold">{fmtPrice(asset.qty * asset.currentPrice)}</span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
          <AlertDialogCancel disabled={!!pending}>Cancelar</AlertDialogCancel>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={!!pending}
            onClick={() => handle("delete")}
          >
            {pending === "delete" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Excluir permanentemente
          </Button>
          <Button
            className="bg-amber-500 hover:bg-amber-600 text-white"
            disabled={!!pending}
            onClick={() => handle("sell")}
          >
            {pending === "sell" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingDown className="mr-2 h-4 w-4" />}
            Registrar venda
          </Button>
        </AlertDialogFooter>
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
            <div className="font-semibold min-w-[140px]">{group.label}</div>
            <div className="hidden md:flex flex-1 items-center justify-around text-sm">
              <StatMini label="Ativos" value={String(group.assets.length)} />
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
  const initials = a.symbol.slice(0, 2);
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded bg-foreground/10 text-[10px] font-bold">
            {initials}
          </span>
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
      <TableCell className="text-right"><Pill value={a.variation} suffix="%" /></TableCell>
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
              onClick={() => onRemove({
                assetId: a.assetId,
                symbol: a.symbol,
                currentPrice: a.currentPrice,
                currency: a.currency,
                qty: a.qty,
              })}
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
