import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney, CURRENCIES, type Currency } from "@/lib/currency";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "Lançamentos — Folio" }] }),
  component: TransactionsPage,
});

type Tx = {
  id: string; asset: string; class: string; type: "Compra" | "Venda";
  date: string; unitPrice: number; qty: number; cumQty: number; currency: Currency;
};

const SEED: Tx[] = [
  { id: "1", asset: "PETR4", class: "Ações", type: "Compra", date: "2025-01-10", unitPrice: 36.5, qty: 100, cumQty: 100, currency: "BRL" },
  { id: "2", asset: "AAPL",  class: "Ações", type: "Compra", date: "2025-02-03", unitPrice: 184.2, qty: 10,  cumQty: 10,  currency: "USD" },
  { id: "3", asset: "HGLG11",class: "REITs", type: "Compra", date: "2025-03-15", unitPrice: 165.0, qty: 20,  cumQty: 20,  currency: "BRL" },
  { id: "4", asset: "BTC",   class: "Cripto",type: "Compra", date: "2025-04-22", unitPrice: 68000, qty: 0.05,cumQty: 0.05,currency: "USD" },
  { id: "5", asset: "PETR4", class: "Ações", type: "Venda",  date: "2025-05-09", unitPrice: 39.1, qty: 30,  cumQty: 70,  currency: "BRL" },
];

const MONTHLY_FLOWS_BRL = [
  { month: "Jan", aporte: 4500, retirada: 0 },
  { month: "Fev", aporte: 3200, retirada: 0 },
  { month: "Mar", aporte: 5000, retirada: -800 },
  { month: "Abr", aporte: 6200, retirada: 0 },
  { month: "Mai", aporte: 0,    retirada: -1200 },
  { month: "Jun", aporte: 4100, retirada: 0 },
  { month: "Jul", aporte: 7800, retirada: 0 },
  { month: "Ago", aporte: 3000, retirada: -500 },
];

function TransactionsPage() {
  const { currency } = useDisplayCurrency();
  const [txs, setTxs] = useState<Tx[]>(SEED);
  const [filter, setFilter] = useState<string>("all");
  const [period, setPeriod] = useState<string>("1y");

  const classes = useMemo(() => Array.from(new Set(txs.map((t) => t.class))), [txs]);
  const visible = filter === "all" ? txs : txs.filter((t) => t.class === filter);

  const grouped = useMemo(() => {
    const map = new Map<string, Tx[]>();
    visible.forEach((t) => {
      if (!map.has(t.class)) map.set(t.class, []);
      map.get(t.class)!.push(t);
    });
    return Array.from(map.entries());
  }, [visible]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Histórico de operações, agrupado por classe.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as classes</SelectItem>
              {classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <NewTxDialog onCreate={(t) => setTxs([t, ...txs])} />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Aportes vs. retiradas</CardTitle>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1y">1 ano</SelectItem>
              <SelectItem value="2y">2 anos</SelectItem>
              <SelectItem value="5y">5 anos</SelectItem>
              <SelectItem value="max">Max</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={MONTHLY_FLOWS_BRL.map((m) => ({
              month: m.month,
              aporte: convert(m.aporte, currency),
              retirada: convert(m.retirada, currency),
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" fontSize={12} stroke="var(--color-muted-foreground)" />
              <YAxis fontSize={12} stroke="var(--color-muted-foreground)"
                tickFormatter={(v) => formatMoney(Number(v), currency).replace(/[,.]00$/, "")} />
              <Tooltip formatter={(v: number) => formatMoney(v, currency)} />
              <Bar dataKey="aporte" radius={[4,4,0,0]}>
                {MONTHLY_FLOWS_BRL.map((_, i) => <Cell key={`a-${i}`} fill="var(--color-success)" />)}
              </Bar>
              <Bar dataKey="retirada" radius={[4,4,0,0]}>
                {MONTHLY_FLOWS_BRL.map((_, i) => <Cell key={`r-${i}`} fill="var(--color-destructive)" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

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
                  <TableHead className="text-right">Qtd. acumulada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.asset}</TableCell>
                    <TableCell>{new Date(t.date).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell>
                      <Badge variant={t.type === "Compra" ? "default" : "destructive"}>{t.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.unitPrice, t.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.cumQty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NewTxDialog({ onCreate }: { onCreate: (t: Tx) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    asset: "", class: "Ações", type: "Compra" as Tx["type"],
    date: new Date().toISOString().slice(0, 10),
    unitPrice: 0, qty: 0, currency: "BRL" as Currency,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Novo lançamento</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo lançamento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>Ativo (símbolo)</Label>
            <Input value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1.5"><Label>Classe</Label>
            <Select value={form.class} onValueChange={(v) => setForm({ ...form, class: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Ações","REITs","ETFs","Cripto","Renda Fixa","Fundos","Caixa"].map((c) =>
                  <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Natureza</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as Tx["type"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Compra">Compra</SelectItem>
                <SelectItem value="Venda">Venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Data</Label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Moeda</Label>
            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v as Currency })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Preço unit.</Label>
            <Input type="number" step="0.01" value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1.5"><Label>Quantidade</Label>
            <Input type="number" step="0.0001" value={form.qty}
              onChange={(e) => setForm({ ...form, qty: parseFloat(e.target.value) || 0 })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => {
            onCreate({
              id: crypto.randomUUID(), asset: form.asset || "?", class: form.class,
              type: form.type, date: form.date, unitPrice: form.unitPrice,
              qty: form.qty, cumQty: form.qty, currency: form.currency,
            });
            setOpen(false);
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
