import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw, ShieldCheck, Wallet, Waves } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/defi")({ component: DefiPage });

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isRabby?: boolean;
};

type Eip6963ProviderDetail = {
  info: { rdns: string; name: string };
  provider: Eip1193Provider;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
}

type TrackedWallet = {
  id: string;
  address: string;
  tracking_started_at: string;
  last_synced_at: string | null;
};

type PositionSourceData = {
  price0Usd?: number | null;
  price1Usd?: number | null;
  unclaimedFees0?: number | null;
  unclaimedFees1?: number | null;
  feeValuation?: string;
};
type PositionSnapshot = {
  id: string;
  wallet_id: string;
  protocol_version: "v2" | "v3" | "v4";
  position_ref: string;
  token0_address: string | null;
  token1_address: string | null;
  token0_symbol: string | null;
  token1_symbol: string | null;
  amount0: number | string | null;
  amount1: number | string | null;
  liquidity_usd: number | string | null;
  unclaimed_fees_usd: number | string | null;
  observed_at: string;
  is_open: boolean;
  is_baseline: boolean;
  source_data: PositionSourceData | null;
};
type TrackedPosition = PositionSnapshot & { baseline: PositionSnapshot | null };

const ROBINHOOD_USDG_ADDRESS = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

function getExitAmounts(position: PositionSnapshot) {
  const feesIncluded = position.protocol_version === "v4" && position.source_data?.feeValuation === "included_from_fee_growth";
  const fees0 = feesIncluded ? Number(position.source_data?.unclaimedFees0 ?? 0) : 0;
  const fees1 = feesIncluded ? Number(position.source_data?.unclaimedFees1 ?? 0) : 0;
  return {
    amount0: Number(position.amount0 ?? 0) + fees0,
    amount1: Number(position.amount1 ?? 0) + fees1,
  };
}

function getTokenUsdPrice(position: PositionSnapshot, index: 0 | 1) {
  const saved = Number(position.source_data?.[`price${index}Usd`]);
  if (Number.isFinite(saved) && saved > 0) return saved;
  const tokenAddress = index === 0 ? position.token0_address : position.token1_address;
  if (tokenAddress?.toLowerCase() === ROBINHOOD_USDG_ADDRESS) return 1;
  return null;
}

function getExitValueUsd(position: PositionSnapshot) {
  const price0 = getTokenUsdPrice(position, 0);
  const price1 = getTokenUsdPrice(position, 1);
  if (price0 == null || price1 == null) return null;
  const amounts = getExitAmounts(position);
  return amounts.amount0 * price0 + amounts.amount1 * price1;
}

function formatUsd(value: number | null) {
  return value == null || !Number.isFinite(value)
    ? "Indisponível"
    : value.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

function formatTokenAmount(value: number, symbol: string | null) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 8 })} ${symbol ?? "token"}`;
}

function formatTokenDelta(value: number, symbol: string | null) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatTokenAmount(value, symbol)}`;
}

function getPositionKey(position: PositionSnapshot) {
  return `${position.wallet_id}:${position.protocol_version}:${position.position_ref}`;
}

function findRabbyProvider(): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const announced: Eip6963ProviderDetail[] = [];
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.info?.rdns === "io.rabby") announced.push(detail);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  return new Promise((resolve) => {
    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (announced[0]?.provider) return resolve(announced[0].provider);
      const candidates = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : []);
      resolve(candidates.find((provider) => provider.isRabby) ?? null);
    }, 200);
  });
}

function DefiPage() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [positions, setPositions] = useState<TrackedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ cursor: number; total: number } | null>(null);
  const syncLock = useRef(false);
  const syncWalletsRef = useRef<((force?: boolean) => Promise<void>) | null>(null);

  const trackingStart = useMemo(() => {
    if (!wallets.length) return null;
    return wallets.reduce((earliest, wallet) =>
      wallet.tracking_started_at < earliest ? wallet.tracking_started_at : earliest,
    wallets[0].tracking_started_at);
  }, [wallets]);

  const loadWallets = useCallback(async () => {
    if (!user) return;
    const snapshotFields = "id,wallet_id,protocol_version,position_ref,token0_address,token0_symbol,token1_address,token1_symbol,amount0,amount1,liquidity_usd,unclaimed_fees_usd,observed_at,is_open,is_baseline,source_data";
    const [walletResult, positionResult, baselineResult] = await Promise.all([
      (supabase as any).from("defi_wallets")
      .select("id,address,tracking_started_at,last_synced_at")
      .eq("user_id", user.id)
      .order("tracking_started_at", { ascending: true }),
      (supabase as any).from("defi_position_snapshots")
        .select(snapshotFields)
        .eq("user_id", user.id).eq("chain_id", 4663).in("protocol_version", ["v3", "v4"]).eq("is_open", true)
        .order("observed_at", { ascending: false }).limit(2000),
      (supabase as any).from("defi_position_snapshots")
        .select(snapshotFields)
        .eq("user_id", user.id).eq("chain_id", 4663).in("protocol_version", ["v3", "v4"]).eq("is_baseline", true)
        .order("observed_at", { ascending: true }).limit(2000),
    ]);
    if (walletResult.error || positionResult.error || baselineResult.error) {
      toast.error("Não foi possível carregar as carteiras DeFi.");
    } else {
      setWallets((walletResult.data ?? []) as TrackedWallet[]);
      const latest = new Map<string, PositionSnapshot>();
      for (const row of (positionResult.data ?? []) as PositionSnapshot[]) {
        const key = getPositionKey(row);
        if (!latest.has(key)) latest.set(key, row);
      }
      const baselines = new Map<string, PositionSnapshot>();
      for (const row of (baselineResult.data ?? []) as PositionSnapshot[]) {
        const key = getPositionKey(row);
        if (!baselines.has(key)) baselines.set(key, row);
      }
      setPositions([...latest.values()].filter((position) => position.is_open).map((position) => ({
        ...position,
        baseline: baselines.get(getPositionKey(position)) ?? null,
      })));
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void loadWallets(); }, [loadWallets]);

  const syncWallets = useCallback(async (force = false) => {
    if (!wallets.length || syncLock.current) return;
    const hour = 60 * 60 * 1000;
    const due = wallets.filter((wallet) => !wallet.last_synced_at ||
      Date.now() - new Date(wallet.last_synced_at).getTime() >= hour);
    if (!due.length) {
      if (force) toast.info("A próxima atualização estará disponível após o intervalo de uma hora.");
      return;
    }
    syncLock.current = true;
    setSyncing(true);
    try {
      let updatedCount = 0;
      let discoveredCount = 0;
      let failedPositionCount = 0;
      let alreadySyncedCount = 0;
      for (const wallet of due) {
        let previousCursor = -1;
        let walletComplete = false;
        while (!walletComplete) {
          const { data, error } = await supabase.functions.invoke("defi-sync", { body: { walletId: wallet.id } });
          if (error) throw error;
          if (data?.skipped) {
            if (data.reason !== "sync_in_progress") alreadySyncedCount += 1;
            break;
          }
          discoveredCount = Math.max(discoveredCount, Number(data?.openPositions ?? data?.candidatePositions ?? 0));
          failedPositionCount = Math.max(failedPositionCount, Number(data?.failedPositions ?? 0));
          walletComplete = data?.syncComplete !== false;
          const nextCursor = Number(data?.nextCursor ?? 0);
          setSyncProgress(walletComplete ? null : { cursor: nextCursor, total: Number(data?.candidatePositions ?? 0) });
          await loadWallets();
          if (walletComplete) {
            updatedCount += 1;
            break;
          }
          if (!Number.isFinite(nextCursor) || nextCursor <= previousCursor) {
            throw new Error("A leitura das posições não avançou. Tente atualizar novamente.");
          }
          previousCursor = nextCursor;
        }
      }
      if (updatedCount > 0 && discoveredCount === 0) {
        toast.info("Sincronização concluída. Nenhuma posição aberta da Uniswap foi encontrada nesta carteira.");
      } else if (updatedCount > 0 && failedPositionCount > 0) {
        toast.warning(`Monitoramento atualizado; ${failedPositionCount} posição(ões) não puderam ser lidas e serão tentadas na próxima atualização.`);
      } else if (updatedCount > 0) {
        toast.success("Posições DeFi atualizadas.");
      } else if (alreadySyncedCount > 0 && force) {
        toast.info("A carteira já foi atualizada em outra sessão.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar as posições DeFi.");
    } finally {
      syncLock.current = false;
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [wallets, loadWallets]);

  useEffect(() => { syncWalletsRef.current = syncWallets; }, [syncWallets]);

  useEffect(() => {
    if (loading || !wallets.length) return;
    void syncWalletsRef.current?.();
    const timer = window.setInterval(() => void syncWalletsRef.current?.(), 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncWalletsRef.current?.();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loading, wallets.length]);

  async function connectRabby() {
    if (!user) return;
    setConnecting(true);
    try {
      const provider = await findRabbyProvider();
      if (!provider) throw new Error("Rabby não foi encontrada neste navegador.");
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts?.[0];
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error("A Rabby não retornou um endereço válido.");
      }

      const { error } = await (supabase as any).from("defi_wallets").upsert(
        { user_id: user.id, provider: "rabby", address: address.toLowerCase() },
        { onConflict: "user_id,address", ignoreDuplicates: true },
      );
      if (error) throw error;
      await loadWallets();
      toast.success("Carteira conectada em modo somente leitura.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao conectar a carteira.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Waves className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Pools DeFi</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe posições de liquidez Uniswap separadas dos ativos em hold.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Somente leitura</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Carteiras monitoradas</CardTitle>
              <CardDescription className="mt-1">
                {syncProgress
                  ? `Lendo posições DeFi: ${Math.min(syncProgress.cursor, syncProgress.total)} de ${syncProgress.total}.`
                  : "Atualização automática a cada hora enquanto esta tela estiver aberta."}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void syncWallets(true)} disabled={syncing || !wallets.length || wallets.every((wallet) => wallet.last_synced_at && Date.now() - new Date(wallet.last_synced_at).getTime() < 60 * 60 * 1000)}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Atualizar agora
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando carteiras…</div>
          ) : wallets.length ? (
            <div className="space-y-2">
              {wallets.map((wallet) => (
                <div key={wallet.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="font-mono text-sm">{wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Monitoramento desde {new Date(wallet.tracking_started_at).toLocaleString("pt-BR")}</p>
                  </div>
              <Badge variant={wallet.last_synced_at ? "secondary" : "outline"}>
                    {wallet.last_synced_at ? `Atualizada ${new Date(wallet.last_synced_at).toLocaleString("pt-BR")}` : "Aguardando primeira leitura"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma carteira conectada ainda.</p>
          )}
          <Button onClick={connectRabby} disabled={connecting}>
            {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Conectar Rabby
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posições abertas na Robinhood</CardTitle>
          <CardDescription>Estimativa do que seria recebido ao retirar a liquidez agora, incluindo taxas V4 acumuladas e comparando com a primeira leitura.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {positions.length ? positions.map((position) => (
            (() => {
              const exitAmounts = getExitAmounts(position);
              const exitValue = getExitValueUsd(position);
              const baseline = position.baseline;
              const baselineValue = baseline ? getExitValueUsd(baseline) : null;
              const pnl = exitValue != null && baselineValue != null ? exitValue - baselineValue : null;
              const pnlPercent = pnl != null && baselineValue != null && baselineValue > 0 ? (pnl / baselineValue) * 100 : null;
              const baselineAmounts = baseline ? getExitAmounts(baseline) : null;
              return (
                <div key={getPositionKey(position)} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{position.token0_symbol ?? "Token"} / {position.token1_symbol ?? "Token"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Uniswap {position.protocol_version} · posição #{position.position_ref}</p>
                    </div>
                    <p className="font-semibold">{formatUsd(exitValue)}</p>
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Receberia ao retirar agora: </span>{formatTokenAmount(exitAmounts.amount0, position.token0_symbol)} + {formatTokenAmount(exitAmounts.amount1, position.token1_symbol)}</p>
                    <p><span className="text-muted-foreground">Lucro/prejuízo estimado desde o saldo inicial: </span>
                      <span className={pnl == null ? "text-muted-foreground" : pnl >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-destructive"}>
                        {pnl == null ? "Aguardando custo base ou cotação" : `${pnl > 0 ? "+" : ""}${formatUsd(pnl)}${pnlPercent == null ? "" : ` (${pnlPercent > 0 ? "+" : ""}${pnlPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`}`}
                      </span>
                    </p>
                    {baselineAmounts && (
                      <p className="text-xs text-muted-foreground">
                        Variação em tokens desde a primeira leitura: {formatTokenDelta(exitAmounts.amount0 - baselineAmounts.amount0, position.token0_symbol)} · {formatTokenDelta(exitAmounts.amount1 - baselineAmounts.amount1, position.token1_symbol)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {position.protocol_version === "v4" ? "Taxas não coletadas estimadas e incluídas." : "Taxas da V3 ainda não incluídas."} Estimativa sem custo de gás.
                    </p>
                  </div>
                </div>
              );
            })()
          )) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">As posições detectadas aparecerão aqui após conectar a Rabby e fazer a primeira leitura.</p>
          )}
          <p className="text-xs text-muted-foreground">O lucro/prejuízo compara o valor estimado de retirada com o primeiro retrato da posição. Novos aportes ou retiradas de liquidez após essa leitura ainda podem alterar o resultado. USDG é estimado pela paridade de referência de US$ 1; valores não incluem gás nem possível diferença de preço na execução.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posições e histórico</CardTitle>
          <CardDescription>
            {trackingStart
              ? `O histórico será contado a partir de ${new Date(trackingStart).toLocaleDateString("pt-BR")}. As posições que já estiverem abertas entram como saldo inicial.`
              : "Ao conectar uma carteira, o primeiro retrato das posições abertas será o saldo inicial do acompanhamento."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 rounded-lg bg-muted/50 p-4 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-2 text-muted-foreground">
              <p>O rastreador consulta posições NFT de Uniswap v3 e v4 na Robinhood Chain e estima o valor dos tokens quando há cotação disponível.</p>
              <p>O histórico anterior à conexão serve somente para identificar posições que continuam abertas; não é importado como atividade. Posições Uniswap v2 ficam para uma etapa futura.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">O Folio armazena apenas o endereço público da carteira. Nunca informe frase-semente ou chave privada.</p>
    </div>
  );
}

