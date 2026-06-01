import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CURRENCIES, type Currency } from "@/lib/currency";

const Ctx = createContext<{ currency: Currency; setCurrency: (c: Currency) => void } | null>(null);

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("BRL");
  return <Ctx.Provider value={{ currency, setCurrency }}>{children}</Ctx.Provider>;
}

export function useDisplayCurrency() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDisplayCurrency must be used within DisplayCurrencyProvider");
  return v;
}

export function CurrencySwitcher() {
  const { currency, setCurrency } = useDisplayCurrency();
  return (
    <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
      <SelectTrigger className="h-9 w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            {c.symbol} {c.code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
