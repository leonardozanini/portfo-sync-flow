import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, ArrowDownToLine, ArrowUpFromLine, CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createTransaction, type AssetClass, type CurrencyCode } from "@/lib/portfolio.functions";

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "stock", label: "Ações" },
  { value: "reit", label: "FIIs" },
  { value: "etf", label: "ETFs" },
  { value: "crypto", label: "Criptomoedas" },
  { value: "fixed_income", label: "Renda Fixa" },
  { value: "fund", label: "Fundos" },
  { value: "cash", label: "Caixa" },
  { value: "other", label: "Outros" },
];

const CURRENCIES: CurrencyCode[] = ["BRL", "USD", "EUR", "GBP", "JPY"];

export function NewTransactionDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Adicionar Lançamento</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="buy" className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-12 p-1 bg-muted/60">
            <TabsTrigger value="buy" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <ArrowDownToLine className="h-4 w-4 text-success" />
              <span className="font-medium">Compra</span>
            </TabsTrigger>
            <TabsTrigger value="sell" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <ArrowUpFromLine className="h-4 w-4 text-destructive" />
              <span className="font-medium">Venda</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="mt-4">
            <TxForm txType="buy" onClose={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="sell" className="mt-4">
            <TxForm txType="sell" onClose={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TxForm({ txType, onClose }: { txType: "buy" | "sell"; onClose: () => void }) {
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [symbol, setSymbol] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("BRL");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number>(0);
  const [fees, setFees] = useState<number>(0);

  const total = qty * price + fees;
  const qc = useQueryClient();
  const createTx = useServerFn(createTransaction);

  const mutation = useMutation({
    mutationFn: createTx,
    onSuccess: () => {
      toast.success("Lançamento adicionado");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message ?? "Erro ao salvar"),
  });

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);

  const submit = () => {
    if (!symbol.trim()) { toast.error("Informe o ativo (símbolo)"); return; }
    if (qty <= 0) { toast.error("Quantidade deve ser maior que zero"); return; }
    mutation.mutate({
      data: {
        symbol: symbol.trim().toUpperCase(),
        assetClass,
        txType,
        occurredAt: date,
        quantity: qty,
        unitPrice: price,
        fees,
        currency,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo de ativo">
          <Select value={assetClass} onValueChange={(v) => setAssetClass(v as AssetClass)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSET_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Ativo (símbolo)">
          <Input value={symbol} placeholder="Ex.: PETR4, BTC, AAPL"
            onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>

        <Field label="Data da transação">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-9" />
          </div>
        </Field>
        <Field label="Quantidade">
          <Input type="number" step="0.0001" min="0" value={qty}
            onChange={(e) => setQty(parseFloat(e.target.value) || 0)} />
        </Field>

        <Field label={<>Preço <span className="font-normal text-muted-foreground">em {currency}</span></>}>
          <Input type="number" step="0.01" min="0" value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} placeholder="0,00" />
        </Field>
        <Field label="Moeda">
          <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label={<>Outros custos <span className="float-right text-xs text-muted-foreground">(Opcional)</span></>}>
          <Input type="number" step="0.01" min="0" value={fees}
            onChange={(e) => setFees(parseFloat(e.target.value) || 0)} placeholder="0,00" />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
        <span className="font-medium">Valor total</span>
        <span className="text-lg font-semibold tabular-nums">{fmt(total)}</span>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
        <Button onClick={submit} disabled={mutation.isPending}
          className={txType === "sell" ? "bg-destructive hover:bg-destructive/90" : ""}>
          {mutation.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando…</>
          ) : (
            <><Plus className="mr-2 h-4 w-4" />Adicionar Lançamento</>
          )}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}
