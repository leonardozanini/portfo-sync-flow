import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CHAIN_ID = 4663;
const NETWORK = "robinhood-mainnet";
const POSITION_MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const TRANSFERS_URL = "https://api.g.alchemy.com/data/v1";
const RPC_URL = "https://robinhood-mainnet.g.alchemy.com/v2";
const ZERO = "0x0000000000000000000000000000000000000000";
const Q96 = 2 ** 96;

type Transfer = {
  hash: string;
  blockNum: string;
  blockTimestamp?: string;
  from: string;
  to: string;
  contractAddress?: string;
  uniqueId?: string;
  nfts?: { tokens?: Array<{ tokenId: string }> };
};

function cors() {
  return {
    "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function word(hex: string, index: number) {
  return hex.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function asAddress(hexWord: string) {
  return `0x${hexWord.slice(-40)}`.toLowerCase();
}

function asInt24(hexWord: string) {
  const value = BigInt(`0x${hexWord}`);
  const signed = value >= (1n << 255n) ? value - (1n << 256n) : value;
  return Number(signed);
}

function encodeUint(value: bigint | number) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function selector(signature: string) {
  // Selectors below are constants from the verified Uniswap v3 ABI.
  const selectors: Record<string, string> = {
    ownerOf: "0x6352211e",
    positions: "0x99fbab88",
    getPool: "0x1698ee82",
    slot0: "0x3850c7bd",
    decimals: "0x313ce567",
    symbol: "0x95d89b41",
  };
  return selectors[signature];
}

async function rpc(apiKey: string, method: string, params: unknown[]) {
  const response = await fetch(`${RPC_URL}/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message ?? `RPC ${response.status}`);
  return result.result as string;
}

async function call(apiKey: string, to: string, data: string) {
  return rpc(apiKey, "eth_call", [{ to, data }, "latest"]);
}

async function tokenMetadata(apiKey: string, address: string) {
  const [decimalsHex, symbolHex] = await Promise.all([
    call(apiKey, address, selector("decimals")),
    call(apiKey, address, selector("symbol")),
  ]);
  const decimals = Number(BigInt(decimalsHex));
  let symbol = "TOKEN";
  try {
    const offset = Number(BigInt(`0x${word(symbolHex, 0)}`));
    const start = 2 + offset * 2;
    const length = Number(BigInt(`0x${symbolHex.slice(start, start + 64)}`));
    const bytes = symbolHex.slice(start + 64, start + 64 + length * 2);
    symbol = new TextDecoder().decode(Uint8Array.from(bytes.match(/.{2}/g) ?? [], (b) => parseInt(b, 16)));
  } catch { /* Keep a safe display fallback for malformed metadata. */ }
  return { decimals: Math.min(Math.max(decimals, 0), 36), symbol: symbol || "TOKEN" };
}

async function getUsdPrice(address: string) {
  try {
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${address}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const pairs = await response.json() as Array<{ chainId?: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }>;
    const pair = pairs.filter((item) => item.chainId === "robinhood")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const price = Number(pair?.priceUsd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch { return null; }
}

async function transfersForWallet(apiKey: string, address: string, fromTimestamp?: string) {
  const transfers: Transfer[] = [];
  let pageKey: string | undefined;
  for (let page = 0; page < 25; page++) {
    const response = await fetch(`${TRANSFERS_URL}/${apiKey}/transfers/by-address`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        direction: "both",
        networks: [NETWORK],
        category: ["erc721"],
        order: "desc",
        maxCount: 100,
        ...(fromTimestamp ? { fromTimestamp } : {}),
        ...(pageKey ? { pageKey } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message ?? `Alchemy Transfers API ${response.status}`);
    if (payload?.error?.partialErrors?.length) {
      throw new Error("A Alchemy não retornou todos os dados ERC-721 da Robinhood; a sincronização foi interrompida para evitar um saldo incompleto.");
    }
    transfers.push(...(payload.transfers ?? []));
    pageKey = payload.pageKey;
    if (!pageKey) break;
    if (page === 24) throw new Error("A carteira excedeu o limite de 2.500 transferências ERC-721 por sincronização; nenhuma posição foi alterada.");
  }
  return transfers.filter((transfer) => transfer.contractAddress?.toLowerCase() === POSITION_MANAGER);
}

function sqrtRatioAtTick(tick: number) {
  return Math.sqrt(1.0001 ** tick);
}

function positionAmounts(liquidity: number, sqrtPrice: number, tickLower: number, tickUpper: number) {
  const sqrtLower = sqrtRatioAtTick(tickLower);
  const sqrtUpper = sqrtRatioAtTick(tickUpper);
  let amount0 = 0;
  let amount1 = 0;
  if (sqrtPrice <= sqrtLower) amount0 = liquidity * (sqrtUpper - sqrtLower) / (sqrtUpper * sqrtLower);
  else if (sqrtPrice < sqrtUpper) {
    amount0 = liquidity * (sqrtUpper - sqrtPrice) / (sqrtUpper * sqrtPrice);
    amount1 = liquidity * (sqrtPrice - sqrtLower);
  } else amount1 = liquidity * (sqrtUpper - sqrtLower);
  return { amount0: Math.max(0, amount0), amount1: Math.max(0, amount1) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (request.method !== "POST") return Response.json({ error: "Método não permitido." }, { status: 405, headers: cors() });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const alchemyKey = Deno.env.get("ALCHEMY_API_KEY");
  if (!supabaseUrl || !serviceKey || !alchemyKey) {
    return Response.json({ error: "A configuração do sincronizador está incompleta." }, { status: 503, headers: cors() });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return Response.json({ error: "Sessão inválida." }, { status: 401, headers: cors() });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !auth.user) return Response.json({ error: "Sessão inválida." }, { status: 401, headers: cors() });

  try {
    const { walletId } = await request.json();
    if (typeof walletId !== "string") return Response.json({ error: "Carteira inválida." }, { status: 400, headers: cors() });
    const { data: wallet, error: walletError } = await admin.from("defi_wallets")
      .select("id,user_id,address,tracking_started_at,last_synced_at")
      .eq("id", walletId).eq("user_id", auth.user.id).single();
    if (walletError || !wallet) return Response.json({ error: "Carteira não encontrada." }, { status: 404, headers: cors() });
    if (wallet.last_synced_at && Date.now() - new Date(wallet.last_synced_at).getTime() < 60 * 60 * 1000) {
      return Response.json({ skipped: true, lastSyncedAt: wallet.last_synced_at }, { headers: cors() });
    }

    const chainId = Number(BigInt(await rpc(alchemyKey, "eth_chainId", [])));
    if (chainId !== CHAIN_ID) throw new Error(`RPC retornou chainId inesperado: ${chainId}`);
    const allTransfers = await transfersForWallet(alchemyKey, wallet.address, wallet.last_synced_at ?? undefined);
    const owners = new Map<string, string>();
    let priorSnapshots: Array<Record<string, unknown>> = [];
    if (wallet.last_synced_at) {
      const { data, error: priorError } = await admin.from("defi_position_snapshots")
        .select("position_ref,pool_address,token0_address,token0_symbol,token1_address,token1_symbol,amount0,amount1,liquidity_usd,unclaimed_fees_usd,source_block,source_data")
        .eq("wallet_id", wallet.id).eq("chain_id", CHAIN_ID)
        .eq("protocol_version", "v3").eq("is_open", true).order("observed_at", { ascending: false }).limit(2000);
      if (priorError) throw priorError;
      const uniquePrior = new Map<string, Record<string, unknown>>();
      for (const row of data ?? []) {
        const id = String(row.position_ref);
        if (!uniquePrior.has(id)) uniquePrior.set(id, row);
      }
      priorSnapshots = [...uniquePrior.values()];
      for (const row of priorSnapshots ?? []) owners.set(String(row.position_ref), wallet.address.toLowerCase());
    }
    for (const transfer of [...allTransfers].reverse()) {
      for (const nft of transfer.nfts?.tokens ?? []) owners.set(BigInt(nft.tokenId).toString(), transfer.to.toLowerCase());
    }
    const tokenIds = [...owners].filter(([, owner]) => owner === wallet.address.toLowerCase()).map(([id]) => id);
    const snapshots = [];
    const transfersAfterStart = (wallet.last_synced_at
      ? allTransfers.filter((event) => event.blockTimestamp && event.blockTimestamp > wallet.last_synced_at!)
      : []);

    for (const tokenId of tokenIds) {
      const id = BigInt(tokenId);
      let owner: string;
      try {
        owner = asAddress(await call(alchemyKey, POSITION_MANAGER, `${selector("ownerOf")}${encodeUint(id)}`));
      } catch {
        continue;
      }
      if (owner !== wallet.address.toLowerCase()) continue;
      const position = await call(alchemyKey, POSITION_MANAGER, `${selector("positions")}${encodeUint(id)}`);
      const token0 = asAddress(word(position, 2));
      const token1 = asAddress(word(position, 3));
      const fee = BigInt(`0x${word(position, 4)}`);
      const tickLower = asInt24(word(position, 5));
      const tickUpper = asInt24(word(position, 6));
      const liquidity = BigInt(`0x${word(position, 7)}`);
      const poolData = `${encodeUint(BigInt(token0))}${encodeUint(BigInt(token1))}${encodeUint(fee)}`;
      const pool = asAddress(await call(alchemyKey, FACTORY, `${selector("getPool")}${poolData}`));
      if (pool === ZERO) continue;
      const [slot0, meta0, meta1, price0, price1] = await Promise.all([
        call(alchemyKey, pool, selector("slot0")),
        tokenMetadata(alchemyKey, token0), tokenMetadata(alchemyKey, token1),
        getUsdPrice(token0), getUsdPrice(token1),
      ]);
      const sqrtPriceX96 = BigInt(`0x${word(slot0, 0)}`);
      const sqrtPrice = Number(sqrtPriceX96) / Q96;
      const amounts = positionAmounts(Number(liquidity), sqrtPrice, tickLower, tickUpper);
      const amount0 = amounts.amount0 / (10 ** meta0.decimals);
      const amount1 = amounts.amount1 / (10 ** meta1.decimals);
      const value0 = price0 == null ? null : amount0 * price0;
      const value1 = price1 == null ? null : amount1 * price1;
      const positionValue = value0 == null || value1 == null ? null : value0 + value1;
      const sourceBlock = Number(BigInt(await rpc(alchemyKey, "eth_blockNumber", [])));
      snapshots.push({
        user_id: wallet.user_id,
        wallet_id: wallet.id,
        chain_id: CHAIN_ID,
        protocol: "uniswap",
        protocol_version: "v3",
        position_ref: tokenId,
        pool_address: pool,
        token0_address: token0,
        token0_symbol: meta0.symbol,
        token1_address: token1,
        token1_symbol: meta1.symbol,
        amount0,
        amount1,
        liquidity_usd: positionValue,
        unclaimed_fees_usd: null,
        is_open: true,
        is_baseline: wallet.last_synced_at == null,
        source_block: sourceBlock,
        source_data: {
          tickLower, tickUpper, feeTier: Number(fee), liquidity: liquidity.toString(),
          sqrtPriceX96: sqrtPriceX96.toString(), price0Usd: price0, price1Usd: price1,
          valuationComplete: positionValue != null,
          feeValuation: "not_included",
        },
      });
    }

    const now = new Date().toISOString();
    const activeIds = new Set(snapshots.map((snapshot) => String(snapshot.position_ref)));
    const closedSnapshots = priorSnapshots.filter((row) => !activeIds.has(String(row.position_ref))).map((row) => ({
      ...row,
      id: undefined,
      user_id: wallet.user_id,
      wallet_id: wallet.id,
      chain_id: CHAIN_ID,
      protocol: "uniswap",
      protocol_version: "v3",
      is_open: false,
      is_baseline: false,
      observed_at: now,
    }));
    snapshots.push(...closedSnapshots as typeof snapshots);
    if (snapshots.length) {
      const { error: snapshotError } = await admin.from("defi_position_snapshots").insert(snapshots);
      if (snapshotError) throw snapshotError;
    }
    if (transfersAfterStart.length) {
      const knownIds = new Set(tokenIds);
      const events = transfersAfterStart.flatMap((transfer) => (transfer.nfts?.tokens ?? []).flatMap((nft) => {
        if (transfer.contractAddress?.toLowerCase() !== POSITION_MANAGER) return [];
        const tokenId = BigInt(nft.tokenId).toString();
        if (!knownIds.has(tokenId)) return [];
        const from = transfer.from.toLowerCase();
        const to = transfer.to.toLowerCase();
        const eventType = from === ZERO || to === wallet.address.toLowerCase() ? "opened"
          : to === ZERO || from === wallet.address.toLowerCase() ? "closed" : null;
        if (!eventType) return [];
        const logIndex = Number(transfer.uniqueId?.match(/log:(\d+)/)?.[1] ?? 0);
        return [{
          user_id: wallet.user_id, wallet_id: wallet.id, chain_id: CHAIN_ID,
          protocol: "uniswap", protocol_version: "v3", position_ref: tokenId,
          event_type: eventType, transaction_hash: transfer.hash, log_index: logIndex,
          block_number: Number(BigInt(transfer.blockNum)),
          occurred_at: transfer.blockTimestamp ?? now,
          source_data: { from, to, source: "alchemy_transfers_by_wallet" },
        }];
      }));
      if (events.length) {
        const { error: eventError } = await admin.from("defi_position_events")
          .upsert(events, { onConflict: "wallet_id,chain_id,transaction_hash,log_index", ignoreDuplicates: true });
        if (eventError) throw eventError;
      }
    }
    const { error: updateError } = await admin.from("defi_wallets").update({ last_synced_at: now }).eq("id", wallet.id);
    if (updateError) throw updateError;
    return Response.json({
      chainId,
      wallet: wallet.address,
      candidatePositions: tokenIds.length,
      snapshotsWritten: snapshots.length,
      transfersSinceLastSync: transfersAfterStart.length,
      syncStatus: "v3_positions_synced_fees_not_included",
      updatedAt: now,
    }, { headers: cors() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar." }, { status: 502, headers: cors() });
  }
});

