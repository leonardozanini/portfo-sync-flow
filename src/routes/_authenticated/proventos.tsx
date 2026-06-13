import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Inbox, TrendingUp, Calendar, Coins } from "lucide-react";
import { listDividends, type CurrencyCode } from "@/lib/portfolio.functions";
import { convert, formatMoney, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";

export const Route = createFileRoute("/_authenticated/proventos")({
  head: () => ({ meta: [{ title: "Proventos — Folio" }] }),
  component: ProventosPage,
});

const CLASS_LABEL: Record<string, string> = {
  stock: "Ações", reit: "FIIs", etf: "ETFs", stock_intl: "Stocks",
  reit_intl: "REITs", crypto: "Cripto", fixed_income: "Renda Fixa",
  fund: "Fundos", cash: "Caixa", other: "Outros",
};

function ProventosPage() {
  const { currency } = useDisplayCurrency();
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterSymbol, setFilterSymbol] = useState<string>("all");

  const listFn = useServerFn(listDividends);
  const { data: divs = [], isLoading } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
  });

  const years = useMemo(() => {
    const ys = new Set(divs.map(d => new Date(d.exDate).getFullYear().toString()));
    return Array.from(ys).sort((a, b) => b.localeCompare(a));
  }, [divs]);

  const symbols = useMemo(() =>
    Array.from(new Set(divs.map(d => d.symbol))).sort()
  , [divs]);

  const visible = useMemo(() => {
    let rows = divs;
    if (filterYear !== "all") rows = rows.filter(d => new Date(d.exDate).getFullYear().toString() === filterYear);
    if (filterSymbol !== "all") rows = rows.filter(d => d.symbol === filterSymbol);
    return rows;
  }, [divs, filterYear, filterSymbol]);

  // KPIs
  const currentYear = new Date().getFullYear().toString();
  const thisYear = divs.filter(d => new Date(d.exDate).getFullYear().toString() === currentYear);
  const totalThisYear = thisYear.reduce((s, d) => s + convert(d.amount, currency as Currency), 0);
  const avgMonthly = totalThisYear / 12;
  const last = divs[0];

  // Group by month
  const grouped = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const d of visible) {
      const date = new Date(d.exDate);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [visible]);

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-");
    const date = new Date(parseInt(y), parseInt(m) - 1, 1);
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proventos</h1>
          <p className="text-sm text-muted-foreground">Histórico de dividendos e rendimentos recebidos</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Todos os anos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os anos</SelectItem>
              {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSymbol} onValueChange={setFilterSymbol}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Todos os ativos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os ativos</SelectItem>
              {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-success/10">
                <Coins className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total {currentYear}</p>
                <p className="text-xl font-bold">{formatMoney(totalThisYear, currency as Currency)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Média mensal {currentYear}</p>
                <p className="text-xl font-bold">{formatMoney(avgMonthly, currency as Currency)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-warning/10">
                <Calendar className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Último recebido</p>
                {last ? (
                  <>
                    <p className="text-lg font-bold">{last.symbol}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatMoney(last.amount, last.currency as Currency)} · {new Date(last.exDate).toLocaleDateString("pt-BR")}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum ainda</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading && (
        <Card><CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />Sincronizando proventos…
        </CardContent></Card>
      )}

      {!isLoading && visible.length === 0 && (
        <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 opacity-60" />
          <p className="font-medium">Nenhum provento encontrado</p>
          <p className="text-sm">Os proventos são sincronizados automaticamente ao abrir o dashboard.</p>
        </CardContent></Card>
      )}

      {grouped.map(([key, rows]) => {
        const monthTotal = rows.reduce((s, d) => s + convert(d.amount, currency as Currency), 0);
        return (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base capitalize">{monthLabel(key)}</CardTitle>
              <span className="text-sm font-semibold text-success">{formatMoney(monthTotal, currency as Currency)}</span>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ativo</TableHead>
                    <TableHead>Classe</TableHead>
                    <TableHead>Data ex</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead className="text-right">Valor unit.</TableHead>
                    <TableHead className="text-right">Fonte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono font-semibold">{d.symbol}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {CLASS_LABEL[d.assetClass] ?? d.assetClass}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {new Date(d.exDate).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {d.paymentDate ? new Date(d.paymentDate).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-success">
                        {formatMoney(d.amount, d.currency as Currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">{d.source}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
