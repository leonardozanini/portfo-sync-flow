import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listCryptoLiquidity, adminRunCryptoLiquidityCheck } from "@/lib/portfolio.functions";
import { AssetLogo } from "@/components/AssetLogo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Droplets, RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Info,
  ArrowUp, ArrowDown, ArrowUpDown, Search, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/liquidez")({
  head: () => ({ meta: [{ title: "Liquidez — Folio" }] }),
  component: LiquidezPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  healthy: { label: "Saudável", color: "text-success", bg: "bg-success/10 border-success/20", icon: CheckCircle2 },
  warning: { label: "Atenção", color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", icon: AlertTriangle },
  low: { label: "Baixa liquidez", color: "text-destructive", bg: "bg-destructive/10 border-destructive/20", icon: XCircle },
  high: { label: "Acima do normal", color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", icon: AlertTriangle },
  unknown: { label: "Sem dados", color: "text-muted-foreground", bg: "bg-muted border-border", icon: HelpCircle },
};

function StatusBadge({ status }: { status: string | null }) {
  const cfg = STATUS_CONFIG[status ?? "unknown"] ?? STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Ordenação clicável de colunas — reutilizável em outras tabelas do Folio ──
type SortDir = "asc" | "desc" | null;

function SortableHeader({
  label, sortKey, activeSort, onSort, align = "right",
}: {
  label: string;
  sortKey: string;
  activeSort: { key: string; dir: SortDir };
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
}) {
  const isActive = activeSort.key === sortKey;
  const dir = isActive ? activeSort.dir : null;
  const alignClass = align === "left" ? "text-left justify-start" : align === "center" ? "text-center justify-center" : "text-right justify-end";

  return (
    <th className={`px-4 py-2.5 font-medium ${align === "left" ? "text-left" : align === "center" ? "text-center" : "text-right"}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${alignClass} ${isActive ? "text-foreground" : ""}`}
      >
        {label}
        {dir === "asc" && <ArrowUp className="h-3 w-3" />}
        {dir === "desc" && <ArrowDown className="h-3 w-3" />}
        {!isActive && <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </button>
    </th>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

function LiquidezPage() {
  const { isAdmin } = useAuth();
  const [running, setRunning] = useState(false);
  const runCheckFn = useServerFn(adminRunCryptoLiquidityCheck);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["crypto-liquidity"],
    queryFn: () => listCryptoLiquidity(),
    staleTime: 60_000,
  });

  const handleRunCheck = async () => {
    setRunning(true);
    try {
      const result = await runCheckFn();
      if (result.ok) {
        const s = result.summary;
        toast.success(`Checagem concluída — ${s?.healthy ?? 0} saudáveis, ${s?.warning ?? 0} atenção, ${s?.low ?? 0} baixa liquidez`);
        refetch();
      } else {
        toast.error(result.error ?? "Erro na checagem");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao executar checagem");
    } finally {
      setRunning(false);
    }
  };

  // Busca por nome/símbolo
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Ordenação clicável de colunas
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "", dir: null });

  const handleSort = (key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: "desc" }; // 1º clique: maior pro menor
      if (prev.dir === "desc") return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: null };  // 3º clique: remove ordenação
      return { key, dir: "desc" };
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort.dir) return filteredRows;
    const getVal = (r: typeof filteredRows[number]): number => {
      switch (sort.key) {
        case "marketCap": return r.marketCap ?? -Infinity;
        case "volume24h": return r.volume24h ?? -Infinity;
        case "volume7d": return r.volume7d ?? -Infinity;
        case "ratio24h": return r.ratio24h ?? -Infinity;
        case "ratio7d": return r.ratio7d ?? -Infinity;
        default: return 0;
      }
    };
    const sorted = [...filteredRows].sort((a, b) => getVal(a) - getVal(b));
    return sort.dir === "asc" ? sorted : sorted.reverse();
  }, [filteredRows, sort]);

  const withData = rows.filter(r => r.overallStatus && r.overallStatus !== "unknown");
  const healthyCount = withData.filter(r => r.overallStatus === "healthy").length;
  const warningCount = withData.filter(r => r.overallStatus === "warning" || r.overallStatus === "high").length;
  const lowCount = withData.filter(r => r.overallStatus === "low").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Droplets className="h-6 w-6 text-primary" /> Liquidez de Criptoativos
          </h1>
          <p className="text-sm text-muted-foreground">
            Checagem diária via CoinMarketCap — volume de negociação vs. market cap.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleRunCheck} disabled={running} variant="outline" size="sm">
            {running
              ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Verificando…</>
              : <><RefreshCw className="mr-2 h-3.5 w-3.5" /> Verificar agora</>
            }
          </Button>
        )}
      </div>

      {/* Explicação da regra */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <p><strong>Regra de bolso para liquidez:</strong></p>
              <p className="text-muted-foreground">
                <span className="text-foreground font-medium">24h:</span> Volume 24h ÷ Market Cap entre <strong>2% e 4%</strong> ·{" "}
                <span className="text-foreground font-medium">7 dias:</span> Volume 7d ÷ Market Cap entre <strong>10% e 20%</strong>
              </p>
              <p className="text-xs text-muted-foreground/80">
                Liquidez saudável significa maior capacidade de sair da posição sem impactar muito o preço.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      {withData.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-success/20">
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold text-success">{healthyCount}</p>
              <p className="text-xs text-muted-foreground">Saudáveis</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-500/20">
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold text-yellow-500">{warningCount}</p>
              <p className="text-xs text-muted-foreground">Atenção</p>
            </CardContent>
          </Card>
          <Card className="border-destructive/20">
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold text-destructive">{lowCount}</p>
              <p className="text-xs text-muted-foreground">Baixa liquidez</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
          <CardTitle className="text-base">
            Todos os criptoativos ({filteredRows.length}{search ? ` de ${rows.length}` : ""})
          </CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou símbolo…"
              className="h-8 pl-8 pr-8 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhum criptoativo no catálogo.</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhum ativo encontrado para "{search}".</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-medium">Ativo</th>
                    <SortableHeader label="Market Cap" sortKey="marketCap" activeSort={sort} onSort={handleSort} />
                    <SortableHeader label="Volume 24h" sortKey="volume24h" activeSort={sort} onSort={handleSort} />
                    <SortableHeader label="Volume 7d" sortKey="volume7d" activeSort={sort} onSort={handleSort} />
                    <SortableHeader label="Ratio 24h" sortKey="ratio24h" activeSort={sort} onSort={handleSort} />
                    <th className="text-center px-4 py-2.5 font-medium">Status 24h</th>
                    <SortableHeader label="Ratio 7d" sortKey="ratio7d" activeSort={sort} onSort={handleSort} />
                    <th className="text-center px-4 py-2.5 font-medium">Status 7d</th>
                    <th className="text-center px-4 py-2.5 font-medium">Geral</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.assetId} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <AssetLogo symbol={r.symbol} assetClass="crypto" size={24} />
                          <div>
                            <p className="font-mono font-semibold text-sm">{r.symbol}</p>
                            <p className="text-xs text-muted-foreground">{r.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtUSD(r.marketCap)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtUSD(r.volume24h)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtUSD(r.volume7d)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtPct(r.ratio24h)}</td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={r.status24h} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtPct(r.ratio7d)}</td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={r.status7d} /></td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={r.overallStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
