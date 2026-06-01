import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
  Plus, TrendingUp, TrendingDown, Wallet, PiggyBank, Coins, LineChart as LineIcon,
  ChevronDown, ChevronUp, BarChart3, Settings2, ArrowUpRight, ArrowDownRight,
  CheckCircle2, XCircle, MoreHorizontal, GripVertical, Landmark, Building2, Bitcoin,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney, type Currency } from "@/lib/currency";
import { NewTransactionDialog } from "@/components/NewTransactionDialog";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Resumo — Folio" }] }),
  component: Dashboard,
});

// ---------- Mock data (BRL base) ----------
const EQUITY_BRL = [
  { date: "05/25", aplicado: 9000,  ganho: 800 },
  { date: "06/25", aplicado: 10500, ganho: 1100 },
  { date: "07/25", aplicado: 11800, ganho: 900 },
  { date: "08/25", aplicado: 13200, ganho: 1400 },
  { date: "09/25", aplicado: 14100, ganho: 1700 },
  { date: "10/25", aplicado: 15400, ganho: 1500 },
  { date: "11/25", aplicado: 16800, ganho: 1900 },
  { date: "12/25", aplicado: 16200, ganho: 1200 },
  { date: "01/26", aplicado: 19400, ganho: 2200 },
  { date: "02/26", aplicado: 21200, ganho: 2600 },
  { date: "03/26", aplicado: 23100, ganho: 2900 },
  { date: "04/26", aplicado: 22800, ganho: 2400 },
  { date: "05/26", aplicado: 22631, ganho: -405 },
];

const ALLOCATION = [
  { name: "FIIs",          value: 39.16, color: "#3B82F6" },
  { name: "Ações",         value: 27.23, color: "#22D3EE" },
  { name: "Criptos",       value: 14.20, color: "#86EFAC" },
  { name: "Stocks",        value: 10.25, color: "#FACC15" },
  { name: "Fundos",        value:  7.00, color: "#FB923C" },
  { name: "Tesouro Direto",value:  1.33, color: "#F87171" },
  { name: "Reits",         value:  0.83, color: "#E879F9" },
];

type Asset = {
  symbol: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  variation: number;        // % vs day prior
  yieldPct: number;         // % rentabilidade total
  balance: number;          // qty * currentPrice (BRL)
  rating: number;           // 0-10
  pctWallet: number;
  pctIdeal: number;
  buy: boolean;
  initial: string;          // 2-letter for badge
  badgeColor: string;
};

type Group = {
  id: "acoes" | "fiis" | "criptos";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pctIdeal: number;
  assets: Asset[];
};

const GROUPS: Group[] = [
  {
    id: "acoes",
    label: "Ações",
    icon: Landmark,
    pctIdeal: 35,
    assets: [
      { symbol: "BBSE3", qty: 83, avgPrice: 35.38, currentPrice: 35.40, variation: 0.06, yieldPct: 12.78, balance: 2938.20, rating: 10, pctWallet: 13.22, pctIdeal: 7.00, buy: false, initial: "BB", badgeColor: "#FACC15" },
      { symbol: "BBAS3", qty: 50, avgPrice: 22.65, currentPrice: 20.30, variation: -10.39, yieldPct: -6.82, balance: 1015.00, rating: 10, pctWallet: 4.57, pctIdeal: 7.00, buy: true, initial: "BB", badgeColor: "#FACC15" },
      { symbol: "ITSA4", qty: 70, avgPrice: 11.32, currentPrice: 12.92, variation: 14.18, yieldPct: 32.88, balance: 904.40, rating: 10, pctWallet: 4.07, pctIdeal: 7.00, buy: true, initial: "IT", badgeColor: "#1E3A8A" },
      { symbol: "BRBI11", qty: 55, avgPrice: 16.71, currentPrice: 15.98, variation: -4.38, yieldPct: 30.90, balance: 878.90, rating: 10, pctWallet: 3.95, pctIdeal: 7.00, buy: true, initial: "BR", badgeColor: "#1E40AF" },
      { symbol: "LAVV3", qty: 27, avgPrice: 12.86, currentPrice: 11.72, variation: -8.90, yieldPct: 26.24, balance: 316.44, rating: 10, pctWallet: 1.42, pctIdeal: 7.00, buy: true, initial: "LA", badgeColor: "#A16207" },
    ],
  },
  {
    id: "fiis",
    label: "FIIs",
    icon: Building2,
    pctIdeal: 40,
    assets: [
      { symbol: "HGLG11", qty: 20, avgPrice: 165.00, currentPrice: 172.40, variation: 1.20, yieldPct: 14.50, balance: 3448.00, rating: 9, pctWallet: 15.51, pctIdeal: 10.00, buy: false, initial: "HG", badgeColor: "#0F766E" },
      { symbol: "KNRI11", qty: 15, avgPrice: 142.30, currentPrice: 138.10, variation: -0.80, yieldPct: 8.20, balance: 2071.50, rating: 9, pctWallet: 9.32, pctIdeal: 10.00, buy: true, initial: "KN", badgeColor: "#7C3AED" },
      { symbol: "MXRF11", qty: 180, avgPrice: 10.05, currentPrice: 10.45, variation: 3.10, yieldPct: 18.34, balance: 1881.00, rating: 8, pctWallet: 8.46, pctIdeal: 10.00, buy: false, initial: "MX", badgeColor: "#DC2626" },
      { symbol: "XPLG11", qty: 12, avgPrice: 96.20, currentPrice: 108.62, variation: 4.10, yieldPct: 22.10, balance: 1303.44, rating: 9, pctWallet: 5.86, pctIdeal: 10.00, buy: false, initial: "XP", badgeColor: "#0F172A" },
    ],
  },
  {
    id: "criptos",
    label: "Criptomoedas",
    icon: Bitcoin,
    pctIdeal: 5,
    assets: [
      { symbol: "BTC", qty: 0.025, avgPrice: 320000, currentPrice: 285000, variation: -3.20, yieldPct: -10.94, balance: 7125.00, rating: 9, pctWallet: 9.84, pctIdeal: 3.00, buy: true, initial: "BT", badgeColor: "#F59E0B" },
      { symbol: "ETH", qty: 0.4, avgPrice: 14200, currentPrice: 12800, variation: -2.10, yieldPct: -9.86, balance: 5120.00, rating: 8, pctWallet: 7.07, pctIdeal: 1.50, buy: false, initial: "ET", badgeColor: "#4F46E5" },
      { symbol: "SOL", qty: 8, avgPrice: 950, currentPrice: 720, variation: -5.50, yieldPct: -24.21, balance: 5760.00, rating: 7, pctWallet: 7.95, pctIdeal: 0.50, buy: false, initial: "SO", badgeColor: "#7C3AED" },
    ],
  },
];

const TOTAL_BRL = 22226.21;
const INVESTED_BRL = 22631.20;
const PROVENTOS_12M_BRL = 1319.63;
const DIVIDENDOS_BRL = 1518.20;
const DAY_VAR_PCT = -1.79;
const TOTAL_YIELD_PCT = 29.07;

function Dashboard() {
  const { currency } = useDisplayCurrency();
  const [open, setOpen] = useState(false);

  const total = convert(TOTAL_BRL, currency);
  const invested = convert(INVESTED_BRL, currency);
  const pnl = total - invested;
  const proventos = convert(PROVENTOS_12M_BRL, currency);
  const dividendos = convert(DIVIDENDOS_BRL, currency);

  return (
    <div className="space-y-6">
      {/* Tabs row + CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {["Resumo", "Proventos", "Patrimônio", "Rentabilidade", "Metas", "Análise", "Lançamentos"].map((t, i) => (
            <button
              key={t}
              className={`rounded-md px-3 py-1.5 transition ${
                i === 0
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
          <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-600 dark:text-amber-400">PRO</Badge>
        </nav>
        <Button onClick={() => setOpen(true)} size="lg" className="rounded-xl">
          <Plus className="mr-2 h-4 w-4" />Adicionar Lançamento
        </Button>
        <NewTransactionDialog open={open} onOpenChange={setOpen} />
      </div>

      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          title="Patrimônio total"
          value={formatMoney(total, currency)}
          delta={DAY_VAR_PCT}
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
            { label: "Dividendos Recebidos", value: formatMoney(dividendos, currency) },
          ]}
        />
        <KpiCard
          icon={PiggyBank}
          title="Proventos Recebidos (12M)"
          value={formatMoney(proventos, currency)}
          subLabel="Total"
          subValue={formatMoney(dividendos, currency)}
        />
        <KpiCard
          icon={LineIcon}
          title="Variação"
          value={`${DAY_VAR_PCT > 0 ? "+" : ""}${DAY_VAR_PCT.toFixed(2)}%`}
          valueTone={DAY_VAR_PCT >= 0 ? "success" : "destructive"}
          rightSlot={
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Rentabilidade</div>
              <div className="text-lg font-semibold text-success inline-flex items-center gap-1">
                {TOTAL_YIELD_PCT.toFixed(2)}% <ArrowUpRight className="h-4 w-4" />
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
            <div className="flex gap-2">
              <Select defaultValue="12">
                <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 Meses</SelectItem>
                  <SelectItem value="12">12 Meses</SelectItem>
                  <SelectItem value="24">24 Meses</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="all">
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="acoes">Ações</SelectItem>
                  <SelectItem value="fiis">FIIs</SelectItem>
                  <SelectItem value="cripto">Criptos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="h-[320px]">
            <div className="mb-2 flex items-center gap-4 text-xs">
              <LegendDot color="hsl(142 71% 45%)" label="Valor aplicado" />
              <LegendDot color="hsl(142 71% 75%)" label="Ganho de Capital" />
            </div>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={EQUITY_BRL.map(d => ({
                date: d.date,
                aplicado: convert(d.aplicado, currency),
                ganho: convert(d.ganho, currency),
              }))} barCategoryGap={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" fontSize={11} stroke="var(--color-muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--color-muted-foreground)"
                  tickFormatter={(v) => formatMoney(Number(v), currency).replace(/[,.]00$/, "")} />
                <Tooltip
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8 }}
                  formatter={(v: number) => formatMoney(v, currency)}
                />
                <Bar dataKey="aplicado" stackId="a" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="ganho" stackId="a" fill="hsl(142 71% 75%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Ativos na Carteira</CardTitle>
            <Select defaultValue="all">
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="h-[320px]">
            <div className="flex h-full items-center gap-4">
              <ResponsiveContainer width="55%" height="100%">
                <PieChart>
                  <Pie data={ALLOCATION} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} strokeWidth={0}>
                    {ALLOCATION.map((a, i) => <Cell key={i} fill={a.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="flex-1 space-y-1.5 text-sm">
                {ALLOCATION.map((a) => (
                  <li key={a.name} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: a.color }} />
                      <span className="truncate text-muted-foreground">{a.name}</span>
                    </span>
                    <span className="tabular-nums font-medium">{a.value.toFixed(2)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Meus Ativos */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Meus Ativos{" "}
          <span className="text-muted-foreground">
            ({GROUPS.reduce((a, g) => a + g.assets.length, 0)})
          </span>
        </h2>
        <div className="space-y-3">
          {GROUPS.map((g) => (
            <AssetGroupCard key={g.id} group={g} currency={currency} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------- KPI ----------
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
        {typeof delta === "number" && (
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

// ---------- Asset group card ----------
function AssetGroupCard({ group, currency }: { group: Group; currency: Currency }) {
  const [open, setOpen] = useState(group.id === "acoes");
  const totalValue = group.assets.reduce((a, x) => a + x.balance, 0);
  const avgVariation =
    group.assets.reduce((a, x) => a + x.variation, 0) / group.assets.length;
  const avgYield =
    group.assets.reduce((a, x) => a + x.yieldPct, 0) / group.assets.length;
  const pctWallet = group.assets.reduce((a, x) => a + x.pctWallet, 0);
  const Icon = group.icon;

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
              <StatMini label="Valor total" value={formatMoney(convert(totalValue, currency), currency)} />
              <StatMini label="Variação" value={`${avgVariation.toFixed(2)}%`} tone={avgVariation >= 0 ? "success" : "destructive"} />
              <StatMini label="Rentabilidade" value={`${avgYield.toFixed(2)}%`} tone={avgYield >= 0 ? "success" : "destructive"} />
              <StatMini label="% na carteira" value={`${pctWallet.toFixed(0)}% / ${group.pctIdeal}%`} />
            </div>
            <ChevronDownToggle open={open} />
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
                    <TableHead className="text-center">Nota</TableHead>
                    <TableHead className="text-right">% Carteira</TableHead>
                    <TableHead className="text-right">% Ideal</TableHead>
                    <TableHead className="text-center">Comprar?</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.assets.map((a) => (
                    <TableRow key={a.symbol}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="grid h-7 w-7 place-items-center rounded text-[10px] font-bold text-white"
                            style={{ background: a.badgeColor }}
                          >
                            {a.initial}
                          </span>
                          <span className="font-medium">{a.symbol}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{a.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(convert(a.avgPrice, currency), currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(convert(a.currentPrice, currency), currency)}</TableCell>
                      <TableCell className="text-right">
                        <Pill value={a.variation} suffix="%" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Pill value={a.yieldPct} suffix="%" arrow />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(convert(a.balance, currency), currency)}</TableCell>
                      <TableCell className="text-center">
                        <span className="inline-grid h-7 w-7 place-items-center rounded bg-foreground text-[11px] font-bold text-background">{a.rating}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{a.pctWallet.toFixed(2)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{a.pctIdeal.toFixed(2)}%</TableCell>
                      <TableCell className="text-center">
                        {a.buy ? (
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
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <Button variant="ghost" size="sm" className="text-xs">
                Lançamentos <ArrowUpRight className="ml-1 h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm">
                <BarChart3 className="mr-2 h-4 w-4" />Gráficos
              </Button>
              <Button variant="outline" size="sm">
                <Settings2 className="mr-2 h-4 w-4" />Editar colunas
              </Button>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />Adicionar Lançamento
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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

function ChevronDownToggle({ open }: { open: boolean }) {
  return (
    <span className="ml-auto grid h-8 w-8 place-items-center rounded-md border border-border bg-background">
      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </span>
  );
}
