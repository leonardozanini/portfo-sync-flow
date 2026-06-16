import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { getDashboard } from "@/lib/portfolio.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

interface TickerItem {
  symbol: string;
  price: string;
  change: number; // percentual
  currency: string;
}

// ── Busca índices e câmbio via Stooq ────────────────────────────────────────
async function fetchMarketData(): Promise<TickerItem[]> {
  const items: TickerItem[] = [];

  const stooqTargets = [
    { symbol: "^BVSP", label: "IBOV", currency: "BRL" },
    { symbol: "^IFIX", label: "IFIX", currency: "BRL" },
    { symbol: "USDBRL=X", label: "USD", currency: "BRL" },
    { symbol: "EURBRL=X", label: "EUR", currency: "BRL" },
    { symbol: "BTC.V", label: "BTC", currency: "USD" },
  ];

  await Promise.allSettled(
    stooqTargets.map(async (t) => {
      try {
        const url = `https://stooq.com/q/l/?s=${t.symbol}&f=sd2t2ohlcv&h&e=csv`;
        const res = await fetch(`/api/proxy-stooq?url=${encodeURIComponent(url)}`);
        if (!res.ok) return;
        const text = await res.text();
        const lines = text.trim().split("\n");
        if (lines.length < 2) return;
        const cols = lines[1].split(",");
        const close = parseFloat(cols[6]);
        const open = parseFloat(cols[4]);
        if (!close || !open) return;
        const change = ((close - open) / open) * 100;
        items.push({
          symbol: t.label,
          price: close.toLocaleString("pt-BR", {
            minimumFractionDigits: t.label === "USD" || t.label === "EUR" ? 4 : 2,
            maximumFractionDigits: t.label === "USD" || t.label === "EUR" ? 4 : 2,
          }),
          change: parseFloat(change.toFixed(2)),
          currency: t.currency,
        });
      } catch { /* silently skip */ }
    })
  );

  return items;
}

// ── Componente de item individual ────────────────────────────────────────────
function TickerItem({ item }: { item: TickerItem }) {
  const pos = item.change >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap">
      <span className="font-semibold text-foreground text-xs tracking-wide">
        {item.symbol}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {item.currency === "BRL" ? "R$" : item.currency === "EUR" ? "€" : "$"}{" "}
        {item.price}
      </span>
      <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
        pos ? "text-emerald-500" : "text-red-500"
      }`}>
        {pos
          ? <TrendingUp className="h-3 w-3" />
          : <TrendingDown className="h-3 w-3" />}
        {pos ? "+" : ""}{item.change.toFixed(2)}%
      </span>
      <span className="text-border ml-2 select-none">·</span>
    </span>
  );
}

// ── TickerTape principal ─────────────────────────────────────────────────────
export function TickerTape({ portfolioItems }: { portfolioItems: TickerItem[] }) {
  const [marketItems, setMarketItems] = useState<TickerItem[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);

  // Busca dados de mercado uma vez ao montar
  useEffect(() => {
    fetchMarketData().then(setMarketItems).catch(() => {});
  }, []);

  const allItems = [
    // Índices e câmbio primeiro
    ...marketItems,
    // Separador visual
    // Maiores posições da carteira
    ...portfolioItems,
  ];

  // Duplica para loop infinito
  const doubled = [...allItems, ...allItems];

  // Velocidade: 40px por segundo
  const duration = Math.max(20, doubled.length * 3);

  if (allItems.length === 0) return null;

  return (
    <div className="relative w-full overflow-hidden border-b bg-card/80 backdrop-blur-sm h-8 flex items-center">
      {/* Gradiente nas bordas */}
      <div className="pointer-events-none absolute left-0 top-0 h-full w-12 z-10 bg-gradient-to-r from-card to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 h-full w-12 z-10 bg-gradient-to-l from-card to-transparent" />

      {/* Faixa rolante */}
      <div
        ref={trackRef}
        className="flex animate-ticker will-change-transform"
        style={{
          animationDuration: `${duration}s`,
        }}
      >
        {doubled.map((item, i) => (
          <TickerItem key={`${item.symbol}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

// ── Hook para buscar os maiores ativos da carteira ───────────────────────────
export function usePortfolioTicker(): TickerItem[] {
  const getDashboardFn = useServerFn(getDashboard);
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    staleTime: 30_000,
  });

  if (!data?.groups) return [];

  // Pega os top 8 ativos por saldo
  const allAssets = data.groups.flatMap((g) => g.assets);
  return allAssets
    .sort((a, b) => b.balanceBRL - a.balanceBRL)
    .slice(0, 8)
    .map((a) => ({
      symbol: a.symbol,
      price: a.currentPrice.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      change: a.variation,
      currency: a.currency,
    }));
}
