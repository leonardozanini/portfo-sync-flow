import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Database, Plus, Check, X,
  MoreHorizontal, Link as LinkIcon, Loader2, Activity, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import {
  listCatalog, adminCreateAsset, adminUpdateAsset, adminApproveAsset, adminRejectAsset,
  adminTestPriceSource,
  type AssetClass, type CurrencyCode, type CatalogRow, type MarketCode, type PriceSourceTest,
} from "@/lib/portfolio.functions";

export const Route = createFileRoute("/_authenticated/_admin/catalog")({
  head: () => ({ meta: [{ title: "Catálogo de ativos — Folio" }] }),
  component: CatalogPage,
});

const CLASS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todas as classes" },
  { value: "stock", label: "Ações" },
  { value: "reit", label: "FIIs" },
  { value: "etf", label: "ETFs" },
  { value: "stock_intl", label: "Stocks" },
  { value: "reit_intl", label: "REITs" },
  { value: "etf_intl", label: "ETFs Internacionais" },
  { value: "crypto", label: "Criptomoedas" },
  { value: "fixed_income", label: "Renda Fixa" },
  { value: "fund", label: "Fundos" },
  { value: "cash", label: "Caixa" },
  { value: "other", label: "Outros" },
];

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "stock", label: "Ações" }, { value: "reit", label: "FIIs" },
  { value: "etf", label: "ETFs" },
  { value: "stock_intl", label: "Stocks" }, { value: "reit_intl", label: "REITs" },
  { value: "etf_intl", label: "ETFs Internacionais" },
  { value: "crypto", label: "Criptomoedas" },
  { value: "fixed_income", label: "Renda Fixa" }, { value: "fund", label: "Fundos" },
  { value: "cash", label: "Caixa" }, { value: "other", label: "Outros" },
];

const CURRENCIES: CurrencyCode[] = ["BRL", "USD", "EUR", "GBP", "JPY"];

const MARKETS: { value: MarketCode; label: string }[] = [
  { value: "B3", label: "B3 (Brasil)" },
  { value: "NYSE", label: "NYSE" },
  { value: "NASDAQ", label: "NASDAQ" },
  { value: "LSE", label: "LSE (Londres)" },
  { value: "TSE", label: "TSE (Tóquio)" },
  { value: "CRYPTO", label: "Cripto (24/7)" },
  { value: "OTHER", label: "Outro" },
];

const CLASS_LABEL: Record<AssetClass, string> = {
  stock: "Ação", reit: "FII", etf: "ETF",
  stock_intl: "Stock", reit_intl: "REIT", etf_intl: "ETF Intl",
  crypto: "Cripto",
  fixed_income: "Renda Fixa", fund: "Fundo", cash: "Caixa", other: "Outro",
};

const STALE_THRESHOLD_HOURS = 48;

function isStale(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true;
  return Date.now() - new Date(fetchedAt).getTime() > STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
}

function CatalogPage() {
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "pending" | "approved">("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const qc = useQueryClient();
  const fn = useServerFn(listCatalog);
  const { data, isLoading } = useQuery({
    queryKey: ["catalog", q, assetClass, status, page],
    queryFn: () => fn({ data: { q, assetClass, status, page, pageSize } }),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const refresh = () => qc.invalidateQueries({ queryKey: ["catalog"] });

  const staleCount = (data?.rows ?? []).filter((r) => r.status === "approved" && isStale(r.fetchedAt)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Database className="h-5 w-5" />Catálogo de ativos
            </h1>
            <p className="text-sm text-muted-foreground">
              {total} ativos
              {data?.pendingCount ? <Badge variant="destructive" className="ml-2">{data.pendingCount} pendente(s)</Badge> : null}
              {staleCount > 0 ? <Badge variant="outline" className="ml-2 border-warning/40 text-warning">
                <AlertTriangle className="h-3 w-3 mr-1" />{staleCount} sem atualização &gt;{STALE_THRESHOLD_HOURS}h
              </Badge> : null}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <TestConnectionButton />
          <NewAssetButton onCreated={refresh} />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Buscar</CardTitle></CardHeader>
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
          <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
            <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="approved">Aprovados</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Símbolo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>Mercado</TableHead>
                <TableHead>Moeda</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Último preço</TableHead>
                <TableHead>Atualizado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && (data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum ativo encontrado.</TableCell></TableRow>
              )}
              {(data?.rows ?? []).map((a) => (
                <CatalogRowItem key={a.id} a={a} onChanged={refresh} />
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

function CatalogRowItem({ a, onChanged }: { a: CatalogRow; onChanged: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const approveFn = useServerFn(adminApproveAsset);
  const rejectFn = useServerFn(adminRejectAsset);

  const approve = useMutation({
    mutationFn: approveFn,
    onSuccess: () => { toast.success("Ativo aprovado"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: rejectFn,
    onSuccess: () => { toast.success("Ativo removido"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stale = a.status === "approved" && isStale(a.fetchedAt);

  return (
    <TableRow className={a.status === "pending" ? "bg-warning/5" : ""}>
      <TableCell className="font-mono font-semibold">{a.symbol}</TableCell>
      <TableCell className="text-muted-foreground">{a.name ?? "—"}</TableCell>
      <TableCell><Badge variant="secondary">{CLASS_LABEL[a.assetClass]}</Badge></TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Badge variant="outline">{a.market}</Badge>
          {a.marketOpen
            ? <span className="h-2 w-2 rounded-full bg-success" title="Mercado aberto" />
            : <span className="h-2 w-2 rounded-full bg-muted-foreground/40" title="Mercado fechado" />}
        </div>
      </TableCell>
      <TableCell><Badge variant="outline">{a.currency}</Badge></TableCell>
      <TableCell>
        {a.status === "pending"
          ? <Badge variant="destructive">Pendente</Badge>
          : <Badge variant="default" className="bg-success/15 text-success border-success/30">Aprovado</Badge>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {a.lastPrice != null
          ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: a.currency }).format(a.lastPrice)
          : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-xs">
        {a.fetchedAt
          ? <span className={stale ? "text-warning" : "text-muted-foreground"}>
              {stale && <AlertTriangle className="h-3 w-3 inline mr-1" />}
              {new Date(a.fetchedAt).toLocaleString("pt-BR")}
            </span>
          : <span className="text-destructive">Nunca</span>}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {a.status === "pending" && (
              <DropdownMenuItem onClick={() => approve.mutate({ data: { id: a.id } })}>
                <Check className="h-4 w-4 mr-2 text-success" /> Aprovar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <LinkIcon className="h-4 w-4 mr-2" /> Editar
            </DropdownMenuItem>
            {a.status === "pending" && (
              <DropdownMenuItem className="text-destructive" onClick={() => reject.mutate({ data: { id: a.id } })}>
                <X className="h-4 w-4 mr-2" /> Rejeitar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <EditAssetDialog asset={a} open={editOpen} onOpenChange={setEditOpen} onSaved={onChanged} />
      </TableCell>
    </TableRow>
  );
}

function TestConnectionButton() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PriceSourceTest | null>(null);
  const testFn = useServerFn(adminTestPriceSource);

  const mutation = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => {
      setResult(r); setOpen(true);
      if (r.ok) toast.success("Conexão OK");
      else toast.error("Falha na conexão");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="outline" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Testando…</>
          : <><Activity className="h-4 w-4 mr-2" />Testar Conexão</>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {result?.ok
                ? <><CheckCircle2 className="h-5 w-5 text-success" />Conexão OK</>
                : <><X className="h-5 w-5 text-destructive" />Falha na Conexão</>}
            </DialogTitle>
            <DialogDescription>
              {result?.ok
                ? "A conexão com a fonte de preços está funcionando corretamente."
                : "Não foi possível acessar a fonte de preços. Verifique a integração ou atualize as configurações."}
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3 text-sm">
              <SourceStatus title="Yahoo Finance (PETR4.SA)" s={result.yahoo} />
              <SourceStatus title={`URL scraping${result.url.sampleHost ? ` — ${result.url.sampleHost}` : ""}`} s={result.url} />
              <div className="rounded-md border p-3 bg-muted/30 space-y-1">
                <div className="font-medium">Saúde do catálogo</div>
                <div className="text-muted-foreground">
                  {result.totalApproved} ativos aprovados ·{" "}
                  <span className={result.staleAssets > 0 ? "text-warning" : ""}>
                    {result.staleAssets} sem atualização &gt;{STALE_THRESHOLD_HOURS}h
                  </span>{" "}
                  · <span className={result.neverFetched > 0 ? "text-destructive" : ""}>
                    {result.neverFetched} nunca atualizados
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SourceStatus({ title, s }: {
  title: string;
  s: { ok: boolean; latencyMs: number; price: number | null; error?: string };
}) {
  return (
    <div className="rounded-md border p-3 flex items-start gap-3">
      {s.ok
        ? <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
        : <X className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">
          {s.ok ? "OK" : "Falha"} · {s.latencyMs}ms
          {s.price != null && <> · preço retornado: <span className="font-mono">{s.price.toFixed(2)}</span></>}
        </div>
        {s.error && <div className="text-xs text-destructive mt-1">{s.error}</div>}
      </div>
    </div>
  );
}

function NewAssetButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [klass, setKlass] = useState<AssetClass>("stock");
  const [currency, setCurrency] = useState<CurrencyCode>("BRL");
  const [market, setMarket] = useState<MarketCode>("B3");
  const [dataSource, setDataSource] = useState("yahoo");
  const [quoteUrl, setQuoteUrl] = useState("");

  const createFn = useServerFn(adminCreateAsset);
  const mutation = useMutation({
    mutationFn: createFn,
    onSuccess: () => {
      toast.success("Ativo adicionado ao catálogo");
      setOpen(false); onCreated();
      setSymbol(""); setName(""); setQuoteUrl("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" /> Adicionar ativo</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo ativo no catálogo</DialogTitle>
          <DialogDescription>Cria como aprovado, disponível imediatamente para lançamentos.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Código</Label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="PETR4" />
          </div>
          <div className="space-y-1.5">
            <Label>Moeda</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Petrobras PN" />
          </div>
          <div className="space-y-1.5">
            <Label>Classe</Label>
            <Select value={klass} onValueChange={(v) => setKlass(v as AssetClass)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSET_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Mercado</Label>
            <Select value={market} onValueChange={(v) => setMarket(v as MarketCode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MARKETS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Fonte de cotação</Label>
            <Select value={dataSource} onValueChange={setDataSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yahoo">Yahoo Finance</SelectItem>
                <SelectItem value="url">URL manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>URL de cotação (opcional)</Label>
            <Input value={quoteUrl} onChange={(e) => setQuoteUrl(e.target.value)}
              placeholder="https://finance.yahoo.com/quote/PETR4.SA" />
            <p className="text-xs text-muted-foreground">Usada como fallback quando a fonte padrão falha ou nunca obteve cotação.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            onClick={() => {
              if (!symbol.trim() || !name.trim()) { toast.error("Código e nome são obrigatórios"); return; }
              mutation.mutate({ data: { symbol, name, assetClass: klass, currency, market, dataSource, quoteUrl } });
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando…</> : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAssetDialog({
  asset, open, onOpenChange, onSaved,
}: { asset: CatalogRow; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState(asset.name ?? "");
  const [quoteUrl, setQuoteUrl] = useState(asset.quoteUrl ?? "");
  const [dataSource, setDataSource] = useState(asset.dataSource ?? "yahoo");
  const [market, setMarket] = useState<MarketCode>(asset.market);

  const updateFn = useServerFn(adminUpdateAsset);
  const mutation = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { toast.success("Ativo atualizado"); onOpenChange(false); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar — {asset.symbol}</DialogTitle>
          <DialogDescription>
            Atualize o nome, mercado e a URL de cotação (usada quando "Atualizado" = Nunca).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Mercado</Label>
            <Select value={market} onValueChange={(v) => setMarket(v as MarketCode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MARKETS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Fonte de cotação</Label>
            <Select value={dataSource} onValueChange={setDataSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yahoo">Yahoo Finance</SelectItem>
                <SelectItem value="url">URL manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>URL de cotação</Label>
            <Input value={quoteUrl} onChange={(e) => setQuoteUrl(e.target.value)}
              placeholder="https://finance.yahoo.com/quote/..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate({ data: { id: asset.id, name, market, quoteUrl, dataSource } })}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando…</> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
