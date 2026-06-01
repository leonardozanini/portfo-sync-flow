import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { CurrencySwitcher } from "@/components/CurrencySwitcher";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ajustes — Folio" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, roles } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Preferências da sua conta.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Conta</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Email: </span>{user?.email}</div>
          <div><span className="text-muted-foreground">Papéis: </span>{roles.join(", ") || "free"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Moeda de exibição</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <CurrencySwitcher />
          <p className="text-sm text-muted-foreground">
            Altera apenas a visualização — não modifica a moeda original dos lançamentos.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
