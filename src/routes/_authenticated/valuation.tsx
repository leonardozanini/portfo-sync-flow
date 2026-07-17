import { createFileRoute } from "@tanstack/react-router";
import { AssetLogo } from "@/components/AssetLogo";
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
  Calculator, Plus, Trash2, ChevronDown, ChevronUp, Wand2, Pencil, Eye,
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

// Formata número inteiro com separador de milhar (ponto), sem casas decimais —
// usado pra campos de contagem, como número de ações (ex: 2.720.000.000)
function fmtInt(v: string): string {
  const n = parseNumInput(v);
  if (!n) return v;
  return Math.round(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

type YearRow = { year: number; growth: string; cashFlow: number; npv: number };

// Motor de cálculo — espelha exatamente a lógica do servidor (computeValuation)
function computeClient(input: {
  discountRate: number;
  perpetuityGrowth: number;
  perpetuityDiscountRate?: number; // undefined = método clássico (usa discountRate); definido = método Buffett
  method?: "classic" | "buffett" | "bazin";
  baseCashFlow: number;
  yearlyGrowthRates: number[];
  priceAtCalc: number;
  sharesOutstanding: number;
}) {
  const { discountRate, baseCashFlow, yearlyGrowthRates, priceAtCalc, sharesOutstanding } = input;
  const method = input.method ?? "classic";
  const perpDiscountRate = input.perpetuityDiscountRate ?? discountRate;
  // Método Buffett: crescimento perpétuo aplicado como negativo (fluxo em declínio no
  // longuíssimo prazo) — calibrado para bater com a plataforma de referência do usuário.
  const perpetuityGrowth = method === "buffett" ? -Math.abs(input.perpetuityGrowth) : input.perpetuityGrowth;

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
  // Método Buffett desconta o valor terminal por (n-1) anos em vez de n.
  const terminalDiscountYears = method === "buffett" ? Math.max(n - 1, 1) : n;
  const terminalNpv = terminalValue / Math.pow(1 + perpDiscountRate, terminalDiscountYears);
  const fairMarketCap = npvSum + terminalNpv;
  const fairPrice = fairMarketCap / sharesOutstanding;
  const upsidePct = priceAtCalc > 0 ? (fairPrice - priceAtCalc) / priceAtCalc : 0;
  return { rows, terminalValue, terminalNpv, fairMarketCap, fairPrice, upsidePct };
}

// Método Bazin — espelha exatamente a lógica do servidor (computeBazin)
function computeBazinClient(input: {
  desiredYield: number;
  payout: number;
  projectedProfit: number;
  sharesOutstanding: number;
  unitMultiplier: number;
  priceAtCalc: number;
}) {
  const { desiredYield, payout, projectedProfit, sharesOutstanding, unitMultiplier, priceAtCalc } = input;
  if (desiredYield <= 0 || !sharesOutstanding) return null;
  const dpa = (projectedProfit * payout / sharesOutstanding) * unitMultiplier;
  const fairPrice = dpa / desiredYield;
  const projectedYield = priceAtCalc > 0 ? dpa / priceAtCalc : 0;
  const safetyMargin = priceAtCalc > 0 ? (fairPrice / priceAtCalc) - 1 : 0;
  const fairMarketCap = fairPrice * sharesOutstanding / unitMultiplier;
  return { dpa, fairPrice, fairMarketCap, projectedYield, safetyMargin, upsidePct: safetyMargin };
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

  // Valuation faz sentido para ações e REITs (empresas com lucro/dividendos) —
  // FIIs "de papel", cripto, ETFs e renda fixa ficam de fora dessa lista.
  const VALUATION_CLASSES = new Set(["stock", "stock_intl", "reit_intl"]); // Ações, Stocks e REITs — não inclui FIIs ("reit")
  const allAssets: GroupedAsset[] = useMemo(() => {
    if (!dash) return [];
    return dash.groups.flatMap(g => g.assets).filter(a => VALUATION_CLASSES.has(a.assetClass));
  }, [dash]);

  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const asset = allAssets.find(a => a.assetId === selectedAssetId);
  const [showHistory, setShowHistory] = useState(false);

  // ── Estado do formulário (todos os campos "amarelos" da planilha) ──────────
  const [priceOverride, setPriceOverride] = useState("");
  const [sharesOutstanding, setSharesOutstanding] = useState("");
  const [method, setMethod] = useState<"classic" | "buffett" | "bazin">("classic");
  const [discountRate, setDiscountRate] = useState("8,00");
  const [perpetuityGrowth, setPerpetuityGrowth] = useState("2,50");
  const [perpetuityDiscountRate, setPerpetuityDiscountRate] = useState("10,00");
  const [payout, setPayout] = useState("30,00");
  const [roe, setRoe] = useState("15,00");
  // Método Bazin
  const [desiredYield, setDesiredYield] = useState("7,00");
  const [bazinPayout, setBazinPayout] = useState("85,00");
  const [projectedProfit, setProjectedProfit] = useState("");
  const [unitMultiplier, setUnitMultiplier] = useState("1");
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
    setSharesOutstanding(Number(v.sharesOutstanding).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
    setDiscountRate((Number(v.discountRate) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
    setPerpetuityGrowth((Number(v.perpetuityGrowth) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
    setMethod(v.method === "buffett" ? "buffett" : "classic");
    setPerpetuityDiscountRate(
      v.perpetuityDiscountRate != null
        ? (Number(v.perpetuityDiscountRate) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })
        : "10,00"
    );
    setCashFlowLabel(v.cashFlowLabel);
    if (v.method === "bazin") {
      setDesiredYield(v.desiredYield != null ? (Number(v.desiredYield) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "7,00");
      setBazinPayout(v.payout != null ? (Number(v.payout) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "85,00");
      setProjectedProfit(v.projectedProfit != null ? Number(v.projectedProfit).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
      setUnitMultiplier(String(v.unitMultiplier ?? 1));
    } else {
      setBaseCashFlow(v.baseCashFlow != null ? Number(v.baseCashFlow).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
      setGrowthRates(v.yearlyGrowthRates ? (v.yearlyGrowthRates as number[]).map(g => (g * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })) : ["5,00", "5,00", "5,00", "5,00", "5,00"]);
    }
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
      setDesiredYield("7,00");
      setBazinPayout("85,00");
      setProjectedProfit("");
      setUnitMultiplier("1");
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

  const dDesiredYield = parsePctInput(desiredYield);
  const dBazinPayout = parsePctInput(bazinPayout);
  const dProjectedProfit = parseNumInput(projectedProfit);
  const dUnitMultiplier = parseNumInput(unitMultiplier) || 1;

  const dcfResult = useMemo(() => computeClient({
    discountRate: dRate,
    perpetuityGrowth: pGrowth,
    perpetuityDiscountRate: effectivePerpDiscountRate,
    method: method === "bazin" ? "classic" : method,
    baseCashFlow: bCashFlow,
    yearlyGrowthRates: growthRates.map(parsePctInput),
    priceAtCalc: price,
    sharesOutstanding: shares,
  }), [dRate, pGrowth, effectivePerpDiscountRate, method, bCashFlow, growthRates, price, shares]);

  const bazinResult = useMemo(() => computeBazinClient({
    desiredYield: dDesiredYield,
    payout: dBazinPayout,
    projectedProfit: dProjectedProfit,
    sharesOutstanding: shares,
    unitMultiplier: dUnitMultiplier,
    priceAtCalc: price,
  }), [dDesiredYield, dBazinPayout, dProjectedProfit, shares, dUnitMultiplier, price]);

  const result = method === "bazin" ? bazinResult : dcfResult;

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
    if (!shares) { toast.error("Informe o número total de ações"); return; }

    if (method === "bazin") {
      if (!dProjectedProfit) { toast.error("Informe o lucro projetado"); return; }
      if (dDesiredYield <= 0) { toast.error("Informe o Dividend Yield desejado"); return; }
    } else {
      if (!bCashFlow) { toast.error(`Informe o ${cashFlowLabel.toLowerCase()} do ano base`); return; }
      const effRate = method === "buffett" ? pPerpDiscountRate : dRate;
      if (effRate <= pGrowth) { toast.error("A taxa de desconto do perpétuo deve ser maior que o crescimento na perpetuidade"); return; }
    }

    setSaving(true);
    try {
      const r = await saveFn({
        data: {
          assetId: asset.assetId,
          method,
          ...(method === "bazin" ? {
            desiredYield: dDesiredYield,
            payout: dBazinPayout,
            projectedProfit: dProjectedProfit,
            unitMultiplier: dUnitMultiplier,
          } : {
            discountRate: dRate,
            perpetuityGrowth: pGrowth,
            perpetuityDiscountRate: method === "buffett" ? pPerpDiscountRate : undefined,
            baseCashFlow: bCashFlow,
            cashFlowLabel,
            yearlyGrowthRates: growthRates.map(parsePctInput),
          }),
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
          {loadedFromId && (
            <p className="text-xs text-primary mt-1 flex items-center gap-1">
              <Pencil className="h-3 w-3" /> Premissas salvas carregadas — altere o que quiser e clique em "Salvar" para atualizar.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tipo de Valuation — nível 1, agora no topo junto ao seletor de ativo */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              onClick={() => setMethod("classic")}
              className={`px-3 py-2 transition-colors font-medium whitespace-nowrap ${
                method !== "bazin" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              Fluxo de Caixa Descontado
            </button>
            <button
              onClick={() => setMethod("bazin")}
              className={`px-3 py-2 transition-colors font-medium whitespace-nowrap ${
                method === "bazin" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              Dividend Yield (Bazin)
            </button>
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
                  onBlur={e => setSharesOutstanding(fmtInt(e.target.value))}
                  className="h-7 text-right text-sm font-semibold bg-primary/5 border-primary/20"
                  inputMode="decimal" placeholder="Ex: 2.720.000.000" />
              </SpreadRow>
              <SpreadRow label="Market cap" value={formatMoney(marketCapAtual, assetCurrency)} bold />
            </SpreadCard>

            {method !== "bazin" ? (
              <SpreadCard title="Premissas — FCD">
                {/* ── Nível 2: variante dentro do FCD ── */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Variante</Label>
                  <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                    <button
                      onClick={() => setMethod("classic")}
                      className={`flex-1 px-2 py-1.5 transition-colors ${
                        method === "classic" ? "bg-primary text-primary-foreground font-semibold" : "bg-card text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Clássico
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
                    {method === "classic" && "Desconta a perpetuidade pela mesma taxa usada nos anos projetados."}
                    {method === "buffett" && "Taxa fixa no perpétuo (custo de oportunidade do mercado). O crescimento é aplicado como declínio — fluxo diminuindo no longuíssimo prazo, para evitar um valor terminal inflado."}
                  </p>
                </div>

                <SpreadRow label="Taxa de desconto (i)">
                  <PctInput value={discountRate} onChange={setDiscountRate} />
                </SpreadRow>
                <SpreadRow label={method === "buffett" ? "Declínio perpétuo (−g)" : "Cresc. perpétuo (g)"}>
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
            ) : (
              <SpreadCard title="Premissas — Bazin">
                <p className="text-[11px] text-muted-foreground leading-snug -mt-1 mb-1">
                  Preço-teto baseado em Dividend Yield desejado — método de Décio Bazin.
                  Preço-teto = DPA ÷ Yield desejado.
                </p>
                <SpreadRow label="Dividend Yield desejado">
                  <PctInput value={desiredYield} onChange={setDesiredYield} />
                </SpreadRow>
                <SpreadRow label="Payout da empresa">
                  <PctInput value={bazinPayout} onChange={setBazinPayout} />
                </SpreadRow>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Lucro projetado (total da empresa)</Label>
                  <Input
                    value={projectedProfit}
                    onChange={e => setProjectedProfit(e.target.value)}
                    onBlur={e => setProjectedProfit(fmtNum(e.target.value))}
                    className="h-7 text-right text-sm font-semibold bg-primary/5 border-primary/20"
                    inputMode="decimal"
                    placeholder="Ex: 180.353.000"
                  />
                </div>
                <SpreadRow label="Multiplicador de unit">
                  <Input
                    value={unitMultiplier}
                    onChange={e => setUnitMultiplier(e.target.value)}
                    className="h-7 w-16 text-right text-sm font-semibold bg-primary/5 border-primary/20"
                    inputMode="numeric"
                  />
                </SpreadRow>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Use 3, por exemplo, quando o ativo for uma "unit" composta por 3 ações.
                </p>
              </SpreadCard>
            )}

            <SpreadCard title="Realidade Projetada" tone={isUpside ? "success" : "destructive"}>
              {method === "bazin" && (
                <SpreadRow label="DPA (projetivo)"
                  value={result && "dpa" in result ? formatMoney((result as any).dpa, assetCurrency) : "—"} bold />
              )}
              <SpreadRow label="Preço-teto"
                value={result ? formatMoney(result.fairPrice, assetCurrency) : "—"} bold big />
              <SpreadRow label="Market cap justo"
                value={result ? formatMoney(result.fairMarketCap, assetCurrency) : "—"} />
              {method === "bazin" && result && "projectedYield" in result && (
                <SpreadRow label="Yield (projetivo)"
                  value={pct((result as any).projectedYield)} />
              )}
              <SpreadRow label={method === "bazin" ? "Margem de segurança" : "Upside/Downside"}>
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

          {/* ── Coluna direita: tabela ano a ano (FCD/Buffett) ou resumo (Bazin) ── */}
          {method === "bazin" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resumo do Cálculo — Método Bazin</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Lucro projetado</p>
                    <p className="text-sm font-semibold mt-1">{formatMoney(dProjectedProfit, assetCurrency)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Payout</p>
                    <p className="text-sm font-semibold mt-1">{pct(dBazinPayout)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Nº de ações</p>
                    <p className="text-sm font-semibold mt-1">{shares.toLocaleString("pt-BR")}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Multiplicador unit</p>
                    <p className="text-sm font-semibold mt-1">{dUnitMultiplier}x</p>
                  </div>
                  <div className="rounded-lg bg-primary/10 border border-primary/20 p-3">
                    <p className="text-xs text-muted-foreground">DPA (projetivo)</p>
                    <p className="text-sm font-bold text-primary mt-1">
                      {result && "dpa" in result ? formatMoney((result as any).dpa, assetCurrency) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Dividend Yield desejado</p>
                    <p className="text-sm font-semibold mt-1">{pct(dDesiredYield)}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-border space-y-2 text-xs text-muted-foreground">
                  <p><strong className="text-foreground">DPA</strong> = (Lucro projetado × Payout ÷ Nº de ações) × Multiplicador de unit</p>
                  <p><strong className="text-foreground">Preço-teto</strong> = DPA ÷ Dividend Yield desejado</p>
                  <p><strong className="text-foreground">Yield projetivo</strong> = DPA ÷ Cotação atual</p>
                  <p><strong className="text-foreground">Margem de segurança</strong> = (Preço-teto ÷ Cotação atual) − 1</p>
                </div>
              </CardContent>
            </Card>
          ) : (
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
                          g = {pct(method === "buffett" ? -Math.abs(pGrowth) : pGrowth)} · i = {pct(effectivePerpDiscountRate ?? dRate)}
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
          )}
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

function methodBadge(method: string) {
  const label = method === "bazin" ? "Bazin" : method === "buffett" ? "Buffett" : "FCD Clássico";
  const color = method === "bazin" ? "bg-purple-500/10 text-purple-500"
    : method === "buffett" ? "bg-amber-500/10 text-amber-600"
    : "bg-primary/10 text-primary";
  return { label, color };
}

// Painel de premissas usadas naquele valuation específico — usado pelo botão
// "Visualizar", que NÃO altera o formulário (diferente de "Editar").
function ValuationPremissesDetail({ v }: { v: any }) {
  const isBazin = v.method === "bazin";
  return (
    <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs space-y-2">
      {isBazin ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <p className="text-muted-foreground">Dividend Yield desejado</p>
            <p className="font-medium">{pct(v.desiredYield)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Payout</p>
            <p className="font-medium">{pct(v.payout)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Lucro projetado</p>
            <p className="font-medium">{formatMoney(v.projectedProfit, v.currency)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Multiplicador de unit</p>
            <p className="font-medium">{v.unitMultiplier}x</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <p className="text-muted-foreground">Taxa de desconto</p>
              <p className="font-medium">{pct(v.discountRate)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Cresc. perpétuo</p>
              <p className="font-medium">{pct(v.perpetuityGrowth)}</p>
            </div>
            {v.method === "buffett" && v.perpetuityDiscountRate != null && (
              <div>
                <p className="text-muted-foreground">Taxa desc. perpétuo</p>
                <p className="font-medium">{pct(v.perpetuityDiscountRate)}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground">{v.cashFlowLabel} (ano base)</p>
              <p className="font-medium">{formatMoney(v.baseCashFlow, v.currency)}</p>
            </div>
          </div>
          {v.yearlyGrowthRates?.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1">Crescimento projetado por ano</p>
              <div className="flex flex-wrap gap-1.5">
                {v.yearlyGrowthRates.map((g: number, i: number) => (
                  <span key={i} className="px-2 py-0.5 rounded-md bg-background border border-border">
                    Ano {i + 1}: {pct(g)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <div className="flex justify-between pt-2 border-t border-border/60">
        <span className="text-muted-foreground">Nº de ações</span>
        <span className="font-medium">{Number(v.sharesOutstanding).toLocaleString("pt-BR")}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Preço na data do cálculo</span>
        <span className="font-medium">{formatMoney(v.priceAtCalc, v.currency)}</span>
      </div>
      {v.notes && (
        <div className="pt-2 border-t border-border/60">
          <p className="text-muted-foreground mb-0.5">Notas</p>
          <p className="text-foreground">{v.notes}</p>
        </div>
      )}
    </div>
  );
}

function ValuationHistoryRow({ v, onEdit, onDelete }: { v: any; onEdit: (v: any) => void; onDelete: (id: string) => void }) {
  const [viewing, setViewing] = useState(false);
  const isUpside = v.upsidePct >= 0;
  const { label, color } = methodBadge(v.method);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <AssetLogo symbol={v.symbol} assetClass={v.assetClass ?? "other"} size={24} />
          <span className="font-mono font-semibold text-sm">{v.symbol}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${color}`}>
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(v.createdAt).toLocaleDateString("pt-BR")} · Preço-teto:{" "}
            <span className="font-semibold text-foreground">{formatMoney(v.fairPrice, v.currency)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className={`text-sm font-semibold ${isUpside ? "text-success" : "text-destructive"}`}>
            {isUpside ? "+" : ""}{pct(v.upsidePct)}
          </span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setViewing(x => !x)}>
            <Eye className="h-3 w-3" /> Visualizar
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => onEdit(v)}>
            <Pencil className="h-3 w-3" /> Editar
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(v.id)}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
      {viewing && (
        <div className="px-4 pb-3">
          <ValuationPremissesDetail v={v} />
        </div>
      )}
    </div>
  );
}

function ValuationHistoryRowCompact({ v, onEdit, onDelete }: { v: any; onEdit: (v: any) => void; onDelete: (id: string) => void }) {
  const [viewing, setViewing] = useState(false);
  const isUpside = v.upsidePct >= 0;
  const { label, color } = methodBadge(v.method);
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${color}`}>
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(v.createdAt).toLocaleDateString("pt-BR")} · Preço-teto:{" "}
            <span className="font-semibold text-foreground">{formatMoney(v.fairPrice, v.currency)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className={`text-xs font-semibold ${isUpside ? "text-success" : "text-destructive"}`}>
            {isUpside ? "+" : ""}{pct(v.upsidePct)}
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setViewing(x => !x)}>
            <Eye className="h-3 w-3" /> Visualizar
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => onEdit(v)}>
            <Pencil className="h-3 w-3" /> Editar
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(v.id)}>
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      </div>
      {viewing && (
        <div className="mt-2">
          <ValuationPremissesDetail v={v} />
        </div>
      )}
    </div>
  );
}

function ValuationHistory({ valuations, onDeleted, onEdit }: { valuations: any[]; onDeleted: () => void; onEdit: (v: any) => void }) {
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  // Agrupa por ativo (assetId), preservando a ordem geral (mais recente primeiro)
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const v of valuations) {
      if (!map.has(v.assetId)) map.set(v.assetId, []);
      map.get(v.assetId)!.push(v);
    }
    return Array.from(map.values());
  }, [valuations]);

  const toggleExpanded = (assetId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(assetId) ? next.delete(assetId) : next.add(assetId);
      return next;
    });
  };

  return (
    <>
      <div className="space-y-2">
        {groups.map((group) => {
          if (group.length === 1) {
            return <ValuationHistoryRow key={group[0].id} v={group[0]} onEdit={onEdit} onDelete={setToDelete} />;
          }

          const assetId = group[0].assetId;
          const isOpen = expanded.has(assetId);
          const latest = group[0];
          const isUpside = latest.upsidePct >= 0;

          return (
            <div key={assetId} className="rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => toggleExpanded(assetId)}
                className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <AssetLogo symbol={latest.symbol} assetClass={latest.assetClass ?? "other"} size={24} />
                  <span className="font-mono font-semibold text-sm">{latest.symbol}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 bg-muted text-muted-foreground">
                    {group.length} valuations
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Mais recente: {new Date(latest.createdAt).toLocaleDateString("pt-BR")} ·{" "}
                    <span className="font-semibold text-foreground">{formatMoney(latest.fairPrice, latest.currency)}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-semibold ${isUpside ? "text-success" : "text-destructive"}`}>
                    {isUpside ? "+" : ""}{pct(latest.upsidePct)}
                  </span>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border divide-y divide-border/50 bg-muted/10">
                  {group.map((v) => (
                    <div key={v.id} className="px-4 py-2">
                      <ValuationHistoryRowCompact v={v} onEdit={onEdit} onDelete={setToDelete} />
                    </div>
                  ))}
                </div>
              )}
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
