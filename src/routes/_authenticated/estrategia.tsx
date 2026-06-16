import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getDashboard, type AssetClass } from "@/lib/portfolio.functions";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadialBarChart, RadialBar, PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";

// ── Definição dos métodos ────────────────────────────────────────────────────

type StrategyBucket = {
  label: string;
  target: number; // percentual alvo (0-100)
  classes: AssetClass[];
  color: string;
};

type Strategy = {
  id: string;
  name: string;
  description: string;
  buckets: StrategyBucket[];
};

const STRATEGIES: Strategy[] = [
  {
    id: "kraken",
    name: "Método KRAKEN",
    description: "K-aixa · R-eal Estate · A-ções BR · K-ripto · E-xterior · N-egócios",
    buckets: [
      { label: "Caixa",            target: 10, classes: ["cash", "fixed_income"],                    color: "#6366f1" },
      { label: "Real Estate",      target: 25, classes: ["reit", "reit_intl"],                       color: "#0ea5e9" },
      { label: "Ações BR",         target: 25, classes: ["stock"],                                   color: "#22c55e" },
      { label: "Cripto",           target:  5, classes: ["crypto"],                                  color: "#f59e0b" },
      { label: "Exterior Stocks",  target: 25, classes: ["stock_intl", "etf", "etf_intl"],           color: "#8b5cf6" },
      { label: "Negócios",         target: 10, classes: ["other", "fund"],                           color: "#f43f5e" },
    ],
  },
  {
    id: "arca",
    name: "Método ARCA",
    description: "A-ções · R-eal Estate · C-aixa · A-tivos Internacionais",
    buckets: [
      { label: "Ações BR",                target: 25, classes: ["stock"],                                                            color: "#22c55e" },
      { label: "Real Estate",             target: 25, classes: ["reit", "reit_intl"],                                                color: "#0ea5e9" },
      { label: "Caixa",                   target: 25, classes: ["cash", "fixed_income"],                                             color: "#6366f1" },
      { label: "Ativos Internacionais",   target: 25, classes: ["stock_intl", "etf", "etf_intl", "crypto", "fund", "other"],         color: "#f59e0b" },
    ],
  },
];

const dashboardQueryOptions = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  staleTime: 30_000,
});

export const Route = createFileRoute("/_authenticated/estrategia")({
  head: () => ({ meta: [{ title: "Estratégia — Folio" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions),
  component: StrategyPage,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#6366f1","#0ea5e9","#22c55e","#f59e0b","#8b5cf6","#f43f5e","#14b8a6","#fb923c"];

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

// ── Componente principal ─────────────────────────────────────────────────────

function StrategyPage() {
  const { data } = useSuspenseQuery(dashboardQueryOptions);
  const { currency } = useDisplayCurrency();
  const [selectedStrategy, setSelectedStrategy] = useState<string>("kraken");

  const strategy = STRATEGIES.find((s) => s.id === selectedStrategy)!;
  const totalBRL = data.totalsBRL.patrimonio;

  // Calcula valor atual de cada bucket
  const bucketData = strategy.buckets.map((bucket) => {
    const valueBRL = data.allocation
      .filter((a) => bucket.classes.includes(a.assetClass))
      .reduce((sum, a) => sum + a.valueBRL, 0);

    const currentPct = totalBRL > 0 ? (valueBRL / totalBRL) * 100 : 0;
    const gap = currentPct - bucket.target;
    const targetValueBRL = totalBRL * (bucket.target / 100);
    const diffBRL = valueBRL - targetValueBRL;

    return {
      ...bucket,
      valueBRL,
      currentPct,
      gap,
      targetValueBRL,
      diffBRL,
    };
  });

  // Dados para o gráfico de pizza atual
  const currentPieData = bucketData
    .filter((b) => b.currentPct > 0)
    .map((b) => ({ name: b.label, value: parseFloat(b.currentPct.toFixed(2)), color: b.color }));

  // Dados para o gráfico de pizza alvo
  const targetPieData = strategy.buckets.map((b) => ({
    name: b.label, value: b.target, color: b.color,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estratégia</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare sua carteira atual com o método de alocação escolhido
          </p>
        </div>

        {/* Selector de método */}
        <div className="flex gap-2">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStrategy(s.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                selectedStrategy === s.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Descrição do método */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <Info className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{strategy.name}:</span>{" "}
            {strategy.description}
          </p>
        </CardContent>
      </Card>

      {/* Gráficos lado a lado */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Carteira Atual</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="h-[180px] w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={currentPieData} dataKey="value" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                      {currentPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex-1 space-y-1.5 text-xs">
                {bucketData.map((b) => (
                  <li key={b.label} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: b.color }} />
                      <span className="truncate text-muted-foreground">{b.label}</span>
                    </span>
                    <span className="tabular-nums font-medium">{b.currentPct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Alocação Alvo — {strategy.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="h-[180px] w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={targetPieData} dataKey="value" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                      {targetPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v.toFixed(0)}%`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex-1 space-y-1.5 text-xs">
                {strategy.buckets.map((b) => (
                  <li key={b.label} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: b.color }} />
                      <span className="truncate text-muted-foreground">{b.label}</span>
                    </span>
                    <span className="tabular-nums font-medium">{b.target}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de gaps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Análise de Rebalanceamento</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Classe</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Atual</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Alvo</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gap</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Valor Atual</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ação necessária</th>
                </tr>
              </thead>
              <tbody>
                {bucketData.map((b, i) => (
                  <tr key={b.label} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: b.color }} />
                        <span className="font-medium">{b.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.currentPct.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{b.target}%</td>
                    <td className="px-4 py-3 text-right">
                      <GapPill gap={b.gap} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(convert(b.valueBRL, currency), currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.abs(b.gap) < 0.5 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : b.gap > 0 ? (
                        <span className="text-red-500 font-medium">
                          Vender {formatMoney(convert(Math.abs(b.diffBRL), currency), currency)}
                        </span>
                      ) : (
                        <span className="text-emerald-500 font-medium">
                          Comprar {formatMoney(convert(Math.abs(b.diffBRL), currency), currency)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="px-4 py-3 font-semibold" colSpan={4}>Total patrimônio</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold" colSpan={2}>
                    {formatMoney(convert(totalBRL, currency), currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {bucketData.map((b) => (
          <Card key={b.label} className={`border ${
            Math.abs(b.gap) < 0.5
              ? "border-border"
              : b.gap > 0
              ? "border-red-500/30"
              : "border-emerald-500/30"
          }`}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
                  <span className="text-xs font-medium text-muted-foreground">{b.label}</span>
                </div>
                <GapPill gap={b.gap} />
              </div>
              <div className="text-lg font-bold tabular-nums">{b.currentPct.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">alvo: {b.target}%</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (b.currentPct / Math.max(b.target * 1.5, b.currentPct + 1)) * 100)}%`,
                    background: b.color,
                  }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>0%</span>
                <span className="text-foreground font-medium">alvo {b.target}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
