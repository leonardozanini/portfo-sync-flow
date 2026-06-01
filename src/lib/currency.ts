export type Currency = "BRL" | "USD" | "EUR" | "GBP" | "JPY";

export const CURRENCIES: { code: Currency; symbol: string; label: string }[] = [
  { code: "BRL", symbol: "R$", label: "Real" },
  { code: "USD", symbol: "$", label: "Dólar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "Libra" },
  { code: "JPY", symbol: "¥", label: "Iene" },
];

// Mock FX rates (base = BRL). Replaced later by the Forex sync job.
export const MOCK_FX: Record<Currency, number> = {
  BRL: 1,
  USD: 0.19,
  EUR: 0.17,
  GBP: 0.15,
  JPY: 28.5,
};

export function convert(amountBRL: number, target: Currency): number {
  return amountBRL * MOCK_FX[target];
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
