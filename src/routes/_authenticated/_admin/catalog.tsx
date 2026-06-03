import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronLeft, ChevronRight, Database } from "lucide-react";
import { listCatalog, type AssetClass } from "@/lib/portfolio.functions";

export const Route = createFileRoute("/_authenticated/_admin/catalog")({
  head: () => ({ meta: [{ title: "Catálogo de ativos — Folio" }] }),
  component: CatalogPage,
});

const CLASS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todas as classes" },
  { value: "stock", label: "Ações" },
  { value: "reit", label: "FIIs" },
  { value: "etf", label: "ETFs" },
  { value: "crypto", label: "Criptomoedas" },
  { value: "fixed_income", label: "Renda Fixa" },
  { value: "fund", label: "Fundos" },
  { value: "cash", label: "Caixa" },
  { value: "other", label: "Outros" },
];

const CLASS_LABEL: Record<AssetClass, string> = {
  stock: "Ação", reit: "FII", etf: "ETF", crypto: "Cripto",
  fixed_income: "Renda Fixa", fund: "Fundo", cash: "Caixa", other: "Outro",
};

function CatalogPage() {
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fn = useServerFn(listCatalog);
  const { data, isLoading } = useQuery({
    queryKey: ["catalog", q, assetClass, page],
    queryFn: () => fn({ data: { q, assetClass, page, pageSize } }),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-5 w-5" />Catálogo de ativos
          </h1>
          <p className="text-sm text-muted-foreground">
            {total} ativos cadastrados — disparam refresh automático a cada 15 min via cron.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Símbolo ou nome (ex.: PETR4, Apple)"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="flex-1"
          />
          <Select value={assetClass} onValueChange={(v) => { setAssetClass(v); setPage(1); }}>
            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CLASS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Símbolo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>Moeda</TableHead>
                <TableHead className="text-right">Último preço</TableHead>
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && (data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum ativo encontrado.</TableCell></TableRow>
              )}
              {(data?.rows ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono font-semibold">{a.symbol}</TableCell>
                  <TableCell className="text-muted-foreground">{a.name ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{CLASS_LABEL[a.assetClass]}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{a.currency}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.lastPrice != null
                      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: a.currency }).format(a.lastPrice)
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.fetchedAt ? new Date(a.fetchedAt).toLocaleString("pt-BR") : "Nunca"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Página {data?.page ?? 1} de {totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
