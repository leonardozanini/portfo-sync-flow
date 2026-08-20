import { useState } from "react";
import { Building2 } from "lucide-react";

// Busca a logo real do ativo em fontes públicas gratuitas, com fallback
// automático para o avatar de iniciais caso a imagem não carregue.
//
// Ordem de prioridade:
//   1. logoUrl customizado (ex: /logos/brla.png) — pra ativos de nicho sem
//      cobertura nas fontes automáticas (ex: stablecoins pequenas)
//   2. Fonte automática por classe (CMC/Brapi/TickerLogos/repositório público)
//   3. Fallback: ícone genérico (FIIs) ou iniciais coloridas

// TickerLogos (cdn.tickerlogos.com) funciona por DOMÍNIO, não por ticker —
// mapeamos os tickers internacionais mais comuns do catálogo do Folio.
// IMPORTANTE: esse serviço exige um link de atribuição visível no rodapé
// do app ("Logos by AllInvestView") — já incluído no AppShell.
const TICKER_DOMAIN_MAP: Record<string, string> = {
  AAPL: "apple.com", MSFT: "microsoft.com", GOOGL: "google.com", GOOG: "google.com",
  AMZN: "amazon.com", NVDA: "nvidia.com", META: "meta.com", TSLA: "tesla.com",
  "BRK.B": "berkshirehathaway.com", LLY: "lilly.com", V: "visa.com",
  JPM: "jpmorganchase.com", UNH: "unitedhealthgroup.com", MA: "mastercard.com",
  XOM: "exxonmobil.com", JNJ: "jnj.com", PG: "pg.com", HD: "homedepot.com",
  AVGO: "broadcom.com", MRK: "merck.com", CVX: "chevron.com", PEP: "pepsico.com",
  KO: "coca-colacompany.com", ABBV: "abbvie.com", COST: "costco.com",
  MCD: "mcdonalds.com", WMT: "walmart.com", CRM: "salesforce.com",
  BAC: "bankofamerica.com", NFLX: "netflix.com", AMD: "amd.com", INTC: "intel.com",
  DIS: "thewaltdisneycompany.com", ADBE: "adobe.com", PYPL: "paypal.com",
  QCOM: "qualcomm.com", TXN: "ti.com", AMGN: "amgen.com", IBM: "ibm.com",
  GE: "ge.com", CAT: "caterpillar.com", GS: "goldmansachs.com",
  MS: "morganstanley.com", UBER: "uber.com", SPOT: "spotify.com",
  SQ: "block.xyz", SHOP: "shopify.com", SNOW: "snowflake.com",
  PLTR: "palantir.com", ARM: "arm.com", NU: "nubank.com.br", MELI: "mercadolibre.com",
  MNST: "monsterbevcorp.com",
  PBR: "petrobras.com.br", VALE: "vale.com", CIG: "cemig.com.br",
  ITUB: "itau.com.br", BBD: "bradesco.com.br", ABEV: "ambev.com.br",
  SID: "csn.com.br", GGB: "gerdau.com", ERJ: "embraer.com",
  O: "realtyincome.com", AMT: "americantower.com", PLD: "prologis.com",
  EQIX: "equinix.com", SPG: "simon.com", WELL: "welltower.com",
  DLR: "digitalrealty.com", PSA: "publicstorage.com", EQR: "equityapartments.com",
  AVB: "avalonbay.com", VTR: "ventasreit.com", ARE: "are.com",
  BXP: "bxp.com", KIM: "kimcorealty.com", REG: "regencycenters.com",
  HST: "hosthotels.com", SUI: "suicommunities.com", ELS: "equitylifestyle.com",
  NNN: "nnnreit.com", STAG: "stagindustrial.com", AGNC: "agnc.com",
  MPW: "medicalpropertiestrust.com", ABNB: "airbnb.com", COIN: "coinbase.com",
  BA: "boeing.com",
};

// Lista de URLs candidatas, em ordem de prioridade — o componente tenta cada
// uma até uma carregar com sucesso, só então cai pro fallback de iniciais.
function assetLogoUrls(
  symbol: string,
  assetClass: string,
  cmcId?: number | string | null,
  logoUrl?: string | null,
): string[] {
  const sym = symbol.trim().toUpperCase();
  const urls: string[] = [];

  // Prioridade máxima: logo customizado cadastrado manualmente
  if (logoUrl) urls.push(logoUrl);

  switch (assetClass) {
    case "stock":
    case "reit":
    case "etf":
      urls.push(`https://icons.brapi.dev/icons/${sym}.svg`);
      break;
    case "crypto":
      if (cmcId) urls.push(`https://s2.coinmarketcap.com/static/img/coins/64x64/${cmcId}.png`);
      urls.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`);
      break;
    case "stock_intl":
    case "etf_intl":
    case "reit_intl": {
      const domain = TICKER_DOMAIN_MAP[sym];
      if (domain) urls.push(`https://cdn.tickerlogos.com/${domain}`);
      break;
    }
    default:
      break;
  }

  return urls;
}

export function AssetLogo({ symbol, assetClass, cmcId, logoUrl, size = 28, className = "" }: {
  symbol: string;
  assetClass: string;
  cmcId?: number | string | null;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [attemptIndex, setAttemptIndex] = useState(0);
  const urls = assetLogoUrls(symbol, assetClass, cmcId, logoUrl);
  const currentUrl = urls[attemptIndex];
  const initials = symbol.slice(0, 2).toUpperCase();

  const isReit = assetClass === "reit" || assetClass === "reit_intl";

  if (!currentUrl) {
    if (isReit) {
      return (
        <span
          className={`grid place-items-center rounded bg-primary/10 text-primary shrink-0 ${className}`}
          style={{ width: size, height: size }}
        >
          <Building2 style={{ width: size * 0.55, height: size * 0.55 }} />
        </span>
      );
    }
    return (
      <span
        className={`grid place-items-center rounded bg-foreground/10 text-[10px] font-bold shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        {initials}
      </span>
    );
  }

  return (
    <span
      className={`grid place-items-center rounded overflow-hidden bg-white shrink-0 border border-border ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={currentUrl}
        alt={symbol}
        width={size}
        height={size}
        className="object-contain w-full h-full"
        onError={() => setAttemptIndex(i => i + 1)}
        loading="lazy"
      />
    </span>
  );
}
