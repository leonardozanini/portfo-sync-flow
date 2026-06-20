import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { supabase } from "@/integrations/supabase/client";

interface CurrencyCtx {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  defaultCurrency: Currency;
  setDefaultCurrency: (c: Currency) => Promise<void>;
}

const Ctx = createContext<CurrencyCtx | null>(null);

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [defaultCurrency, setDefaultCurrencyState] = useState<Currency>("BRL");

  // Carrega a moeda padrão do perfil ao inicializar
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any)
        .from("profiles")
        .select("base_currency")
        .eq("id", user.id)
        .single()
        .then(({ data }: { data: { base_currency: Currency } | null }) => {
          if (data?.base_currency) {
            setCurrency(data.base_currency);
            setDefaultCurrencyState(data.base_currency);
          }
        });
    });
  }, []);

  // Salva a moeda padrão no perfil do Supabase
  const setDefaultCurrency = async (c: Currency) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await (supabase as any)
      .from("profiles")
      .update({ base_currency: c })
      .eq("id", user.id);
    setDefaultCurrencyState(c);
    setCurrency(c); // também atualiza a exibição atual
  };

  return (
    <Ctx.Provider value={{ currency, setCurrency, defaultCurrency, setDefaultCurrency }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDisplayCurrency() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDisplayCurrency must be used within DisplayCurrencyProvider");
  return v;
}

// Switcher do topo — troca temporária de sessão
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
