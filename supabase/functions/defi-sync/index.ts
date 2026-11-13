import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi } from "npm:viem@2";

const CHAIN_ID = 4663;
const NETWORK = "robinhood-mainnet";
const POSITION_MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const V4_POSITION_MANAGER = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
const V4_STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const VERSIONS = new Map([[POSITION_MANAGER, "v3"], [V4_POSITION_MANAGER, "v4"]]);
const V4_POSITION_ABI = parseAbi([
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint256 info)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)",
]);
const V4_STATE_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getPositionInfo(bytes32 poolId,address owner,int24 tickLower,int24 tickUpper,bytes32 salt) view returns (uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId,int24 tickLower,int24 tickUpper) view returns (uint256 feeGrowthInside0X128,uint256 feeGrowthInside1X128)",
]);
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
  if (address.toLowerCase() === ZERO) return { decimals: 18, symbol: "ETH" };
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
    if (address.toLowerCase() === ZERO) {
      const ethResponse = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(10_000) });
      if (ethResponse.ok) {
        const ethPrice = Number((await ethResponse.json())?.ethereum?.usd);
        if (ethPrice > 0) return ethPrice;
      }
      return null;
    }
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${address}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const pairs = await response.json() as Array<{ chainId?: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }>;
    const pair = pairs.filter((item) => item.chainId === "robinhood" && item.baseToken?.address?.toLowerCase() === address.toLowerCase())
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
  return transfers.filter((transfer) => VERSIONS.has(transfer.contractAddress?.toLowerCase() ?? ""));
}

function decodeV4Tick(packedInfo: bigint, offset: number) {
  const raw = Number((packedInfo >> BigInt(offset)) & 0xffffffn);
  return raw >= 0x800000 ? raw - 0x1000000 : raw;
}

function v4PoolId(currency0: string, currency1: string, fee: bigint, tickSpacing: number, hooks: string) {
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [currency0 as `0x${string}`, currency1 as `0x${string}`, Number(fee), tickSpacing, hooks as `0x${string}`],
  );
  return keccak256(encoded);
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
        .select("position_ref,protocol_version,pool_address,token0_address,token0_symbol,token1_address,token1_symbol,amount0,amount1,liquidity_usd,unclaimed_fees_usd,source_block,source_data")
        .eq("wallet_id", wallet.id).eq("chain_id", CHAIN_ID)
        .in("protocol_version", ["v3", "v4"]).eq("is_open", true).order("observed_at", { ascending: false }).limit(2000);
      if (priorError) throw priorError;
      const uniquePrior = new Map<string, Record<string, unknown>>();
      for (const row of data ?? []) {
        const id = `${row.protocol_version}:${row.position_ref}`;
        if (!uniquePrior.has(id)) uniquePrior.set(id, row);
      }
      priorSnapshots = [...uniquePrior.values()];
      for (const row of priorSnapshots) owners.set(`${row.protocol_version}:${row.position_ref}`, wallet.address.toLowerCase());
    }
    for (const transfer of [...allTransfers].reverse()) {
      const version = VERSIONS.get(transfer.contractAddress?.toLowerCase() ?? "");
      if (!version) continue;
      for (const nft of transfer.nfts?.tokens ?? []) owners.set(`${version}:${BigInt(nft.tokenId)}`, transfer.to.toLowerCase());
    }
    const positions = [...owners].filter(([, owner]) => owner === wallet.address.toLowerCase()).map(([key]) => {
      const [version, ...idParts] = key.split(":");
      return { version, tokenId: idParts.join(":") };
    });
    const snapshots = [];
    const transfersAfterStart = (wallet.last_synced_at
      ? allTransfers.filter((event) => event.blockTimestamp && event.blockTimestamp > wallet.last_synced_at!)
      : []);

    for (const { version, tokenId } of positions) {
      const id = BigInt(tokenId);
      const manager = version === "v4" ? V4_POSITION_MANAGER : POSITION_MANAGER;
      let owner: string;
      try {
        owner = asAddress(await call(alchemyKey, manager, `${selector("ownerOf")}${encodeUint(id)}`));
      } catch (error) {
        throw new Error(`Não foi possível confirmar a titularidade da posição ${version} #${tokenId}: ${error instanceof Error ? error.message : "erro RPC"}`);
      }
      if (owner !== wallet.address.toLowerCase()) continue;
      let token0: string, token1: string, fee: bigint, tickLower: number, tickUpper: number;
      let liquidity: bigint, poolId: string | null = null, poolAddress: string | null = null;
      let sqrtPriceX96: bigint, feeAmount0 = 0n, feeAmount1 = 0n;
      if (version === "v3") {
        const position = await call(alchemyKey, manager, `${selector("positions")}${encodeUint(id)}`);
        token0 = asAddress(word(position, 2));
        token1 = asAddress(word(position, 3));
        fee = BigInt(`0x${word(position, 4)}`);
        tickLower = asInt24(word(position, 5));
        tickUpper = asInt24(word(position, 6));
        liquidity = BigInt(`0x${word(position, 7)}`);
        const poolData = `${encodeUint(BigInt(token0))}${encodeUint(BigInt(token1))}${encodeUint(fee)}`;
        poolAddress = asAddress(await call(alchemyKey, FACTORY, `${selector("getPool")}${poolData}`));
        if (poolAddress === ZERO) continue;
        const slot0 = await call(alchemyKey, poolAddress, selector("slot0"));
        sqrtPriceX96 = BigInt(`0x${word(slot0, 0)}`);
      } else {
        const encodedKey = encodeFunctionData({ abi: V4_POSITION_ABI, functionName: "getPoolAndPositionInfo", args: [id] });
        const positionData = await call(alchemyKey, manager, encodedKey);
        const [poolKey, packedInfo] = decodeFunctionResult({ abi: V4_POSITION_ABI, functionName: "getPoolAndPositionInfo", data: positionData });
        token0 = poolKey.currency0.toLowerCase();
        token1 = poolKey.currency1.toLowerCase();
        fee = BigInt(poolKey.fee);
        tickLower = decodeV4Tick(packedInfo, 8);
        tickUpper = decodeV4Tick(packedInfo, 32);
        liquidity = decodeFunctionResult({
          abi: V4_POSITION_ABI, functionName: "getPositionLiquidity",
          data: await call(alchemyKey, manager, encodeFunctionData({ abi: V4_POSITION_ABI, functionName: "getPositionLiquidity", args: [id] })),
        });
        poolId = v4PoolId(token0, token1, fee, poolKey.tickSpacing, poolKey.hooks.toLowerCase());
        const slotData = await call(alchemyKey, V4_STATE_VIEW, encodeFunctionData({ abi: V4_STATE_ABI, functionName: "getSlot0", args: [poolId as `0x${string}`] }));
        const [sqrtPrice] = decodeFunctionResult({ abi: V4_STATE_ABI, functionName: "getSlot0", data: slotData });
        sqrtPriceX96 = sqrtPrice;
        const positionInfoData = await call(alchemyKey, V4_STATE_VIEW, encodeFunctionData({
          abi: V4_STATE_ABI, functionName: "getPositionInfo",
          args: [poolId as `0x${string}`, manager as `0x${string}`, tickLower, tickUpper, `0x${id.toString(16).padStart(64, "0")}`],
        }));
        const [, lastGrowth0, lastGrowth1] = decodeFunctionResult({ abi: V4_STATE_ABI, functionName: "getPositionInfo", data: positionInfoData });
        const growthData = await call(alchemyKey, V4_STATE_VIEW, encodeFunctionData({
          abi: V4_STATE_ABI, functionName: "getFeeGrowthInside", args: [poolId as `0x${string}`, tickLower, tickUpper],
        }));
        const [growth0, growth1] = decodeFunctionResult({ abi: V4_STATE_ABI, functionName: "getFeeGrowthInside", data: growthData });
        const q128 = 1n << 128n;
        feeAmount0 = liquidity * BigInt.asUintN(256, growth0 - lastGrowth0) / q128;
        feeAmount1 = liquidity * BigInt.asUintN(256, growth1 - lastGrowth1) / q128;
      }
      const [meta0, meta1, price0, price1] = await Promise.all([
        tokenMetadata(alchemyKey, token0), tokenMetadata(alchemyKey, token1),
        getUsdPrice(token0), getUsdPrice(token1),
      ]);
      const sqrtPrice = Number(sqrtPriceX96) / Q96;
      const amounts = positionAmounts(Number(liquidity), sqrtPrice, tickLower, tickUpper);
      const amount0 = amounts.amount0 / (10 ** meta0.decimals);
      const amount1 = amounts.amount1 / (10 ** meta1.decimals);
      const value0 = price0 == null ? null : amount0 * price0;
      const value1 = price1 == null ? null : amount1 * price1;
      const fees0 = Number(feeAmount0) / (10 ** meta0.decimals);
      const fees1 = Number(feeAmount1) / (10 ** meta1.decimals);
      const feeValue = price0 == null || price1 == null ? null : fees0 * price0 + fees1 * price1;
      const principalValue = value0 == null || value1 == null ? null : value0 + value1;
      const positionValue = principalValue == null || (version === "v4" && feeValue == null) ? null : principalValue + (feeValue ?? 0);
      const sourceBlock = Number(BigInt(await rpc(alchemyKey, "eth_blockNumber", [])));
      snapshots.push({
        user_id: wallet.user_id,
        wallet_id: wallet.id,
        chain_id: CHAIN_ID,
        protocol: "uniswap",
        protocol_version: version,
        position_ref: tokenId,
        pool_address: poolAddress,
        token0_address: token0,
        token0_symbol: meta0.symbol,
        token1_address: token1,
        token1_symbol: meta1.symbol,
        amount0,
        amount1,
        liquidity_usd: positionValue,
        unclaimed_fees_usd: version === "v4" ? feeValue : null,
        is_open: true,
        is_baseline: wallet.last_synced_at == null,
        source_block: sourceBlock,
        source_data: {
          tickLower, tickUpper, feeTier: Number(fee), liquidity: liquidity.toString(), poolId,
          sqrtPriceX96: sqrtPriceX96.toString(), price0Usd: price0, price1Usd: price1,
          valuationComplete: positionValue != null,
          feeValuation: version === "v4" ? "included_from_fee_growth" : "not_included",
          unclaimedFees0: fees0, unclaimedFees1: fees1,
        },
      });
    }

    const now = new Date().toISOString();
    const activeIds = new Set(snapshots.map((snapshot) => `${snapshot.protocol_version}:${snapshot.position_ref}`));
    const closedSnapshots = priorSnapshots.filter((row) => !activeIds.has(`${row.protocol_version}:${row.position_ref}`)).map((row) => ({
      ...row,
      id: undefined,
      user_id: wallet.user_id,
      wallet_id: wallet.id,
      chain_id: CHAIN_ID,
      protocol: "uniswap",
      protocol_version: row.protocol_version,
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
      const knownIds = new Set([
        ...positions.map((position) => `${position.version}:${position.tokenId}`),
        ...priorSnapshots.map((row) => `${row.protocol_version}:${row.position_ref}`),
      ]);
      const events = transfersAfterStart.flatMap((transfer) => (transfer.nfts?.tokens ?? []).flatMap((nft) => {
        const version = VERSIONS.get(transfer.contractAddress?.toLowerCase() ?? "");
        if (!version) return [];
        const tokenId = BigInt(nft.tokenId).toString();
        if (!knownIds.has(`${version}:${tokenId}`)) return [];
        const from = transfer.from.toLowerCase();
        const to = transfer.to.toLowerCase();
        const eventType = from === ZERO || to === wallet.address.toLowerCase() ? "opened"
          : to === ZERO || from === wallet.address.toLowerCase() ? "closed" : null;
        if (!eventType) return [];
        const logIndex = Number(transfer.uniqueId?.match(/log:(\d+)/)?.[1] ?? 0);
        return [{
          user_id: wallet.user_id, wallet_id: wallet.id, chain_id: CHAIN_ID,
          protocol: "uniswap", protocol_version: version, position_ref: tokenId,
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
      candidatePositions: positions.length,
      snapshotsWritten: snapshots.length,
      transfersSinceLastSync: transfersAfterStart.length,
      syncStatus: "v3_v4_positions_synced",
      updatedAt: now,
    }, { headers: cors() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar." }, { status: 502, headers: cors() });
  }
});

