import { useState } from "react";
import { Building2 } from "lucide-react";

// Busca a logo real do ativo em fontes públicas gratuitas, com fallback
// automático para o avatar de iniciais caso a imagem não carregue.

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

function assetLogoUrl(symbol: string, assetClass: string): string | null {
  const sym = symbol.trim().toUpperCase();
  switch (assetClass) {
    case "stock":
    case "reit":
    case "etf":
      // Ativos B3 — ícones oficiais servidos pela Brapi (SVG)
      return `https://icons.brapi.dev/icons/${sym}.svg`;
    case "crypto":
      // Repositório público de ícones de criptomoedas
      return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`;
    case "stock_intl":
    case "etf_intl":
    case "reit_intl": {
      // TickerLogos (CDN gratuito, sem chave) — funciona por domínio
      const domain = TICKER_DOMAIN_MAP[sym];
      return domain ? `https://cdn.tickerlogos.com/${domain}` : null;
    }
    default:
      return null; // fixed_income, fund, cash, other → sem logo, usa iniciais
  }
}

export function AssetLogo({ symbol, assetClass, size = 28, className = "" }: {
  symbol: string; assetClass: string; size?: number; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = assetLogoUrl(symbol, assetClass);
  const initials = symbol.slice(0, 2).toUpperCase();

  // FIIs não têm identidade visual própria (são fundos, não empresas) — o Investidor10
  // e outras plataformas usam um ícone genérico de prédio para todos. Fazemos o mesmo.
  const isReit = assetClass === "reit" || assetClass === "reit_intl";

  if (!url || failed) {
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
        src={url}
        alt={symbol}
        width={size}
        height={size}
        className="object-contain w-full h-full"
        onError={() => setFailed(true)}
        loading="lazy"
      />
    </span>
  );
}
