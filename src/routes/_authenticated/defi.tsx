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

type TrackedPosition = {
  id: string;
  protocol_version: "v2" | "v3" | "v4";
  position_ref: string;
  token0_symbol: string | null;
  token1_symbol: string | null;
  amount0: number | string | null;
  amount1: number | string | null;
  liquidity_usd: number | string | null;
  unclaimed_fees_usd: number | string | null;
  observed_at: string;
  is_open: boolean;
};

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
  const syncLock = useRef(false);

  const trackingStart = useMemo(() => {
    if (!wallets.length) return null;
    return wallets.reduce((earliest, wallet) =>
      wallet.tracking_started_at < earliest ? wallet.tracking_started_at : earliest,
    wallets[0].tracking_started_at);
  }, [wallets]);

  const loadWallets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [walletResult, positionResult] = await Promise.all([
      (supabase as any).from("defi_wallets")
      .select("id,address,tracking_started_at,last_synced_at")
      .eq("user_id", user.id)
      .order("tracking_started_at", { ascending: true }),
      (supabase as any).from("defi_position_snapshots")
        .select("id,protocol_version,position_ref,token0_symbol,token1_symbol,amount0,amount1,liquidity_usd,unclaimed_fees_usd,observed_at,is_open")
        .eq("user_id", user.id).eq("chain_id", 4663).in("protocol_version", ["v3", "v4"])
        .order("observed_at", { ascending: false }).limit(500),
    ]);
    if (walletResult.error || positionResult.error) {
      toast.error("Não foi possível carregar as carteiras DeFi.");
    } else {
      setWallets((walletResult.data ?? []) as TrackedWallet[]);
      const latest = new Map<string, TrackedPosition>();
      for (const row of (positionResult.data ?? []) as TrackedPosition[]) {
        const key = `${row.protocol_version}:${row.position_ref}`;
        if (!latest.has(key)) latest.set(key, row);
      }
      setPositions([...latest.values()].filter((position) => position.is_open));
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
      for (const wallet of due) {
        const { data, error } = await supabase.functions.invoke("defi-sync", { body: { walletId: wallet.id } });
        if (error) throw error;
        if (data?.skipped) {
          toast.info("Esta carteira já foi atualizada na última hora.");
          continue;
        }
      }
      await loadWallets();
      toast.success("Posições DeFi atualizadas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar as posições DeFi.");
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [wallets, loadWallets]);

  useEffect(() => {
    void syncWallets();
    const timer = window.setInterval(() => void syncWallets(), 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncWallets();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncWallets]);

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
              <CardDescription className="mt-1">Atualização automática a cada hora enquanto esta tela estiver aberta.</CardDescription>
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
          <CardDescription>Estimativa das posições Uniswap v3 e v4 encontradas na carteira. Valores são atualizados por hora enquanto esta tela estiver aberta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {positions.length ? positions.map((position) => (
            <div key={`${position.protocol_version}:${position.position_ref}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="font-medium">{position.token0_symbol ?? "Token"} / {position.token1_symbol ?? "Token"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Uniswap {position.protocol_version} · posição #{position.position_ref} · {Number(position.amount0 ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} {position.token0_symbol ?? ""} · {Number(position.amount1 ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} {position.token1_symbol ?? ""}</p>
              </div>
              <p className="font-semibold">
                {position.liquidity_usd == null ? "Cotação indisponível" : Number(position.liquidity_usd).toLocaleString("pt-BR", { style: "currency", currency: "USD" })}
              </p>
            </div>
          )) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">As posições detectadas aparecerão aqui após conectar a Rabby e fazer a primeira leitura.</p>
          )}
          <p className="text-xs text-muted-foreground">Na V4, as taxas não coletadas são estimadas pelo fee growth. Na V3, ainda não estão incluídas.</p>
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

