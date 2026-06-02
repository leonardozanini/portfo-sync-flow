import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { getAssetLots } from "@/lib/portfolio.functions";
import { formatMoney, type Currency } from "@/lib/currency";

export function AssetLotsDialog({
  open, onOpenChange, assetId, symbol,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assetId: string | null;
  symbol?: string;
}) {
  const fetchLots = useServerFn(getAssetLots);
  const { data, isLoading, error } = useQuery({
    queryKey: ["asset-lots", assetId],
    queryFn: () => fetchLots({ data: { assetId: assetId! } }),
    enabled: open && !!assetId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Lançamentos detalhados {data?.asset.symbol ?? symbol ? `— ${data?.asset.symbol ?? symbol}` : ""}
          </DialogTitle>
          {data?.asset.name && (
            <DialogDescription>{data.asset.name}</DialogDescription>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="grid place-items-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">Erro ao carregar: {(error as Error).message}</div>
        ) : data ? (
          <Lots data={data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Lots({ data }: { data: NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof getAssetLots>>>>["data"]> }) {
  const cur = data.asset.currency as Currency;
  const t = data.totals;

  return (
    <div className="space-y-4">
      {/* Totais */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 md:grid-cols-5">
        <Stat label="Quantidade" value={t.qty.toLocaleString("pt-BR", { maximumFractionDigits: 8 })} />
        <Stat label="Investido" value={formatMoney(t.invested, cur)} />
        <Stat label="Valor atual" value={formatMoney(t.currentValue, cur)} />
        <Stat label="Lucro/Prejuízo" value={formatMoney(t.pnl, cur)}
          tone={t.pnl >= 0 ? "success" : "destructive"} />
        <Stat label="Rentabilidade" value={`${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%`}
          tone={t.pnlPct >= 0 ? "success" : "destructive"} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Quant.</TableHead>
              <TableHead className="text-right">Preço unit.</TableHead>
              <TableHead className="text-right">Custo total</TableHead>
              <TableHead className="text-right">Valor atual</TableHead>
              <TableHead className="text-right">L/P</TableHead>
              <TableHead className="text-right">Rentab.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lots.map((lot) => {
              const isBuy = lot.txType === "buy";
              const pnlTone = lot.pnl >= 0 ? "text-success" : "text-destructive";
              return (
                <TableRow key={lot.id}>
                  <TableCell className="tabular-nums">{lot.occurredAt}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      isBuy ? "border-success/40 text-success"
                      : lot.txType === "sell" ? "border-destructive/40 text-destructive"
                      : "border-border"
                    }>
                      {isBuy ? "Compra" : lot.txType === "sell" ? "Venda"
                        : lot.txType === "dividend" ? "Provento" : lot.txType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {lot.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(lot.unitPrice, lot.currency as Currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(lot.costBasis, lot.currency as Currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {isBuy ? formatMoney(lot.currentValue, lot.currency as Currency) : "—"}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${isBuy ? pnlTone : "text-muted-foreground"}`}>
                    {isBuy ? (
                      <span className="inline-flex items-center gap-1 justify-end">
                        {lot.pnl >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {formatMoney(lot.pnl, lot.currency as Currency)}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${isBuy ? pnlTone : "text-muted-foreground"}`}>
                    {isBuy ? `${lot.pnlPct >= 0 ? "+" : ""}${lot.pnlPct.toFixed(2)}%` : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Cotação atual: <span className="font-medium text-foreground">
          {formatMoney(data.asset.currentPrice, cur)}
        </span> · L/P calculado por lote de compra vs. cotação atual.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
