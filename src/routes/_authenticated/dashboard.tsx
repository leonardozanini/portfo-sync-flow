import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, TrendingDown, Wallet, PiggyBank } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney } from "@/lib/currency";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Visão geral — Folio" }] }),
  component: Dashboard,
});

// Mock data in BRL — replaced by getDashboard server fn once the price engine is online.
const MOCK_EQUITY_BRL = [
  { date: "Jan", value: 120_000 }, { date: "Fev", value: 124_500 },
  { date: "Mar", value: 119_800 }, { date: "Abr", value: 132_400 },
  { date: "Mai", value: 141_200 }, { date: "Jun", value: 148_900 },
  { date: "Jul", value: 155_300 }, { date: "Ago", value: 161_700 },
];
const MOCK_ALLOCATION = [
  { name: "Ações", value: 42 },
  { name: "REITs", value: 18 },
  { name: "Cripto", value: 15 },
  { name: "Renda Fixa", value: 20 },
  { name: "Caixa", value: 5 },
];
const TOTAL_BRL = 161_700;
const INVESTED_BRL = 138_400;

function Dashboard() {
  const { currency } = useDisplayCurrency();
  const total = convert(TOTAL_BRL, currency);
  const invested = convert(INVESTED_BRL, currency);
  const pnl = total - invested;
  const pnlPct = (pnl / invested) * 100;

  const equityData = MOCK_EQUITY_BRL.map((p) => ({ ...p, value: convert(p.value, currency) }));
  const colors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Sua carteira consolidada em {currency}.</p>
        </div>
        <Button asChild><Link to="/transactions"><Plus className="mr-2 h-4 w-4" />Novo lançamento</Link></Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi title="Patrimônio total" value={formatMoney(total, currency)} icon={Wallet} />
        <Kpi title="Valor investido" value={formatMoney(invested, currency)} icon={PiggyBank} />
        <Kpi
          title="Lucro / Prejuízo"
          value={formatMoney(pnl, currency)}
          sub={`${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`}
          tone={pnl >= 0 ? "success" : "destructive"}
          icon={pnl >= 0 ? TrendingUp : TrendingDown}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Evolução do patrimônio</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12}
                  tickFormatter={(v) => formatMoney(Number(v), currency).replace(/\D00$/, "")} />
                <Tooltip formatter={(v: number) => formatMoney(v, currency)} />
                <Line type="monotone" dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Alocação por classe</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={MOCK_ALLOCATION} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                  {MOCK_ALLOCATION.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                </Pie>
                <Legend />
                <Tooltip formatter={(v: number) => `${v}%`} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Ativos por categoria</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Adicione lançamentos para ver a tabela de ativos detalhada aqui.{" "}
            <Link to="/transactions" className="text-foreground underline">Ir para lançamentos →</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  title, value, sub, tone, icon: Icon,
}: { title: string; value: string; sub?: string; tone?: "success" | "destructive"; icon: React.ComponentType<{ className?: string }> }) {
  const toneCls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{title}</span>
          <Icon className={`h-4 w-4 ${toneCls}`} />
        </div>
        <div className={`mt-2 text-2xl font-bold ${toneCls}`}>{value}</div>
        {sub && <div className={`mt-1 text-xs ${toneCls}`}>{sub}</div>}
      </CardContent>
    </Card>
  );
}
