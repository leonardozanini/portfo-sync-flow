import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Database, AlertTriangle, SlidersHorizontal } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/admin")({
  head: () => ({ meta: [{ title: "Administração — Folio" }] }),
  component: AdminHome,
});

function AdminHome() {
  const sections = [
    { icon: Users, title: "Usuários e papéis", desc: "Ver contas, atribuir Premium / Admin.", to: "/users" as const },
    { icon: Database, title: "Catálogo de ativos", desc: "Lista completa de ativos disponíveis para lançamento. Refresh automático a cada 15 min.", to: "/catalog" as const },
    { icon: AlertTriangle, title: "Falhas de cotação", desc: "Fila de ativos sem preço — defina fonte ou valor manual.", to: null },
    { icon: SlidersHorizontal, title: "Limites Free vs Premium", desc: "Configure quotas e funcionalidades por plano.", to: null },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
        <p className="text-sm text-muted-foreground">Painel do operador do sistema.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => {
          const card = (
            <Card className={s.to ? "transition hover:border-primary/50 hover:shadow-sm cursor-pointer h-full" : "h-full opacity-60"}>
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <s.icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s.desc}</CardContent>
            </Card>
          );
          return s.to
            ? <Link key={s.title} to={s.to} className="block h-full">{card}</Link>
            : <div key={s.title}>{card}</div>;
        })}
      </div>
    </div>
  );
}

