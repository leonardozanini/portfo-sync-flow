export type Currency = "BRL" | "USD" | "EUR" | "GBP" | "JPY";

export const CURRENCIES: { code: Currency; symbol: string; label: string }[] = [
  { code: "BRL", symbol: "R$", label: "Real" },
  { code: "USD", symbol: "$", label: "Dólar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "Libra" },
  { code: "JPY", symbol: "¥", label: "Iene" },
];

// Taxas de fallback (base = BRL) — usadas só enquanto a cotação real ainda não
// carregou (ex: primeiríssimo render da página) ou se por algum motivo a busca
// falhar. NÃO são as taxas "de verdade": o valor real vem de setLiveFxRates(),
// chamado uma vez ao carregar o app com o dado mais recente salvo pelo cron
// sync-fx (tabela fx_rates, atualizada diariamente via AwesomeAPI).
const FALLBACK_FX: Record<Currency, number> = {
  BRL: 1,
  USD: 0.19,
  EUR: 0.17,
  GBP: 0.15,
  JPY: 28.5,
};

// Cache em memória das taxas reais, populado uma vez por sessão (ver
// setLiveFxRates). Enquanto não for chamado, convert() usa o fallback acima.
let liveFxRates: Record<Currency, number> | null = null;

/**
 * Define as taxas de câmbio reais (base = BRL) a serem usadas por convert()
 * daqui em diante. Chamado uma vez, ao carregar o app, com o dado mais
 * recente da tabela fx_rates (ver getFxRates em portfolio.functions.ts).
 */
export function setLiveFxRates(rates: Partial<Record<Currency, number>>) {
  liveFxRates = { ...FALLBACK_FX, ...liveFxRates, ...rates };
}

/** Verdadeiro assim que taxas reais (não-fallback) foram carregadas. */
export function hasLiveFxRates(): boolean {
  return liveFxRates !== null;
}

function currentFxRates(): Record<Currency, number> {
  return liveFxRates ?? FALLBACK_FX;
}

/**
 * Converte um valor de uma moeda para outra.
 * - Se `from` não for informado, assume BRL (comportamento legado).
 * - Converte from → BRL → target usando a cotação mais recente disponível
 *   (real, se já carregada nesta sessão; senão, fallback conservador).
 */
export function convert(amount: number, target: Currency, from: Currency = "BRL"): number {
  if (from === target) return amount;
  const fx = currentFxRates();
  // Converte para BRL primeiro, depois para target
  const amountBRL = from === "BRL" ? amount : amount / fx[from];
  return amountBRL * fx[target];
}

export function formatMoney(amount: number, currency: Currency): string {
  const locales: Record<Currency, string> = {
    BRL: "pt-BR",
    USD: "en-US",
    EUR: "de-DE",
    GBP: "en-GB",
    JPY: "ja-JP",
  };
  return new Intl.NumberFormat(locales[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(amount);
}

const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

/**
 * Formata preços cripto muito pequenos em notação compacta, por exemplo:
 * $0.0₄1196 representa $0.00001196. Valores maiores mantêm a formatação usual.
 */
export function formatCryptoPrice(amount: number, currency: Currency): string {
  const regularFormat = formatMoney(amount, currency);
  const abs = Math.abs(amount);
  if (!Number.isFinite(amount) || abs === 0 || abs >= 0.01) return regularFormat;

  let exponent = Math.floor(Math.log10(abs));
  let significant = abs / 10 ** exponent;
  let zeroCount = -exponent - 1;

  significant = Number(significant.toPrecision(4));
  if (significant >= 10) {
    significant /= 10;
    zeroCount -= 1;
  }

  const digits = significant.toFixed(3).replace(".", "");
  const count = String(Math.max(0, zeroCount))
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)])
    .join("");

  const locale = currency === "BRL" ? "pt-BR"
    : currency === "USD" ? "en-US"
    : currency === "EUR" ? "de-DE"
    : currency === "GBP" ? "en-GB"
    : "ja-JP";
  const currencyParts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(amount);
  const numericIndexes = currencyParts
    .map((part, index) => (part.type === "integer" || part.type === "fraction" ? index : -1))
    .filter((index) => index >= 0);
  const firstNumeric = numericIndexes[0];
  const lastNumeric = numericIndexes[numericIndexes.length - 1];
  const prefix = currencyParts.slice(0, firstNumeric).map((part) => part.value).join("");
  const suffix = currencyParts.slice(lastNumeric + 1).map((part) => part.value).join("");
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";

  return `${prefix}0${decimal}0${count}${digits}${suffix}`;
}
