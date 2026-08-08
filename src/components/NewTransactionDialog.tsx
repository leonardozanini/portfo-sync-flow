import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, CalendarDays, Loader2, ChevronsUpDown, Check, Building2, CheckCircle2, Landmark } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createTransaction, searchAssets, listBrokers, type AssetClass, type CurrencyCode } from "@/lib/portfolio.functions";

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "stock", label: "Ações" },
  { value: "reit", label: "FIIs" },
  { value: "etf", label: "ETFs" },
  { value: "stock_intl", label: "Stocks" },
  { value: "reit_intl", label: "REITs" },
  { value: "crypto", label: "Criptomoedas" },
  { value: "fixed_income", label: "Renda Fixa" },
  { value: "fund", label: "Fundos" },
  { value: "cash", label: "Caixa" },
  { value: "other", label: "Outros" },
];

const CURRENCIES: CurrencyCode[] = ["BRL", "USD", "EUR", "GBP", "JPY"];

export type TxPreset = {
  symbol?: string;
  assetClass?: AssetClass;
  currency?: CurrencyCode;
  lockAsset?: boolean;
};

// ── Tela de sucesso ──────────────────────────────────────────────────────────
function SuccessScreen({
  symbol,
  total,
  currency,
  onNewTransaction,
  onClose,
}: {
  symbol: string;
  total: string;
  currency: string;
  onNewTransaction: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-5 text-center">
      {/* Ícone animado */}
      <div className="relative flex items-center justify-center">
        <div className="absolute h-24 w-24 rounded-full bg-success/10 animate-ping opacity-30" />
        <div className="h-20 w-20 rounded-full bg-success/15 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
        </div>
      </div>

      {/* Mensagem */}
      <div className="space-y-1">
        <h3 className="text-xl font-semibold">Lançamento realizado!</h3>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{symbol}</span>
          {" · "}
          <span className="font-semibold text-foreground">{total}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Pode levar alguns instantes para aparecer na carteira.
        </p>
      </div>

      {/* Botões */}
      <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onClose}
        >
          Voltar para a carteira
        </Button>
        <Button
          className="flex-1"
          onClick={onNewTransaction}
        >
          <Plus className="mr-2 h-4 w-4" />
          Novo lançamento
        </Button>
      </div>
    </div>
  );
}

// ── Dialog principal ─────────────────────────────────────────────────────────
export function NewTransactionDialog({
  open, onOpenChange, preset,
}: { open: boolean; onOpenChange: (v: boolean) => void; preset?: TxPreset }) {
  const [successInfo, setSuccessInfo] = useState<{ symbol: string; total: string; currency: string } | null>(null);
  const [resetKey, setResetKey] = useState(0);

  // Fecha o dialog e limpa o estado de sucesso
  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => setSuccessInfo(null), 300); // aguarda animação fechar
  };

  // Abre para novo lançamento mantendo o dialog aberto
  const handleNewTransaction = () => {
    setSuccessInfo(null);
    setResetKey((k) => k + 1); // força reset do formulário
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-xl">
        {successInfo ? (
          // Tela de sucesso
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Adicionar Lançamento</DialogTitle>
            </DialogHeader>
            <SuccessScreen
              symbol={successInfo.symbol}
              total={successInfo.total}
              currency={successInfo.currency}
              onNewTransaction={handleNewTransaction}
              onClose={handleClose}
            />
          </>
        ) : (
          // Formulário normal
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">
                Adicionar Lançamento{preset?.symbol ? ` — ${preset.symbol}` : ""}
              </DialogTitle>
            </DialogHeader>
            <Tabs key={resetKey} defaultValue="buy" className="w-full">
              <TabsList className="grid w-full grid-cols-3 h-12 p-1 bg-muted/60">
                <TabsTrigger value="buy" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <ArrowDownToLine className="h-4 w-4 text-success" />
                  <span className="font-medium">Compra</span>
                </TabsTrigger>
                <TabsTrigger value="sell" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <ArrowUpFromLine className="h-4 w-4 text-destructive" />
                  <span className="font-medium">Venda</span>
                </TabsTrigger>
                <TabsTrigger value="transfer" className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <ArrowRightLeft className="h-4 w-4 text-primary" />
                  <span className="font-medium">Transferência</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="buy" className="mt-4">
                <TxForm
                  key={`buy-${resetKey}`}
                  txType="buy"
                  onClose={handleClose}
                  onSuccess={setSuccessInfo}
                  preset={preset}
                />
              </TabsContent>
              <TabsContent value="sell" className="mt-4">
                <TxForm
                  key={`sell-${resetKey}`}
                  txType="sell"
                  onClose={handleClose}
                  onSuccess={setSuccessInfo}
                  preset={preset}
                />
              </TabsContent>
              <TabsContent value="transfer" className="mt-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  Registre a movimentação de um criptoativo entre corretora e carteira própria (ou entre duas carteiras) — não altera seu patrimônio total, só de onde ele está guardado.
                </p>
                <TxForm
                  key={`transfer-${resetKey}`}
                  txType="transfer"
                  onClose={handleClose}
                  onSuccess={setSuccessInfo}
                  preset={preset}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Combobox de ativo ────────────────────────────────────────────────────────
function AssetCombobox({
  value, onChange, assetClass, onPickCurrency, disabled,
}: {
  value: string;
  onChange: (symbol: string) => void;
  assetClass: AssetClass;
  onPickCurrency?: (c: CurrencyCode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useServerFn(searchAssets);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toUpperCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results, isFetching } = useQuery({
    queryKey: ["catalog-search", debounced, assetClass],
    queryFn: () => search({ data: { q: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {value ? <span className="font-mono font-semibold">{value}</span> : <span className="text-muted-foreground">Selecionar</span>}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Digite 2+ caracteres…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {debounced.length < 2 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Digite 2 ou mais caracteres
              </div>
            )}
            {debounced.length >= 2 && isFetching && (
              <div className="py-6 text-center text-sm text-muted-foreground">Buscando…</div>
            )}
            {debounced.length >= 2 && !isFetching && (results?.length ?? 0) === 0 && (
              <CommandEmpty>
                <div className="text-sm">Não está no catálogo.</div>
                <Button
                  type="button" variant="ghost" size="sm" className="mt-2 w-full"
                  onClick={() => { onChange(debounced); setOpen(false); }}
                >
                  Solicitar inclusão de "{debounced}"
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ao salvar, o ativo entra como pendente de aprovação.
                </p>
              </CommandEmpty>
            )}
            {(results?.length ?? 0) > 0 && (
              <CommandGroup>
                {results!.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={r.symbol}
                    onSelect={() => {
                      onChange(r.symbol);
                      onPickCurrency?.(r.currency);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === r.symbol ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono font-semibold w-20">{r.symbol}</span>
                    <span className="text-muted-foreground truncate">{r.name ?? ""}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{r.currency}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Formulário ───────────────────────────────────────────────────────────────
function TxForm({
  txType, onClose, onSuccess, preset,
}: {
  txType: "buy" | "sell" | "transfer";
  onClose: () => void;
  onSuccess: (info: { symbol: string; total: string; currency: string }) => void;
  preset?: TxPreset;
}) {
  const isTransfer = txType === "transfer";
  // Transferência interna é exclusiva de criptoativos — força a classe do ativo
  const [assetClass, setAssetClass] = useState<AssetClass>(isTransfer ? "crypto" : (preset?.assetClass ?? "stock"));
  const [symbol, setSymbol] = useState(preset?.symbol ?? "");
  const [currency, setCurrency] = useState<CurrencyCode>(preset?.currency ?? "BRL");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  // Display format dd/mm/aaaa for mobile friendliness
  const todayDisplay = (() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  })();
  const [dateDisplay, setDateDisplay] = useState<string>(todayDisplay);
  const [qty, setQty] = useState<string>("");
  const [priceCents, setPriceCents] = useState<number>(0);
  const [feesCents, setFeesCents] = useState<number>(0);
  const [brokerId, setBrokerId] = useState<string>(""); // p/ transfer = corretora/wallet de DESTINO
  const [fromBrokerId, setFromBrokerId] = useState<string>(""); // só transfer — origem
  const [transferFeeQty, setTransferFeeQty] = useState<string>(""); // taxa de rede, em unidades do próprio ativo

  // ── Renda fixa — campos extras ────────────────────────────────────────────
  const [fiBenchmark, setFiBenchmark] = useState<string>("IPCA+");
  const [fiRateCents, setFiRateCents] = useState<number>(0); // ex: 702 = 7,02%
  const [fiMaturity, setFiMaturity] = useState<string>("");
  const [fiMaturityDisplay, setFiMaturityDisplay] = useState<string>("");
  const [fiIssuer, setFiIssuer] = useState<string>("");
  const [fiNotes, setFiNotes] = useState<string>("");
  const [fiProductType, setFiProductType] = useState<string>("Tesouro Direto");

  const isFixedIncome = assetClass === "fixed_income";

  const listBrokersFn = useServerFn(listBrokers);
  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: () => listBrokersFn(),
    staleTime: 5 * 60_000,
  });

  const price = priceCents / 100;
  const fees = feesCents / 100;
  const qtyNum = parseFloat(qty) || 0;
  // Renda fixa: total = valor aplicado (price), sem qty
  // Compra: taxas SOMAM ao custo (você paga mais do que qty*preço)
  // Venda: taxas SUBTRAEM do valor recebido (você recebe menos do que qty*preço)
  const gross = qtyNum * price;
  const total = txType === "sell" ? gross - fees : gross + fees;
  const qc = useQueryClient();
  const createTx = useServerFn(createTransaction);

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);

  const mutation = useMutation({
    mutationFn: createTx,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["asset-lots"] });
      // Mostra tela de sucesso ao invés de fechar
      onSuccess({
        symbol: symbol.trim().toUpperCase(),
        total: fmt(total),
        currency,
      });
    },
    onError: (err: Error) => toast.error(err.message ?? "Erro ao salvar"),
  });

  const transferFeeQtyNum = parseFloat((transferFeeQty || "0").replace(",", ".")) || 0;
  const transferNetQty = Math.max(qtyNum - transferFeeQtyNum, 0);

  const submit = () => {
    if (!symbol.trim()) { toast.error("Informe o ativo (símbolo)"); return; }
    if (isTransfer) {
      if (qtyNum <= 0) { toast.error("Informe a quantidade transferida"); return; }
      if (!fromBrokerId || fromBrokerId === "none") { toast.error("Informe de onde a transferência saiu"); return; }
      if (!brokerId || brokerId === "none") { toast.error("Informe para onde a transferência foi"); return; }
      if (fromBrokerId === brokerId) { toast.error("Origem e destino devem ser diferentes"); return; }
    } else {
      // Renda fixa: valida valor aplicado; outros: valida quantidade
      if (isFixedIncome && qtyNum <= 0) { toast.error("Informe a quantidade de títulos"); return; }
      if (isFixedIncome && price <= 0) { toast.error("Informe o PU (preço unitário) na compra"); return; }
      if (!isFixedIncome && qtyNum <= 0) { toast.error("Quantidade deve ser maior que zero"); return; }
    }
    mutation.mutate({
      data: {
        symbol: symbol.trim().toUpperCase(),
        assetClass,
        txType,
        occurredAt: date,
        // Renda fixa: quantity = 1, unitPrice = valor aplicado
        // Transferência: quantity = quantidade bruta transferida, unitPrice = referência de mercado (opcional)
        quantity: qtyNum,
        unitPrice: price,
        fees: isTransfer ? 0 : fees,
        currency,
        brokerId: isTransfer
          ? brokerId
          : ((brokerId && brokerId !== "none") ? brokerId : undefined),
        metadata: isFixedIncome ? {
          benchmark: fiBenchmark,
          rate: fiRateCents / 100,
          maturity_date: fiMaturity || null,
          issuer: fiIssuer || null,
          notes: fiNotes || null,
          product_type: fiProductType,
          applied_amount: total,
        } : isTransfer ? {
          from_broker_id: fromBrokerId,
          fee_quantity: transferFeeQtyNum,
        } : undefined,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {isTransfer ? (
          <Field label="Tipo de ativo">
            <Input value="Criptomoedas" disabled className="bg-muted/40 text-muted-foreground" />
          </Field>
        ) : (
          <Field label="Tipo de ativo">
            <Select value={assetClass} onValueChange={(v) => { setAssetClass(v as AssetClass); setSymbol(""); }} disabled={preset?.lockAsset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSET_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Ativo">
          <AssetCombobox
            value={symbol}
            onChange={setSymbol}
            assetClass={assetClass}
            onPickCurrency={(c) => setCurrency(c)}
            disabled={preset?.lockAsset}
          />
        </Field>

        <Field label="Data da transação">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              inputMode="numeric"
              placeholder="DD/MM/AAAA"
              value={dateDisplay}
              onChange={(e) => {
                // Máscara dd/mm/aaaa
                const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                let masked = digits;
                if (digits.length > 2) masked = digits.slice(0, 2) + "/" + digits.slice(2);
                if (digits.length > 4) masked = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
                setDateDisplay(masked);
                // Converte para yyyy-mm-dd quando completo
                if (digits.length === 8) {
                  const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8);
                  setDate(`${y}-${m}-${d}`);
                }
              }}
              className="pl-9"
            />
          </div>
        </Field>
        {/* Campos padrão: Quantidade + Preço */}
        {isTransfer ? (
          <>
            <Field label="Quantidade transferida (bruta)">
              <Input
                type="text"
                inputMode="decimal"
                value={qty}
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setQty(v);
                }}
                placeholder="Ex: 0,05"
              />
            </Field>
            <Field label={<>Taxa de rede <span className="float-right text-xs text-muted-foreground">(Opcional, na própria moeda)</span></>}>
              <Input
                type="text"
                inputMode="decimal"
                value={transferFeeQty}
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setTransferFeeQty(v);
                }}
                placeholder="Ex: 0,0001"
              />
            </Field>

            <Field label={<>Preço de referência <span className="float-right text-xs text-muted-foreground">(Opcional — só p/ registro)</span></>}>
              <MoneyInput cents={priceCents} onChange={setPriceCents} currency={currency} />
            </Field>
            <div className="flex items-end pb-2 text-xs text-muted-foreground">
              {qtyNum > 0 && (
                <span>Chega no destino: <strong className="text-foreground">{transferNetQty.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</strong></span>
              )}
            </div>

            <Field label={<><Building2 className="inline h-3.5 w-3.5 mr-1 opacity-60" />De <span className="float-right text-xs text-muted-foreground">Origem</span></>}>
              <Select value={fromBrokerId} onValueChange={setFromBrokerId}>
                <SelectTrigger><SelectValue placeholder="De onde saiu" /></SelectTrigger>
                <SelectContent>
                  {(brokers as any[]).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                        {b.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={<><Building2 className="inline h-3.5 w-3.5 mr-1 opacity-60" />Para <span className="float-right text-xs text-muted-foreground">Destino</span></>}>
              <Select value={brokerId} onValueChange={setBrokerId}>
                <SelectTrigger><SelectValue placeholder="Para onde foi" /></SelectTrigger>
                <SelectContent>
                  {(brokers as any[]).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                        {b.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <p className="col-span-2 text-xs text-muted-foreground -mt-2">
              Não encontrou sua carteira própria na lista? Cadastre uma nova "corretora" com o nome dela (ex: "Ledger", "MetaMask") em Ajustes.
            </p>
          </>
        ) : !isFixedIncome && (
          <>
            <Field label="Quantidade">
              <Input
                type="text"
                inputMode="decimal"
                value={qty}
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setQty(v);
                }}
                placeholder="0"
              />
            </Field>
            <Field label={<>Preço <span className="font-normal text-muted-foreground">em {currency}</span></>}>
              <MoneyInput cents={priceCents} onChange={setPriceCents} currency={currency} />
            </Field>
          </>
        )}

        {/* Campos de Renda Fixa */}
        {isFixedIncome && (
          <>
            {/* Quantidade de títulos */}
            <Field label={<><Landmark className="inline h-3.5 w-3.5 mr-1 opacity-60" />Quantidade de títulos</>}>
              <Input
                type="text"
                inputMode="decimal"
                value={qty}
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setQty(v);
                }}
                placeholder="Ex: 1,39"
              />
            </Field>

            {/* PU na compra */}
            <Field label={<>PU na compra <span className="font-normal text-muted-foreground">em {currency}</span></>}>
              <MoneyInput cents={priceCents} onChange={setPriceCents} currency={currency} />
            </Field>

            {/* Tipo de produto */}
            <Field label="Tipo de produto">
              <Select value={fiProductType} onValueChange={setFiProductType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Tesouro Direto","CDB","LCI","LCA","Debênture","CRI","CRA","LC","Poupança","Outro"].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Benchmark */}
            <Field label="Benchmark (indexador)">
              <Select value={fiBenchmark} onValueChange={setFiBenchmark}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["IPCA+","Selic","CDI","CDI+","Prefixado","IGP-M+","INPC+"].map(b => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Taxa contratada */}
            <Field label={`Taxa contratada ${fiBenchmark === "Prefixado" ? "(% a.a.)" : "(% sobre o índice)"}`}>
              <RateInput cents={fiRateCents} onChange={setFiRateCents} />
            </Field>

            {/* Vencimento */}
            <Field label="Vencimento">
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD/MM/AAAA"
                  value={fiMaturityDisplay}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                    let masked = digits;
                    if (digits.length > 2) masked = digits.slice(0, 2) + "/" + digits.slice(2);
                    if (digits.length > 4) masked = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
                    setFiMaturityDisplay(masked);
                    if (digits.length === 8) {
                      const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8);
                      setFiMaturity(`${y}-${m}-${d}`);
                    }
                  }}
                  className="pl-9"
                />
              </div>
            </Field>

            {/* Emissor */}
            <Field label={<>Emissor <span className="float-right text-xs text-muted-foreground">(Opcional)</span></>}>
              <Input
                value={fiIssuer}
                onChange={(e) => setFiIssuer(e.target.value)}
                placeholder="Ex: Banco XP, Tesouro Nacional"
              />
            </Field>

            {/* Observações — ex: "garantia de limite de cartão", finalidade específica do título */}
            <Field label={<>Observações <span className="float-right text-xs text-muted-foreground">(Opcional)</span></>}>
              <Input
                value={fiNotes}
                onChange={(e) => setFiNotes(e.target.value)}
                placeholder="Ex: Garantia de limite de cartão"
              />
            </Field>
          </>
        )}
        <Field label="Moeda">
          <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)} disabled={preset?.lockAsset}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        {!isTransfer && (
          <>
            <Field label={<>Outros custos <span className="float-right text-xs text-muted-foreground">(Opcional)</span></>}>
              <MoneyInput cents={feesCents} onChange={setFeesCents} currency={currency} />
            </Field>

            <Field label={<><Building2 className="inline h-3.5 w-3.5 mr-1 opacity-60" />Corretora <span className="float-right text-xs text-muted-foreground">(Opcional)</span></>}>
              <Select value={brokerId} onValueChange={setBrokerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar corretora" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem corretora</SelectItem>
                  {(brokers as any[]).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                        {b.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
        <span className="font-medium">{isFixedIncome ? "Valor total (qtd × PU)" : isTransfer ? "Valor de referência (opcional)" : "Valor total"}</span>
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

// ── RateInput ────────────────────────────────────────────────────────────────
// Dígito a dígito, igual MoneyInput. 702 centésimos = 7,02%
function RateInput({ cents, onChange }: { cents: number; onChange: (v: number) => void }) {
  const display = (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      onChange(Math.floor(cents / 10));
    } else if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const next = cents * 10 + parseInt(e.key);
      if (next <= 999999) onChange(next); // max 9999,99%
    }
  };

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="numeric"
        value={display}
        onKeyDown={handleKey}
        onChange={() => {}}
        className="pr-8 tabular-nums"
        placeholder="0,00"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

// ── MoneyInput ───────────────────────────────────────────────────────────────
function MoneyInput({ cents, onChange, currency }: {
  cents: number;
  onChange: (cents: number) => void;
  currency: string;
}) {
  const currencySymbol: Record<string, string> = {
    BRL: "R$", USD: "US$", EUR: "€", GBP: "£", JPY: "¥",
  };
  const symbol = currencySymbol[currency] ?? currency;

  const display = (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      onChange(Math.floor(cents / 10));
    } else if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const next = cents * 10 + parseInt(e.key);
      if (next <= 9_999_999_99) onChange(next);
    }
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {symbol}
      </span>
      <Input
        type="text"
        inputMode="numeric"
        value={display}
        onKeyDown={handleKey}
        onChange={() => {}}
        className="pl-10 tabular-nums"
        placeholder="0,00"
      />
    </div>
  );
}

// ── Field ────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}
