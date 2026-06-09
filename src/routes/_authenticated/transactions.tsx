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
import { formatMoney, type Currency } from "@/lib/currency";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
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
};

const TX_LABEL: Record<TxType, string> = {
  buy: "Compra", sell: "Venda", dividend: "Dividendo",
  deposit: "Aporte", withdraw: "Retirada",
};

function buildChartData(txs: TxRow[]) {
  const map = new Map<string, { month: string; compras: number; vendas: number }>();
  for (const t of txs) {
    if (t.txType !== "buy" && t.txType !== "sell") continue;
    const d = new Date(t.occurredAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    if (!map.has(key)) map.set(key, { month: label, compras: 0, vendas: 0 });
    const total = t.quantity * t.unitPrice + (t.fees ?? 0);
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
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<TxRow | null>(null);
  const [deleting, setDeleting] = useState<TxRow | null>(null);

  const listFn = useServerFn(listTransactions);
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listFn(),
  });

  const classes = useMemo(
    () => Array.from(new Set((txs as TxRow[]).map((t) => t.classLabel))),
    [txs],
  );

  // Symbols filtered by selected class
  const symbols = useMemo(() => {
    const base = filterClass === "all" ? (txs as TxRow[]) : (txs as TxRow[]).filter((t) => t.classLabel === filterClass);
    return Array.from(new Set(base.map((t) => t.symbol))).sort();
  }, [txs, filterClass]);

  const visible = useMemo(() => {
    let rows = txs as TxRow[];
    if (filterClass !== "all") rows = rows.filter((t) => t.classLabel === filterClass);
    if (filterSymbol !== "all") rows = rows.filter((t) => t.symbol === filterSymbol);
    return rows;
  }, [txs, filterClass, filterSymbol]);

  const grouped = useMemo(() => {
    const map = new Map<string, TxRow[]>();
    visible.forEach((t) => {
      if (!map.has(t.classLabel)) map.set(t.classLabel, []);
      map.get(t.classLabel)!.push(t);
    });
    return Array.from(map.entries());
  }, [visible]);

  const chartData = useMemo(() => buildChartData(visible), [visible]);

  const hasChart = chartData.some((d) => d.compras !== 0 || d.vendas !== 0);

  const fmtTooltip = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2 }).format(Math.abs(value));

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
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="mr-2 h-4 w-4" />Novo lançamento
          </Button>
        </div>
      </div>

      {/* Chart */}
      {hasChart && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consolidação de aportes</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barCategoryGap="30%" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#888" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => {
                    const abs = Math.abs(v);
                    return abs >= 1000 ? `${(abs / 1000).toFixed(0)}k` : `${abs}`;
                  }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [fmtTooltip(value), name]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
                />
                <Legend
                  formatter={(v) => <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{v}</span>}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="compras" name="Compras" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="vendas" name="Vendas" fill="#f43f5e" radius={[0, 0, 3, 3]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card><CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…
        </CardContent></Card>
      )}

      {!isLoading && visible.length === 0 && (
        <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 opacity-60" />
          <p className="font-medium">Nenhum lançamento encontrado</p>
          <p className="text-sm">Comece adicionando seu primeiro lançamento.</p>
        </CardContent></Card>
      )}

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
