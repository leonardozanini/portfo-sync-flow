import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
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
  Calculator, Plus, Trash2, ChevronDown, ChevronUp, Wand2, Pencil,
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
  const n = parseFloat(v.replace(",", ".").replace("%", "").trim());
  return isNaN(n) ? 0 : n / 100;
}
function parseNumInput(v: string): number {
  const s = v.trim();
  let normalized: string;
  if (s.includes(",")) {
    // Formato BR: ponto = milhar, vírgula = decimal → "9.017.329.000,00"
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length >= 2) {
    // Múltiplos pontos sem vírgula = todos são separadores de milhar → "1.941.400.000"
    normalized = s.replace(/\./g, "");
  } else {
    // Nenhuma vírgula, no máximo 1 ponto = ponto decimal (formato JS) → "38.13"
    normalized = s;
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}
function fmtNum(v: string): string {
  const n = parseFloat(v.replace(",", "."));
  if (isNaN(n)) return v;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type YearRow = { year: number; growth: string; cashFlow: number; npv: number };

// Motor de cálculo — espelha exatamente a lógica do servidor (computeValuation)
function computeClient(input: {
  discountRate: number;
  perpetuityGrowth: number;
  perpetuityDiscountRate?: number; // undefined = método clássico (usa discountRate); definido = método Buffett
  baseCashFlow: number;
  yearlyGrowthRates: number[];
  priceAtCalc: number;
  sharesOutstanding: number;
}) {
  const { discountRate, perpetuityGrowth, baseCashFlow, yearlyGrowthRates, priceAtCalc, sharesOutstanding } = input;
  const perpDiscountRate = input.perpetuityDiscountRate ?? discountRate;
  if (discountRate <= 0 || perpDiscountRate <= perpetuityGrowth || !sharesOutstanding) {
    return null;
  }
  let cashFlow = baseCashFlow;
  let npvSum = 0;
  const rows: YearRow[] = [];
  yearlyGrowthRates.forEach((growth, i) => {
    const n = i + 1;
    cashFlow = cashFlow * (1 + growth);
    const npv = cashFlow / Math.pow(1 + discountRate, n);
    npvSum += npv;
    rows.push({ year: n, growth: pct(growth), cashFlow, npv });
  });
  const terminalCashFlow = cashFlow * (1 + perpetuityGrowth);
  const terminalValue = terminalCashFlow / (perpDiscountRate - perpetuityGrowth);
  const n = yearlyGrowthRates.length;
  const terminalNpv = terminalValue / Math.pow(1 + perpDiscountRate, n);
  const fairMarketCap = npvSum + terminalNpv;
  const fairPrice = fairMarketCap / sharesOutstanding;
  const upsidePct = priceAtCalc > 0 ? (fairPrice - priceAtCalc) / priceAtCalc : 0;
  return { rows, terminalValue, terminalNpv, fairMarketCap, fairPrice, upsidePct };
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
  const asset = allAssets.find(a => a.assetId === selectedAssetId);
  const [showHistory, setShowHistory] = useState(false);

  // ── Estado do formulário (todos os campos "amarelos" da planilha) ──────────
  const [priceOverride, setPriceOverride] = useState("");
  const [sharesOutstanding, setSharesOutstanding] = useState("");
  const [method, setMethod] = useState<"classic" | "buffett">("classic");
  const [discountRate, setDiscountRate] = useState("8,00");
  const [perpetuityGrowth, setPerpetuityGrowth] = useState("2,50");
  const [perpetuityDiscountRate, setPerpetuityDiscountRate] = useState("10,00");
  const [payout, setPayout] = useState("30,00");
  const [roe, setRoe] = useState("15,00");
  const [cashFlowLabel, setCashFlowLabel] = useState<"Lucro Líquido" | "Fluxo de Caixa Livre">("Lucro Líquido");
  const [baseCashFlow, setBaseCashFlow] = useState("");
  const [baseYear, setBaseYear] = useState(String(new Date().getFullYear()));
  const [growthRates, setGrowthRates] = useState<string[]>(["5,00", "5,00", "5,00", "5,00", "5,00"]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedFromId, setLoadedFromId] = useState<string | null>(null);
  const skipNextAutoLoad = useRef(false);

  // Preenche o formulário a partir de um valuation salvo (existente ou selecionado no histórico)
  const loadValuationIntoForm = (v: any) => {
    setPriceOverride(Number(v.priceAtCalc).toFixed(2).replace(".", ","));
    setSharesOutstanding(String(v.sharesOutstanding));
    setDiscountRate((Number(v.discountRate) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
    setPerpetuityGrowth((Number(v.perpetuityGrowth) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
    setMethod(v.method === "buffett" ? "buffett" : "classic");
    setPerpetuityDiscountRate(
      v.perpetuityDiscountRate != null
        ? (Number(v.perpetuityDiscountRate) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })
        : "10,00"
    );
    setCashFlowLabel(v.cashFlowLabel);
    setBaseCashFlow(Number(v.baseCashFlow).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setGrowthRates((v.yearlyGrowthRates as number[]).map(g => (g * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })));
    setNotes(v.notes ?? "");
    setLoadedFromId(v.id);
  };

  // Ao trocar de ativo: se já existe um valuation salvo para ele, carrega as premissas automaticamente.
  // Caso contrário, começa do zero (com o preço atual pré-preenchido).
  useEffect(() => {
    if (!asset) return;
    if (skipNextAutoLoad.current) { skipNextAutoLoad.current = false; return; }
    const latest = valuations.find((v: any) => v.assetId === asset.assetId);
    if (latest) {
      loadValuationIntoForm(latest);
    } else {
      setPriceOverride(asset.currentPrice.toFixed(2).replace(".", ","));
      setSharesOutstanding("");
      setDiscountRate("8,00");
      setPerpetuityGrowth("2,50");
      setMethod("classic");
      setPerpetuityDiscountRate("10,00");
      setCashFlowLabel("Lucro Líquido");
      setBaseCashFlow("");
      setGrowthRates(["5,00", "5,00", "5,00", "5,00", "5,00"]);
      setNotes("");
      setLoadedFromId(null);
    }
  }, [asset?.assetId]);

  const price = priceOverride ? parseNumInput(priceOverride) : (asset?.currentPrice ?? 0);
  const shares = parseNumInput(sharesOutstanding);
  const dRate = parsePctInput(discountRate);
  const pGrowth = parsePctInput(perpetuityGrowth);
  const pPerpDiscountRate = parsePctInput(perpetuityDiscountRate);
  const bCashFlow = parseNumInput(baseCashFlow);
  const effectivePerpDiscountRate = method === "buffett" ? pPerpDiscountRate : undefined;

  const result = useMemo(() => computeClient({
    discountRate: dRate,
    perpetuityGrowth: pGrowth,
    perpetuityDiscountRate: effectivePerpDiscountRate,
    baseCashFlow: bCashFlow,
    yearlyGrowthRates: growthRates.map(parsePctInput),
    priceAtCalc: price,
    sharesOutstanding: shares,
  }), [dRate, pGrowth, effectivePerpDiscountRate, bCashFlow, growthRates, price, shares]);

  const suggestedGrowth = (1 - parsePctInput(payout)) * parsePctInput(roe);

  const applySuggestedGrowth = () => {
    setGrowthRates(growthRates.map(() => (suggestedGrowth * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })));
    toast.success(`Aplicado (1-payout)×ROE = ${pct(suggestedGrowth)} a todos os anos`);
  };

  const addYear = () => setGrowthRates([...growthRates, "3,00"]);
  const removeYear = (i: number) => growthRates.length > 1 && setGrowthRates(growthRates.filter((_, idx) => idx !== i));
  const updateYear = (i: number, v: string) => setGrowthRates(growthRates.map((g, idx) => idx === i ? v : g));

  const saveFn = useServerFn(saveValuation);

  const handleSave = async () => {
    if (!asset) { toast.error("Selecione um ativo"); return; }
    if (!bCashFlow) { toast.error(`Informe o ${cashFlowLabel.toLowerCase()} do ano base`); return; }
    if (!shares) { toast.error("Informe o número total de ações"); return; }
    const effRate = method === "buffett" ? pPerpDiscountRate : dRate;
    if (effRate <= pGrowth) { toast.error("A taxa de desconto do perpétuo deve ser maior que o crescimento na perpetuidade"); return; }

    setSaving(true);
    try {
      const r = await saveFn({
        data: {
          assetId: asset.assetId,
          discountRate: dRate,
          perpetuityGrowth: pGrowth,
          perpetuityDiscountRate: method === "buffett" ? pPerpDiscountRate : undefined,
          method,
          baseCashFlow: bCashFlow,
          cashFlowLabel,
          yearlyGrowthRates: growthRates.map(parsePctInput),
          priceAtCalc: price,
          sharesOutstanding: shares,
          currency: asset.currency,
          notes: notes || undefined,
        },
      });
      toast.success(`Salvo! Preço-teto: ${formatMoney(r.fairPrice, asset.currency as any)}`);
      refetchValuations();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar valuation");
    } finally {
      setSaving(false);
    }
  };

  const assetCurrency = (asset?.currency ?? currency) as any;
  const marketCapAtual = price * shares;
  const isUpside = (result?.upsidePct ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" /> Valuation
          </h1>
          <p className="text-sm text-muted-foreground">
            Preço-teto pelo método de Fluxo de Caixa Descontado (DCF).
          </p>
          {loadedFromId && (
            <p className="text-xs text-primary mt-1 flex items-center gap-1">
              <Pencil className="h-3 w-3" /> Premissas salvas carregadas — altere o que quiser e clique em "Salvar" para atualizar.
            </p>
          )}
        </div>
        <div className="w-64">
          <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
            <SelectTrigger><SelectValue placeholder="Selecione um ativo…" /></SelectTrigger>
            <SelectContent>
              {allAssets.map(a => {
                const hasValuation = valuations.some((v: any) => v.assetId === a.assetId);
                return (
                  <SelectItem key={a.assetId} value={a.assetId}>
                    {a.symbol} — {a.name} {hasValuation ? "✓" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!asset ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
            <Calculator className="h-10 w-10 opacity-30" />
            <p>Selecione um ativo acima para começar o valuation.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* ── Coluna esquerda: cards de premissas, estilo planilha ──────── */}
          <div className="space-y-4">
            <SpreadCard title="Realidade Atual">
              <SpreadRow label="Ticker" value={asset.symbol} bold />
              <SpreadRow label="Preço por ação">
                <Input value={priceOverride} onChange={e => setPriceOverride(e.target.value)}
                  className="h-7 text-right text-sm font-semibold bg-primary/5 border-primary/20" inputMode="decimal" />
              </SpreadRow>
              <SpreadRow label="Nº de ações">
                <Input value={sharesOutstanding} onChange={e => setSharesOutstanding(e.target.value)}
                  className="h-7 text-right text-sm font-semibold bg-primary/5 border-primary/20"
                  inputMode="decimal" placeholder="Ex: 2000000000" />
              </SpreadRow>
              <SpreadRow label="Market cap" value={formatMoney(marketCapAtual, assetCurrency)} bold />
            </SpreadCard>

            <SpreadCard title="Premissas">
              {/* Método: FCD Clássico ou Buffett (taxa fixa no perpétuo) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Método</Label>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  <button
                    onClick={() => setMethod("classic")}
                    className={`flex-1 px-2 py-1.5 transition-colors ${
                      method === "classic" ? "bg-primary text-primary-foreground font-semibold" : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    FCD Clássico
                  </button>
                  <button
                    onClick={() => setMethod("buffett")}
                    className={`flex-1 px-2 py-1.5 transition-colors ${
                      method === "buffett" ? "bg-primary text-primary-foreground font-semibold" : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Buffett
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {method === "classic"
                    ? "Desconta a perpetuidade pela mesma taxa usada nos anos projetados."
                    : "Desconta a perpetuidade por uma taxa fixa — custo de oportunidade do mercado, independente do risco específico da empresa."}
                </p>
              </div>

              <SpreadRow label="Taxa de desconto (i)">
                <PctInput value={discountRate} onChange={setDiscountRate} />
              </SpreadRow>
              <SpreadRow label="Cresc. perpétuo (g)">
                <PctInput value={perpetuityGrowth} onChange={setPerpetuityGrowth} />
              </SpreadRow>
              {method === "buffett" && (
                <SpreadRow label="Taxa desc. perpétuo">
                  <PctInput value={perpetuityDiscountRate} onChange={setPerpetuityDiscountRate} />
                </SpreadRow>
              )}
              <div className="pt-2 mt-2 border-t border-border space-y-2">
                <SpreadRow label="Payout">
                  <PctInput value={payout} onChange={setPayout} />
                </SpreadRow>
                <SpreadRow label="ROE">
                  <PctInput value={roe} onChange={setRoe} />
                </SpreadRow>
                <button
                  onClick={applySuggestedGrowth}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-primary hover:underline mt-1"
                >
                  <Wand2 className="h-3 w-3" />
                  Sugerir crescimento: (1-payout)×ROE = {pct(suggestedGrowth)}
                </button>
              </div>
            </SpreadCard>

            <SpreadCard title="Realidade Projetada" tone={isUpside ? "success" : "destructive"}>
              <SpreadRow label="Preço-teto"
                value={result ? formatMoney(result.fairPrice, assetCurrency) : "—"} bold big />
              <SpreadRow label="Market cap justo"
                value={result ? formatMoney(result.fairMarketCap, assetCurrency) : "—"} />
              <SpreadRow label="Upside/Downside">
                <span className={`text-sm font-bold ${isUpside ? "text-success" : "text-destructive"}`}>
                  {result ? `${isUpside ? "+" : ""}${pct(result.upsidePct)}` : "—"}
                </span>
              </SpreadRow>
            </SpreadCard>

            <div className="space-y-1.5">
              <Label className="text-xs">Notas (opcional)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: tese baseada em resultado 2026T1" className="h-8 text-sm" />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full folio-gradient text-white border-0">
              {saving ? "Salvando…" : "Salvar Valuation"}
            </Button>
          </div>

          {/* ── Coluna direita: tabela ano a ano, estilo planilha ─────────── */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Projeção de Fluxo de Caixa</CardTitle>
              <div className="flex items-center gap-3">
                <Select value={cashFlowLabel} onValueChange={(v: any) => setCashFlowLabel(v)}>
                  <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Lucro Líquido">Lucro Líquido</SelectItem>
                    <SelectItem value="Fluxo de Caixa Livre">Fluxo de Caixa Livre (FCF)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5 font-medium">Ano</th>
                      <th className="text-right px-4 py-2.5 font-medium">{cashFlowLabel}</th>
                      <th className="text-right px-4 py-2.5 font-medium">Crescimento</th>
                      <th className="text-right px-4 py-2.5 font-medium">VPL</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Linha base (ano 0 — ano atual, editável) */}
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td className="px-4 py-2">
                        <Input value={baseYear} onChange={e => setBaseYear(e.target.value)}
                          className="h-7 w-20 text-sm font-semibold" />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Input value={baseCashFlow} onChange={e => setBaseCashFlow(e.target.value)}
                          onBlur={e => setBaseCashFlow(fmtNum(e.target.value))}
                          className="h-7 text-right text-sm font-semibold bg-primary/5 border-primary/20 ml-auto"
                          inputMode="decimal" placeholder="Ex: 9017329000" />
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground">Ano base</td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground">—</td>
                      <td></td>
                    </tr>

                    {/* Anos projetados */}
                    {result?.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2 font-medium tabular-nums">{Number(baseYear) + row.year}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.cashFlow, assetCurrency)}</td>
                        <td className="px-4 py-2 text-right">
                          <PctInput
                            value={growthRates[i]}
                            onChange={(v) => updateYear(i, v)}
                            className="ml-auto"
                          />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-primary font-medium">{formatMoney(row.npv, assetCurrency)}</td>
                        <td className="px-2 py-2">
                          {growthRates.length > 1 && (
                            <button onClick={() => removeYear(i)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Linha para adicionar ano */}
                    <tr>
                      <td colSpan={5} className="px-4 py-2">
                        <button onClick={addYear} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                          <Plus className="h-3.5 w-3.5" /> Adicionar ano
                        </button>
                      </td>
                    </tr>

                    {/* Perpetuidade */}
                    <tr className="border-t-2 border-border bg-primary/5">
                      <td className="px-4 py-3 font-semibold">Perpétuo</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {result ? formatMoney(result.terminalValue, assetCurrency) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-muted-foreground">
                          g = {pct(pGrowth)} · i = {pct(effectivePerpDiscountRate ?? dRate)}
                          {method === "buffett" && <span className="text-primary"> (Buffett)</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-primary">
                        {result ? formatMoney(result.terminalNpv, assetCurrency) : "—"}
                      </td>
                      <td></td>
                    </tr>

                    {/* Total */}
                    <tr className="bg-muted/40 font-bold">
                      <td className="px-4 py-3" colSpan={3}>Market Cap Justo (Total VPL)</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {result ? formatMoney(result.fairMarketCap, assetCurrency) : "—"}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
            <ValuationHistory
              valuations={valuations}
              onDeleted={() => refetchValuations()}
              onEdit={(v) => {
                skipNextAutoLoad.current = true;
                setSelectedAssetId(v.assetId);
                loadValuationIntoForm(v);
                toast.info(`Premissas de ${v.symbol} carregadas no formulário`);
              }}
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── Componentes auxiliares de UI, estilo "planilha" ──────────────────────────

function SpreadCard({ title, tone, children }: { title: string; tone?: "success" | "destructive"; children: React.ReactNode }) {
  const toneClass = tone === "success" ? "border-success/30 bg-success/5"
    : tone === "destructive" ? "border-destructive/30 bg-destructive/5"
    : "";
  return (
    <div className={`rounded-xl border border-border overflow-hidden ${toneClass}`}>
      <div className="bg-muted/50 px-3 py-2 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      <div className="p-3 space-y-2">
        {children}
      </div>
    </div>
  );
}

function SpreadRow({ label, value, bold, big, children }: {
  label: string; value?: string; bold?: boolean; big?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      {children ?? (
        <span className={`text-right tabular-nums ${bold ? "font-semibold" : ""} ${big ? "text-lg" : "text-sm"}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function PctInput({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={`relative w-24 ${className}`}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-7 text-right text-sm font-semibold bg-primary/5 border-primary/20 pr-6"
        inputMode="decimal"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}

// ── Histórico ─────────────────────────────────────────────────────────────────

function ValuationHistory({ valuations, onDeleted, onEdit }: { valuations: any[]; onDeleted: () => void; onEdit: (v: any) => void }) {
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
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => onEdit(v)}>
                  <Pencil className="h-3 w-3" /> Editar
                </Button>
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
