import { useState } from "react";
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
import { Plus, ArrowDownToLine, ArrowUpFromLine, CalendarDays } from "lucide-react";

const ASSET_CLASSES = [
  "Ações", "FIIs", "Stocks", "ETFs", "Criptomoedas",
  "Renda Fixa", "Tesouro Direto", "Fundos", "Reits",
] as const;

const ASSET_OPTIONS: Record<string, string[]> = {
  "Ações": ["BBSE3", "BBAS3", "ITSA4", "BRBI11", "LAVV3", "PETR4", "VALE3"],
  "FIIs": ["HGLG11", "KNRI11", "MXRF11", "XPLG11"],
  "Criptomoedas": ["BTC", "ETH", "SOL", "ADA"],
  "Stocks": ["AAPL", "MSFT", "GOOGL", "AMZN"],
  "ETFs": ["IVVB11", "BOVA11", "SPY"],
  "Renda Fixa": ["CDB BB 110%", "LCI Itaú"],
  "Tesouro Direto": ["Tesouro Selic 2029", "Tesouro IPCA+ 2035"],
  "Fundos": ["Fundo XP Macro", "Fundo Verde"],
  "Reits": ["O", "VNQ", "MAIN"],
};

export function NewTransactionDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Adicionar Lançamento</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="compra" className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-12 p-1 bg-muted/60">
            <TabsTrigger value="compra" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <ArrowDownToLine className="h-4 w-4 text-success" />
              <span className="font-medium">Compra</span>
            </TabsTrigger>
            <TabsTrigger value="venda" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <ArrowUpFromLine className="h-4 w-4 text-destructive" />
              <span className="font-medium">Venda</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="compra" className="mt-4">
            <TxForm kind="compra" onClose={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="venda" className="mt-4">
            <TxForm kind="venda" onClose={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TxForm({ kind, onClose }: { kind: "compra" | "venda"; onClose: () => void }) {
  const [klass, setKlass] = useState<string>("Ações");
  const [asset, setAsset] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number>(0);
  const [fees, setFees] = useState<number>(0);

  const total = qty * price + fees;
  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo de ativo">
          <Select value={klass} onValueChange={(v) => { setKlass(v); setAsset(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSET_CLASSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Ativo">
          <Select value={asset} onValueChange={setAsset}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {(ASSET_OPTIONS[klass] ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Data da transação">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-9" />
          </div>
        </Field>
        <Field label="Quantidade">
          <Input type="number" step="0.0001" value={qty}
            onChange={(e) => setQty(parseFloat(e.target.value) || 0)} />
        </Field>

        <Field label={<>Preço <span className="font-normal text-muted-foreground">em R$</span></>}>
          <Input type="number" step="0.01" value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} placeholder="0,00" />
        </Field>
        <Field label={<>Outros custos <span className="float-right text-xs text-muted-foreground">(Opcional)</span></>}>
          <Input type="number" step="0.01" value={fees}
            onChange={(e) => setFees(parseFloat(e.target.value) || 0)} placeholder="0,00" />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
        <span className="font-medium">Valor total</span>
        <span className="text-lg font-semibold tabular-nums">{fmt(total)}</span>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={onClose} className={kind === "venda" ? "bg-destructive hover:bg-destructive/90" : ""}>
          <Plus className="mr-2 h-4 w-4" />Adicionar Lançamento
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
