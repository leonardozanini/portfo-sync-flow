import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, MoreVertical, Pencil, Trash2, Loader2, Inbox } from "lucide-react";
import { toast } from "sonner";
import { NewTransactionDialog } from "@/components/NewTransactionDialog";
import {
  listTransactions, updateTransaction, deleteTransaction,
  type AssetClass, type CurrencyCode, type TxType,
} from "@/lib/portfolio.functions";
import { convert, formatMoney, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { listBrokers } from "@/lib/portfolio.functions";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "Lançamentos — Folio" }] }),
  component: TransactionsPage,
});

type TxRow = {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  classLabel: string;
  txType: TxType;
  occurredAt: string;
  quantity: number;
  unitPrice: number;
  fees: number;
  currency: CurrencyCode;
  brokerId: string | null;
  brokerName: string | null;
  brokerColor: string | null;
};

const TX_LABEL: Record<TxType, string> = {
  buy: "Compra", sell: "Venda", dividend: "Dividendo",
  deposit: "Aporte", withdraw: "Retirada",
};

// Parses YYYY-MM-DD safely without timezone shift
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function buildChartData(txs: TxRow[], currency: Currency) {
  const map = new Map<string, { month: string; compras: number; vendas: number }>();
  for (const t of txs) {
    if (t.txType !== "buy" && t.txType !== "sell") continue;
    const d = new Date(t.occurredAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    if (!map.has(key)) map.set(key, { month: label, compras: 0, vendas: 0 });
    const totalBRL = t.quantity * t.unitPrice + (t.fees ?? 0);
    const total = convert(totalBRL, currency);
    if (t.txType === "buy") map.get(key)!.compras += total;
    else map.get(key)!.vendas += total;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ ...v, vendas: -v.vendas }));
}

function TransactionsPage() {
  const [filterClass, setFilterClass] = useState<string>("all");
  const [filterSymbol, setFilterSymbol] = useState<string>("all");
  const [filterBroker, setFilterBroker] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<TxRow | null>(null);
  const [deleting, setDeleting] = useState<TxRow | null>(null);

  const { currency } = useDisplayCurrency();

  const listFn = useServerFn(listTransactions);
  const listBrokersFn = useServerFn(listBrokers);

  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listFn(),
  });

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: () => listBrokersFn(),
    staleTime: 5 * 60_000,
  });

  const classes = useMemo(
    () => Array.from(new Set((txs as TxRow[]).map((t) => t.classLabel))),
    [txs],
  );

  const symbols = useMemo(() => {
    const base = filterClass === "all" ? (txs as TxRow[]) : (txs as TxRow[]).filter((t) => t.classLabel === filterClass);
    return Array.from(new Set(base.map((t) => t.symbol))).sort();
  }, [txs, filterClass]);

  // Meses disponíveis a partir dos lançamentos
  const months = useMemo(() => {
    const set = new Map<string, string>();
    (txs as TxRow[]).forEach((t) => {
      const d = parseDate(t.occurredAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      set.set(key, label);
    });
    return Array.from(set.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [txs]);

  const visible = useMemo(() => {
    let rows = txs as TxRow[];
    if (filterClass !== "all") rows = rows.filter((t) => t.classLabel === filterClass);
    if (filterSymbol !== "all") rows = rows.filter((t) => t.symbol === filterSymbol);
    if (filterBroker !== "all") rows = rows.filter((t) => (t.brokerId ?? "none") === filterBroker);
    if (filterMonth !== "all") rows = rows.filter((t) => {
      const d = parseDate(t.occurredAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return key === filterMonth;
    });
    return rows;
  }, [txs, filterClass, filterSymbol, filterBroker, filterMonth]);

  const grouped = useMemo(() => {
    const map = new Map<string, TxRow[]>();
    visible.forEach((t) => {
      if (!map.has(t.classLabel)) map.set(t.classLabel, []);
      map.get(t.classLabel)!.push(t);
    });
    return Array.from(map.entries());
  }, [visible]);

  // KPI: total investido e vendido no mês filtrado
  const monthlyTotals = useMemo(() => {
    const rows = filterMonth !== "all" ? visible : [];
    let compras = 0; let vendas = 0;
    rows.forEach((t) => {
      const val = convert(Number(t.quantity) * Number(t.unit_price) + Number(t.fees ?? 0), currency, t.currency as Currency);
      if (t.tx_type === "buy") compras += val;
      if (t.tx_type === "sell") vendas += val;
    });
    return { compras, vendas, saldo: compras - vendas };
  }, [visible, filterMonth, currency]);

  const [chartPeriod, setChartPeriod] = useState<"6" | "12" | "24">("12");

  const allChartData = useMemo(() => buildChartData(visible, currency), [visible, currency]);
  const chartData = useMemo(() => allChartData.slice(-parseInt(chartPeriod)), [allChartData, chartPeriod]);

  const hasChart = chartData.some((d) => d.compras !== 0 || d.vendas !== 0);

  const currencySymbol: Record<Currency, string> = {
    BRL: "R$", USD: "US$", EUR: "€", GBP: "£", JPY: "¥",
  };

  const fmtAxis = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1000000) return `${currencySymbol[currency]} ${(abs / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${currencySymbol[currency]} ${(abs / 1000).toFixed(0)}k`;
    return `${currencySymbol[currency]} ${abs.toFixed(0)}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const compras = payload.find((p: any) => p.dataKey === "compras")?.value ?? 0;
    const vendas = payload.find((p: any) => p.dataKey === "vendas")?.value ?? 0;
    return (
      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
        padding: "10px 14px", minWidth: 170, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      }}>
        <p style={{ color: "#374151", fontSize: 12, marginBottom: 8, fontWeight: 700 }}>{label}</p>
        {compras !== 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#22c55e", display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: "#6b7280", fontSize: 12 }}>Compras</span>
            <span style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>
              {formatMoney(compras, currency)}
            </span>
          </div>
        )}
        {vendas !== 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f43f5e", display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: "#6b7280", fontSize: 12 }}>Vendas</span>
            <span style={{ color: "#111827", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>
              {formatMoney(Math.abs(vendas), currency)}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de operações, agrupado por classe.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter by class */}
          <Select value={filterClass} onValueChange={(v) => { setFilterClass(v); setFilterSymbol("all"); }}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Todas as classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as classes</SelectItem>
              {classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Filter by symbol */}
          <Select value={filterSymbol} onValueChange={setFilterSymbol}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Todos os ativos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os ativos</SelectItem>
              {symbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Filter by broker */}
          {brokers.length > 0 && (
            <Select value={filterBroker} onValueChange={setFilterBroker}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Todas as corretoras" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as corretoras</SelectItem>
                {(brokers as any[]).map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: b.color }} />
                      {b.name}
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="none">Sem corretora</SelectItem>
              </SelectContent>
            </Select>
          )}
          {/* Filter by month */}
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Todos os meses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {months.map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="mr-2 h-4 w-4" />Novo lançamento
          </Button>
        </div>
      </div>

      {/* KPI mensal — só aparece quando um mês está selecionado */}
      {filterMonth !== "all" && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total investido no mês", value: formatMoney(monthlyTotals.compras, currency), color: "text-emerald-500" },
            { label: "Total vendido no mês",   value: formatMoney(monthlyTotals.vendas,  currency), color: "text-red-500" },
            { label: "Saldo líquido",           value: formatMoney(monthlyTotals.saldo,   currency), color: monthlyTotals.saldo >= 0 ? "text-emerald-500" : "text-red-500" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-muted-foreground mb-2">{label}</div>
                <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Chart */}
      {hasChart && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Consolidação de aportes</CardTitle>
            <Select value={chartPeriod} onValueChange={(v) => setChartPeriod(v as "6" | "12" | "24")}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 Meses</SelectItem>
                <SelectItem value="12">12 Meses</SelectItem>
                <SelectItem value="24">24 Meses</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barCategoryGap="4%" barGap={1} barSize={chartPeriod === "6" ? 48 : chartPeriod === "12" ? 28 : 14} margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#888" }}
                  axisLine={false}
                  tickLine={false}
                />
                <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="4 4" />
                <YAxis
                  tick={{ fontSize: 11, fill: "#888" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtAxis}
                  width={70}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Legend
                  formatter={(v) => (
                    <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{v}</span>
                  )}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                <Bar dataKey="compras" name="Compras" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="vendas" name="Vendas" fill="#f43f5e" radius={[0, 0, 3, 3]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-4">
          {/* Skeleton do gráfico */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-40 animate-pulse rounded-md bg-muted/60" />
              <div className="h-8 w-28 animate-pulse rounded-md bg-muted/60" />
            </div>
            <div className="flex items-end gap-2 h-[200px]">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
                  <div
                    className="w-full animate-pulse rounded-t-md bg-muted/60"
                    style={{ height: `${25 + Math.random() * 60}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* Skeleton da tabela */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-4 py-3 flex gap-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-muted/60 flex-1" />
              ))}
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border-b border-border/50 px-4 py-3 flex items-center gap-4">
                <div className="h-7 w-7 animate-pulse rounded bg-muted/60 shrink-0" />
                <div className="flex-1 grid grid-cols-6 gap-4">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div key={j} className="h-4 animate-pulse rounded bg-muted/60" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && visible.length === 0 && (
        <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 opacity-60" />
          <p className="font-medium">Nenhum lançamento encontrado</p>
          <p className="text-sm">Comece adicionando seu primeiro lançamento.</p>
        </CardContent></Card>
      )}

      {/* Broker allocation card */}
      {brokers.length > 0 && (txs as TxRow[]).some(t => t.brokerId) && (() => {
        const brokerValueMap = new Map<string, number>();
        let unassigned = 0;
        for (const t of visible as TxRow[]) {
          if (t.txType !== "buy" && t.txType !== "sell") continue;
          const total = t.quantity * t.unitPrice;
          if (t.brokerId && t.brokerName) {
            brokerValueMap.set(t.brokerId, (brokerValueMap.get(t.brokerId) ?? 0) + total);
          } else {
            unassigned += total;
          }
        }
        const total = Array.from(brokerValueMap.values()).reduce((a, b) => a + b, 0) + unassigned;
        const brokerData = [
          ...(brokers as any[]).filter(b => brokerValueMap.has(b.id)).map(b => ({
            id: b.id, name: b.name, color: b.color,
            value: brokerValueMap.get(b.id) ?? 0,
            pct: total > 0 ? ((brokerValueMap.get(b.id) ?? 0) / total) * 100 : 0,
          })),
          ...(unassigned > 0 ? [{ id: "none", name: "Sem corretora", color: "#9ca3af", value: unassigned, pct: total > 0 ? (unassigned / total) * 100 : 0 }] : []),
        ].sort((a, b) => b.value - a.value);

        if (brokerData.length === 0) return null;
        return (
          <Card>
            <CardHeader><CardTitle className="text-base">Alocação por Corretora</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="h-[180px] w-full sm:w-[180px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={brokerData} dataKey="pct" nameKey="name"
                        innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                        {brokerData.map((b, i) => <Cell key={i} fill={b.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex-1 space-y-2 text-sm">
                  {brokerData.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                        <span className="truncate text-muted-foreground">{b.name}</span>
                      </span>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="font-medium w-14 text-right">{b.pct.toFixed(2)}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {grouped.map(([cls, rows]) => (
        <Card key={cls}>
          <CardHeader><CardTitle className="text-base">{cls}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ativo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Natureza</TableHead>
                  <TableHead className="text-right">Preço unit.</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Corretora</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const total = t.quantity * t.unitPrice + (t.fees ?? 0);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium font-mono">{t.symbol}</TableCell>
                      <TableCell>{new Date(t.occurredAt).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>
                        <Badge variant={
                          t.txType === "buy" ? "default"
                          : t.txType === "sell" ? "destructive"
                          : "secondary"
                        }>{TX_LABEL[t.txType]}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(t.unitPrice, t.currency as Currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(total, t.currency as Currency)}
                      </TableCell>
                      <TableCell>
                        {t.brokerName ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.brokerColor ?? "#9ca3af" }} />
                            {t.brokerName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(t)}>
                              <Pencil className="mr-2 h-4 w-4" />Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleting(t)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <NewTransactionDialog open={openNew} onOpenChange={setOpenNew} />

      {editing && (
        <EditTxDialog tx={editing} onClose={() => setEditing(null)} />
      )}

      {deleting && (
        <DeleteTxDialog tx={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

const CURRENCIES: CurrencyCode[] = ["BRL", "USD", "EUR", "GBP", "JPY"];

function EditTxDialog({ tx, onClose }: { tx: TxRow; onClose: () => void }) {
  const [form, setForm] = useState({
    occurredAt: tx.occurredAt.slice(0, 10),
    txType: tx.txType,
    quantity: tx.quantity,
    unitPrice: tx.unitPrice,
    fees: tx.fees,
    currency: tx.currency,
  });
  const qc = useQueryClient();
  const fn = useServerFn(updateTransaction);
  const mut = useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success("Lançamento atualizado");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar lançamento — {tx.symbol}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Data</Label>
            <Input type="date" value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Natureza</Label>
            <Select value={form.txType}
              onValueChange={(v) => setForm({ ...form, txType: v as TxType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">Compra</SelectItem>
                <SelectItem value="sell">Venda</SelectItem>
                <SelectItem value="dividend">Dividendo</SelectItem>
                <SelectItem value="deposit">Aporte</SelectItem>
                <SelectItem value="withdraw">Retirada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Quantidade</Label>
            <Input type="number" step="0.0001" value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1.5"><Label>Preço unit.</Label>
            <Input type="number" step="0.01" value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1.5"><Label>Outros custos</Label>
            <Input type="number" step="0.01" value={form.fees}
              onChange={(e) => setForm({ ...form, fees: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1.5"><Label>Moeda</Label>
            <Select value={form.currency}
              onValueChange={(v) => setForm({ ...form, currency: v as CurrencyCode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Cancelar</Button>
          <Button
            onClick={() => mut.mutate({ data: { id: tx.id, ...form } })}
            disabled={mut.isPending}
          >
            {mut.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando…</>
              : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTxDialog({ tx, onClose }: { tx: TxRow; onClose: () => void }) {
  const qc = useQueryClient();
  const fn = useServerFn(deleteTransaction);
  const mut = useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success("Lançamento excluído");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog open onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação não pode ser desfeita. O lançamento de <b>{tx.symbol}</b> em{" "}
            {new Date(tx.occurredAt).toLocaleDateString("pt-BR")} será removido permanentemente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mut.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); mut.mutate({ data: { id: tx.id } }); }}
            disabled={mut.isPending}
            className="bg-destructive hover:bg-destructive/90"
          >
            {mut.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Excluindo…</>
              : "Excluir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
