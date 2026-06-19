import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Coins, TrendingUp, FileUp, ClipboardPaste, Pencil, Trash2,
  Loader2, ChevronDown, ChevronUp, Brain,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { toast } from "sonner";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { convert, formatMoney } from "@/lib/currency";
import { supabase } from "@/integrations/supabase/client";
import {
  listDividends, saveDividend, deleteDividend, parseDividendText, importDividendFile,
  type DividendRow,
} from "@/lib/portfolio.functions";

export const Route = createFileRoute("/_authenticated/proventos")({
  head: () => ({ meta: [{ title: "Proventos — Folio" }] }),
  component: ProventosPage,
});

// ── Constantes ────────────────────────────────────────────────────────────────

const DIVIDEND_TYPE_LABELS: Record<string, string> = {
  dividendo:    "Dividendo",
  jcp:          "JCP",
  rendimento:   "Rendimento (FII)",
  amortizacao:  "Amortização",
  bonificacao:  "Bonificação",
};

const DIVIDEND_TYPE_COLORS: Record<string, string> = {
  dividendo:   "#22c55e",
  jcp:         "#3b82f6",
  rendimento:  "#8b5cf6",
  amortizacao: "#f59e0b",
  bonificacao: "#f43f5e",
};

const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function buildChartData(rows: DividendRow[], year: number) {
  const map = new Map<number, Record<string, number>>();
  for (let m = 1; m <= 12; m++) map.set(m, {});

  for (const r of rows) {
    const date = r.payment_date || r.ex_date;
    if (!date) continue;
    const [y, m] = date.split("-").map(Number);
    if (y !== year) continue;
    const bucket = map.get(m)!;
    const key = r.dividend_type;
    bucket[key] = (bucket[key] ?? 0) + Number(r.amount);
  }

  return Array.from(map.entries()).map(([m, vals]) => ({
    month: MONTHS_PT[m - 1],
    ...vals,
    total: Object.values(vals).reduce((s, v) => s + v, 0),
  }));
}

// ── Dialog de adicionar/editar provento ───────────────────────────────────────

type FormData = {
  asset_symbol: string;
  dividend_type: string;
  ex_date: string;
  payment_date: string;
  amount_per_share: string;
  quantity_held: string;
  ir_withheld: string;
  currency: string;
  notes: string;
};

const EMPTY_FORM: FormData = {
  asset_symbol: "",
  dividend_type: "dividendo",
  ex_date: "",
  payment_date: "",
  amount_per_share: "",
  quantity_held: "",
  ir_withheld: "0",
  currency: "BRL",
  notes: "",
};

function DividendDialog({
  open, onOpenChange, editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: DividendRow | null;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveDividend);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);

  // Preenche o form quando abre para edição
  useState(() => {
    if (editing) {
      setForm({
        asset_symbol: editing.symbol ?? "",
        dividend_type: editing.dividend_type,
        ex_date: editing.ex_date ?? "",
        payment_date: editing.payment_date ?? "",
        amount_per_share: String(editing.amount_per_share ?? ""),
        quantity_held: String(editing.quantity_held ?? ""),
        ir_withheld: String(editing.ir_withheld ?? 0),
        currency: editing.currency,
        notes: editing.notes ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  });

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const amountPerShare = parseFloat(form.amount_per_share) || 0;
  const quantityHeld = parseFloat(form.quantity_held) || 0;
  const irWithheld = parseFloat(form.ir_withheld) || 0;
  const grossAmount = amountPerShare * quantityHeld;
  const netAmount = grossAmount - irWithheld;

  const mutation = useMutation({
    mutationFn: () => saveFn({
      data: {
        id: editing?.id,
        asset_symbol: form.asset_symbol.trim().toUpperCase(),
        dividend_type: form.dividend_type,
        ex_date: form.ex_date,
        payment_date: form.payment_date || null,
        amount_per_share: amountPerShare,
        quantity_held: quantityHeld,
        ir_withheld: irWithheld,
        gross_amount: grossAmount,
        amount: netAmount,
        currency: form.currency,
        notes: form.notes,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dividends"] });
      toast.success(editing ? "Provento atualizado!" : "Provento adicionado!");
      onOpenChange(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isValid = form.asset_symbol && form.ex_date && amountPerShare > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar provento" : "Adicionar provento"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ativo</Label>
              <Input value={form.asset_symbol} onChange={set("asset_symbol")}
                placeholder="Ex: CPTS11, GGRC11" className="font-mono uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.dividend_type} onValueChange={v => setForm(f => ({ ...f, dividend_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DIVIDEND_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data EX</Label>
              <Input type="date" value={form.ex_date} onChange={set("ex_date")} />
            </div>
            <div className="space-y-1.5">
              <Label>Data Pagamento <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input type="date" value={form.payment_date} onChange={set("payment_date")} />
            </div>
            <div className="space-y-1.5">
              <Label>Valor por cota</Label>
              <Input type="number" step="0.000001" value={form.amount_per_share}
                onChange={set("amount_per_share")} placeholder="0,000000" />
            </div>
            <div className="space-y-1.5">
              <Label>Cotas na data EX</Label>
              <Input type="number" value={form.quantity_held}
                onChange={set("quantity_held")} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>IR Retido <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input type="number" step="0.01" value={form.ir_withheld}
                onChange={set("ir_withheld")} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label>Moeda</Label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["BRL","USD","EUR","GBP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preview do cálculo */}
          {grossAmount > 0 && (
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bruto</span>
                <span className="font-medium tabular-nums">{form.currency} {grossAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">IR retido</span>
                <span className="text-red-500 tabular-nums">- {form.currency} {irWithheld.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 mt-1">
                <span className="font-semibold">Líquido recebido</span>
                <span className="font-semibold text-emerald-500 tabular-nums">{form.currency} {netAmount.toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Observações <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Input value={form.notes} onChange={set("notes")} placeholder="Ex: Rendimento referente a maio/2026" />
          </div>
        </div>
        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog de importação por texto (IA) ───────────────────────────────────────

function ParseTextDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const parseFn = useServerFn(parseDividendText);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<any[]>([]);
  const [step, setStep] = useState<"input" | "preview">("input");
  const [loading, setLoading] = useState(false);
  const saveFn = useServerFn(saveDividend);

  const handleParse = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const result = await parseFn({ data: { text } }) as any;
      setParsed(result.rows ?? []);
      setStep("preview");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAll = async () => {
    setLoading(true);
    try {
      for (const row of parsed) {
        await saveFn({ data: row });
      }
      qc.invalidateQueries({ queryKey: ["dividends"] });
      toast.success(`${parsed.length} proventos importados!`);
      onOpenChange(false);
      setStep("input");
      setText("");
      setParsed([]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" /> Importar por texto (IA)
          </DialogTitle>
        </DialogHeader>

        {step === "input" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cole o extrato de proventos da sua corretora. A IA vai identificar automaticamente o ativo, tipo, datas e valores.
            </p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              className="w-full h-48 rounded-lg border border-border bg-muted/30 p-3 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={"Exemplo:\nCPTS11 - Rendimento - Data EX: 12/05/2026 - Pgto: 20/05/2026 - R$ 0,10/cota - 170 cotas"}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleParse} disabled={!text.trim() || loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
                Analisar com IA
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A IA identificou <strong>{parsed.length} proventos</strong>. Confira e confirme:
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    {["Ativo","Tipo","Data EX","Pgto","Valor/cota","Cotas","Líquido"].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono font-bold">{r.asset_symbol}</td>
                      <td className="px-3 py-2">{DIVIDEND_TYPE_LABELS[r.dividend_type] ?? r.dividend_type}</td>
                      <td className="px-3 py-2">{r.ex_date ? fmtDate(r.ex_date) : "—"}</td>
                      <td className="px-3 py-2">{r.payment_date ? fmtDate(r.payment_date) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(r.amount_per_share).toFixed(6)}</td>
                      <td className="px-3 py-2 tabular-nums">{r.quantity_held}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-500 font-semibold">{r.currency} {Number(r.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("input")}>Voltar</Button>
              <Button onClick={handleSaveAll} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Salvar {parsed.length} proventos
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

function ProventosPage() {
  const { currency } = useDisplayCurrency();
  const qc = useQueryClient();
  const listFn = useServerFn(listDividends);
  const deleteFn = useServerFn(deleteDividend);
  const importFn = useServerFn(importDividendFile);
  const saveFn = useServerFn(saveDividend);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [parseOpen, setParseOpen] = useState(false);
  const [importingPdf, setImportingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<DividendRow | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: dividends = [] } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  const rows = dividends as DividendRow[];

  // KPIs
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const thisYear = rows.filter(r => {
    const d = r.payment_date || r.ex_date;
    return d?.startsWith(String(currentYear));
  });
  const totalYear = thisYear.reduce((s, r) => s + convert(Number(r.amount), currency), 0);
  const thisMonth = thisYear.filter(r => {
    const d = r.payment_date || r.ex_date;
    return d?.startsWith(`${currentYear}-${String(currentMonth).padStart(2, "0")}`);
  });
  const totalMonth = thisMonth.reduce((s, r) => s + convert(Number(r.amount), currency), 0);
  const uniqueAssets = new Set(rows.map(r => r.asset_id)).size;

  // Gráfico
  const chartData = buildChartData(rows, year);
  const chartTypes = [...new Set(rows.map(r => r.dividend_type))];

  // Anos disponíveis
  const years = [...new Set(rows.map(r => {
    const d = r.payment_date || r.ex_date;
    return d ? parseInt(d.slice(0, 4)) : null;
  }).filter(Boolean))].sort((a, b) => b! - a!) as number[];
  if (!years.includes(year)) years.unshift(year);
  // Auto-select most recent year with data on first render
  const mostRecentYear = years[0] ?? new Date().getFullYear();

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este provento?")) return;
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["dividends"] });
    toast.success("Provento removido.");
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingPdf(true);
    setPdfProgress("Lendo arquivo...");
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(",")[1]);
        reader.onerror = () => rej(new Error("Erro ao ler arquivo"));
        reader.readAsDataURL(file);
      });

      setPdfProgress("Processando com IA...");

      // Chama a Edge Function do Supabase — sem timeout!
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const edgeUrl = `${supabaseUrl}/functions/v1/import-dividends-pdf`;

      const res = await fetch(edgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ fileBase64: base64, fileName: file.name }),
      });

      const result = await res.json();

      if (!res.ok) throw new Error(result.error ?? "Erro na Edge Function");

      if (result.saved > 0) {
        qc.invalidateQueries({ queryKey: ["dividends"] });
        toast.success(`${result.saved} proventos importados!${result.skipped > 0 ? ` (${result.skipped} ignorados)` : ""}`);
      } else {
        toast.error("Nenhum provento encontrado no arquivo.");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao importar PDF");
    } finally {
      setImportingPdf(false);
      setPdfProgress(null);
      e.target.value = "";
    }
  };

 return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proventos</h1>
          <p className="text-sm text-muted-foreground mt-1">Dividendos, JCP, rendimentos e outros proventos recebidos</p>
        </div>
        <div className="flex gap-2 flex-wrap">

          <Button variant="outline" size="sm" onClick={() => pdfRef.current?.click()} disabled={importingPdf}>
            {importingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            {pdfProgress ?? "Importar PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setParseOpen(true)}>
            <ClipboardPaste className="mr-2 h-4 w-4" /> Colar texto
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar provento
          </Button>

          <input ref={pdfRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfImport} />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Recebido no ano", value: formatMoney(totalYear, currency), icon: TrendingUp, color: "text-emerald-500" },
          { label: "Recebido no mês", value: formatMoney(totalMonth, currency), icon: Coins, color: "text-blue-500" },
          { label: "Ativos com proventos", value: String(uniqueAssets), icon: Coins, color: "text-purple-500" },
          { label: "Total de registros", value: String(rows.length), icon: Coins, color: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <Icon className={`h-3.5 w-3.5 ${color}`} /> {label}
              </div>
              <div className="text-xl font-bold tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gráfico mensal */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Proventos por mês</CardTitle>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {chartData.every(d => d.total === 0) && years.filter(y => y !== year).length > 0 ? (
            <div className="grid h-40 place-items-center text-sm text-muted-foreground space-y-2">
              <p>Nenhum provento registrado em {year}.</p>
              <button className="text-primary underline text-xs" onClick={() => setYear(mostRecentYear)}>
                Ver {mostRecentYear} →
              </button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" fontSize={11} stroke="var(--color-muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--color-muted-foreground)"
                  tickFormatter={v => formatMoney(Number(v), currency).replace(/[,.]00$/, "")} />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    formatMoney(v, currency),
                    DIVIDEND_TYPE_LABELS[name] ?? name,
                  ]}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Legend formatter={name => DIVIDEND_TYPE_LABELS[name] ?? name} />
                {chartTypes.map(type => (
                  <Bar key={type} dataKey={type} stackId="a"
                    fill={DIVIDEND_TYPE_COLORS[type] ?? "#6366f1"}
                    radius={type === chartTypes[chartTypes.length - 1] ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de proventos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum provento registrado ainda.{" "}
              <button className="underline text-foreground" onClick={() => setDialogOpen(true)}>
                Adicionar o primeiro
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ativo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data EX</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead className="text-right">Valor/cota</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <>
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => toggleRow(r.id)}>
                        <TableCell className="font-mono font-semibold">{r.symbol}</TableCell>
                        <TableCell>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: `${DIVIDEND_TYPE_COLORS[r.dividend_type]}20`, color: DIVIDEND_TYPE_COLORS[r.dividend_type] }}>
                            {DIVIDEND_TYPE_LABELS[r.dividend_type]}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.ex_date ? fmtDate(r.ex_date) : "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{r.payment_date ? fmtDate(r.payment_date) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.amount_per_share ? `${r.currency} ${Number(r.amount_per_share).toFixed(6)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-500">
                          {formatMoney(convert(Number(r.amount), currency), currency)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={e => { e.stopPropagation(); setEditing(r); setDialogOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={e => { e.stopPropagation(); handleDelete(r.id); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            {expandedRows.has(r.id) ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedRows.has(r.id) && (
                        <TableRow key={`${r.id}-detail`} className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={7} className="py-3 px-6">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div><span className="text-muted-foreground">Cotas</span><br /><span className="font-medium">{r.quantity_held ?? "—"}</span></div>
                              <div><span className="text-muted-foreground">Bruto</span><br /><span className="font-medium">{r.gross_amount ? `${r.currency} ${Number(r.gross_amount).toFixed(2)}` : "—"}</span></div>
                              <div><span className="text-muted-foreground">IR retido</span><br /><span className="font-medium text-red-500">{r.ir_withheld ? `${r.currency} ${Number(r.ir_withheld).toFixed(2)}` : "R$ 0,00"}</span></div>
                              <div><span className="text-muted-foreground">Obs</span><br /><span className="font-medium">{r.notes || "—"}</span></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <DividendDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      <ParseTextDialog open={parseOpen} onOpenChange={setParseOpen} />
    </div>
  );
}
