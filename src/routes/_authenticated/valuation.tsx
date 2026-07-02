import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getDashboard, saveValuation, listValuations, deleteValuation,
  type GroupedAsset,
} from "@/lib/portfolio.functions";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { formatMoney } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Calculator, TrendingUp, TrendingDown, Plus, Trash2, Info, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/valuation")({
  head: () => ({ meta: [{ title: "Valuation — Folio" }] }),
  component: ValuationPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

function parsePctInput(v: string): number {
  const clean = v.replace(",", ".").replace("%", "").trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n / 100;
}

// ── Página principal ─────────────────────────────────────────────────────────

function ValuationPage() {
  const { currency } = useDisplayCurrency();

  const { data: dash } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    staleTime: 30_000,
  });

  const { data: valuations = [], refetch: refetchValuations } = useQuery({
    queryKey: ["valuations"],
    queryFn: () => listValuations(),
    staleTime: 30_000,
  });

  const allAssets: GroupedAsset[] = useMemo(() => {
    if (!dash) return [];
    return dash.groups.flatMap(g => g.assets);
  }, [dash]);

  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const selectedAsset = allAssets.find(a => a.assetId === selectedAssetId);

  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Calculator className="h-6 w-6 text-primary" /> Valuation
        </h1>
        <p className="text-sm text-muted-foreground">
          Calcule o preço-teto de um ativo pelo método de Fluxo de Caixa Descontado (DCF).
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <ValuationForm
          assets={allAssets}
          selectedAssetId={selectedAssetId}
          onSelectAsset={setSelectedAssetId}
          currency={currency}
          onSaved={() => { refetchValuations(); }}
        />

        <div className="space-y-4">
          {selectedAsset ? (
            <ValuationResultPanel asset={selectedAsset} currency={currency} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
                <Calculator className="h-10 w-10 opacity-30" />
                <p>Selecione um ativo e preencha as premissas para calcular o preço-teto.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Histórico */}
      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setShowHistory(!showHistory)}>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Histórico de Valuations ({valuations.length})</span>
            {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardTitle>
        </CardHeader>
        {showHistory && (
          <CardContent>
            <ValuationHistory valuations={valuations} onDeleted={() => refetchValuations()} />
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── Formulário de premissas ───────────────────────────────────────────────────

function ValuationForm({
  assets, selectedAssetId, onSelectAsset, currency, onSaved,
}: {
  assets: GroupedAsset[];
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  currency: string;
  onSaved: () => void;
}) {
  const asset = assets.find(a => a.assetId === selectedAssetId);

  const [discountRate, setDiscountRate] = useState("8,00");
  const [perpetuityGrowth, setPerpetuityGrowth] = useState("2,50");
  const [cashFlowLabel, setCashFlowLabel] = useState<"Lucro Líquido" | "Fluxo de Caixa Livre">("Lucro Líquido");
  const [baseCashFlow, setBaseCashFlow] = useState("");
  const [sharesOutstanding, setSharesOutstanding] = useState("");
  const [priceOverride, setPriceOverride] = useState("");
  const [growthRates, setGrowthRates] = useState<string[]>(["5,00", "5,00", "5,00", "5,00", "5,00"]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const saveFn = useServerFn(saveValuation);

  const addYear = () => setGrowthRates([...growthRates, "3,00"]);
  const removeYear = (i: number) => setGrowthRates(growthRates.filter((_, idx) => idx !== i));
  const updateYear = (i: number, v: string) => setGrowthRates(growthRates.map((g, idx) => idx === i ? v : g));

  const handleSave = async () => {
    if (!asset) { toast.error("Selecione um ativo"); return; }
    const dRate = parsePctInput(discountRate);
    const pGrowth = parsePctInput(perpetuityGrowth);
    const bCashFlow = parseFloat(baseCashFlow.replace(",", "."));
    const shares = parseFloat(sharesOutstanding.replace(",", "."));
    const price = priceOverride ? parseFloat(priceOverride.replace(",", ".")) : asset.currentPrice;

    if (!bCashFlow) { toast.error(`Informe o ${cashFlowLabel.toLowerCase()} do ano base`); return; }
    if (!shares) { toast.error("Informe o número total de ações"); return; }
    if (dRate <= pGrowth) { toast.error("A taxa de desconto deve ser maior que o crescimento na perpetuidade"); return; }

    setSaving(true);
    try {
      const result = await saveFn({
        data: {
          assetId: asset.assetId,
          discountRate: dRate,
          perpetuityGrowth: pGrowth,
          baseCashFlow: bCashFlow,
          cashFlowLabel,
          yearlyGrowthRates: growthRates.map(g => parsePctInput(g)),
          priceAtCalc: price,
          sharesOutstanding: shares,
          currency: asset.currency,
          notes: notes || undefined,
        },
      });
      toast.success(`Preço-teto calculado: ${formatMoney(result.fairPrice, currency as any)}`);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao calcular valuation");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-base">Premissas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Ativo</Label>
          <Select value={selectedAssetId} onValueChange={onSelectAsset}>
            <SelectTrigger><SelectValue placeholder="Selecione um ativo…" /></SelectTrigger>
            <SelectContent>
              {assets.map(a => (
                <SelectItem key={a.assetId} value={a.assetId}>{a.symbol} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {asset && (
          <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Preço atual</span><span className="font-semibold">{formatMoney(asset.currentPrice, asset.currency as any)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Moeda</span><span className="font-semibold">{asset.currency}</span></div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Preço por ação (opcional — sobrescreve o atual)</Label>
          <Input value={priceOverride} onChange={e => setPriceOverride(e.target.value)}
            placeholder={asset ? String(asset.currentPrice) : "0,00"} inputMode="decimal" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              Taxa de desconto (% a.a.)
            </Label>
            <Input value={discountRate} onChange={e => setDiscountRate(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Crescimento perpétuo (%)</Label>
            <Input value={perpetuityGrowth} onChange={e => setPerpetuityGrowth(e.target.value)} inputMode="decimal" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de fluxo</Label>
          <Select value={cashFlowLabel} onValueChange={(v: any) => setCashFlowLabel(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Lucro Líquido">Lucro Líquido</SelectItem>
              <SelectItem value="Fluxo de Caixa Livre">Fluxo de Caixa Livre (FCF)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{cashFlowLabel} — ano base (valor total, não por ação)</Label>
          <Input value={baseCashFlow} onChange={e => setBaseCashFlow(e.target.value)} inputMode="decimal" placeholder="Ex: 58471000000" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Número total de ações</Label>
          <Input value={sharesOutstanding} onChange={e => setSharesOutstanding(e.target.value)} inputMode="decimal" placeholder="Ex: 2716000000" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Crescimento projetado por ano (%)</Label>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addYear}>
              <Plus className="h-3 w-3 mr-1" />Ano
            </Button>
          </div>
          <div className="space-y-1.5">
            {growthRates.map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-10 shrink-0">Ano {i + 1}</span>
                <Input value={g} onChange={e => updateYear(i, e.target.value)} inputMode="decimal" className="h-8 text-sm" />
                {growthRates.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeYear(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Notas (opcional)</Label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: tese baseada em resultado 2026T1" />
        </div>

        <Button onClick={handleSave} disabled={saving || !asset} className="w-full folio-gradient text-white border-0">
          {saving ? "Calculando…" : "Calcular Preço-Teto"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Painel de resultado (usa último valuation salvo para o ativo) ────────────

function ValuationResultPanel({ asset, currency }: { asset: GroupedAsset; currency: string }) {
  const { data: valuations = [] } = useQuery({
    queryKey: ["valuations"],
    queryFn: () => listValuations(),
    staleTime: 30_000,
  });

  const latestForAsset = valuations.find((v: any) => v.assetId === asset.assetId);

  if (!latestForAsset) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
          <Info className="h-10 w-10 opacity-30" />
          <p>Nenhum valuation calculado para {asset.symbol} ainda.</p>
          <p className="text-xs">Preencha as premissas ao lado e clique em "Calcular Preço-Teto".</p>
        </CardContent>
      </Card>
    );
  }

  const isUpside = latestForAsset.upsidePct >= 0;

  return (
    <div className="space-y-4">
      <Card className={isUpside ? "border-success/30" : "border-destructive/30"}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Preço-teto de {latestForAsset.symbol}</p>
              <p className="text-4xl font-bold tracking-tight tabular-nums">
                {formatMoney(latestForAsset.fairPrice, latestForAsset.currency as any)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Preço atual: {formatMoney(latestForAsset.priceAtCalc, latestForAsset.currency as any)}
              </p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${isUpside ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {isUpside ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              <div>
                <p className="text-xl font-bold tabular-nums">{isUpside ? "+" : ""}{pct(latestForAsset.upsidePct)}</p>
                <p className="text-[10px] uppercase tracking-wide">{isUpside ? "Upside" : "Downside"}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premissas utilizadas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Taxa de desconto</p>
              <p className="font-semibold">{pct(latestForAsset.discountRate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Crescimento perpétuo</p>
              <p className="font-semibold">{pct(latestForAsset.perpetuityGrowth)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{latestForAsset.cashFlowLabel} (base)</p>
              <p className="font-semibold">{formatMoney(latestForAsset.baseCashFlow, latestForAsset.currency as any)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ações em circulação</p>
              <p className="font-semibold">{latestForAsset.sharesOutstanding.toLocaleString("pt-BR")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Market cap justo</p>
              <p className="font-semibold">{formatMoney(latestForAsset.fairMarketCap, latestForAsset.currency as any)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Anos projetados</p>
              <p className="font-semibold">{latestForAsset.yearlyGrowthRates.length}</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Crescimento projetado por ano</p>
            <div className="flex flex-wrap gap-2">
              {latestForAsset.yearlyGrowthRates.map((g: number, i: number) => (
                <span key={i} className="text-xs px-2 py-1 rounded-md bg-muted">
                  Ano {i + 1}: {pct(g)}
                </span>
              ))}
            </div>
          </div>

          {latestForAsset.notes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Notas</p>
              <p className="text-sm">{latestForAsset.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Histórico ─────────────────────────────────────────────────────────────────

function ValuationHistory({ valuations, onDeleted }: { valuations: any[]; onDeleted: () => void }) {
  const [toDelete, setToDelete] = useState<string | null>(null);
  const deleteFn = useServerFn(deleteValuation);

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteFn({ data: { id: toDelete } });
      toast.success("Valuation removido");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover");
    } finally {
      setToDelete(null);
    }
  };

  if (!valuations.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Nenhum valuation calculado ainda.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {valuations.map((v) => {
          const isUpside = v.upsidePct >= 0;
          return (
            <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="font-mono font-semibold text-sm w-20 shrink-0">{v.symbol}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleDateString("pt-BR")} · Preço-teto: <span className="font-semibold text-foreground">{formatMoney(v.fairPrice, v.currency)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-sm font-semibold ${isUpside ? "text-success" : "text-destructive"}`}>
                  {isUpside ? "+" : ""}{pct(v.upsidePct)}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setToDelete(v.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover valuation?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
