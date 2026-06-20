import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, Loader2, Globe } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDisplayCurrency } from "@/components/CurrencySwitcher";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ajustes — Folio" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, roles } = useAuth();
  const { defaultCurrency, setDefaultCurrency, setCurrency } = useDisplayCurrency();

  const [selected, setSelected] = useState<Currency>(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = selected !== defaultCurrency;

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDefaultCurrency(selected);
      setSaved(true);
      toast.success("Moeda padrão atualizada!");
      setTimeout(() => setSaved(false), 2500);
    } catch {
      toast.error("Erro ao salvar preferência.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Preferências da sua conta.</p>
      </div>

      {/* Conta */}
      <Card>
        <CardHeader>
          <CardTitle>Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Email: </span>{user?.email}</div>
          <div><span className="text-muted-foreground">Papéis: </span>{roles.join(", ") || "free"}</div>
        </CardContent>
      </Card>

      {/* Moeda padrão */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Moeda padrão da carteira
          </CardTitle>
          <CardDescription>
            A moeda que aparece selecionada por padrão ao abrir o Folio. Você pode trocar temporariamente
            a qualquer momento pelo seletor no topo da tela.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={selected} onValueChange={(v) => { setSelected(v as Currency); setSaved(false); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="font-mono font-semibold mr-1">{c.symbol}</span> {c.code}
                    {c.code === defaultCurrency && (
                      <span className="ml-2 text-xs text-muted-foreground">(atual)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={handleSave}
              disabled={!isDirty || saving}
              size="sm"
              variant={saved ? "outline" : "default"}
            >
              {saving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</>
              ) : saved ? (
                <><Check className="mr-2 h-4 w-4 text-emerald-500" /> Salvo!</>
              ) : (
                "Salvar preferência"
              )}
            </Button>
          </div>

          {isDirty && !saving && (
            <p className="mt-3 text-xs text-muted-foreground">
              Ao salvar, o Folio sempre abrirá exibindo os valores em{" "}
              <span className="font-semibold text-foreground">{selected}</span>.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
