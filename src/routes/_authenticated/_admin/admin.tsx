import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Database, AlertTriangle, SlidersHorizontal, ShieldCheck, Star, Loader2, ArrowLeft } from "lucide-react";
import { adminListUsers, adminSetUserRole } from "@/lib/portfolio.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/admin")({
  head: () => ({ meta: [{ title: "Administração — Folio" }] }),
  component: AdminHome,
});

function AdminHome() {
  const [view, setView] = useState<"home" | "users">("home");

  if (view === "users") return <UsersPanel onBack={() => setView("home")} />;

  const sections = [
    { icon: Users, title: "Usuários e papéis", desc: "Ver contas, atribuir Premium / Admin.", action: () => setView("users") },
    { icon: Database, title: "Catálogo de ativos", desc: "Lista completa de ativos disponíveis para lançamento.", to: "/catalog" as const },
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
            <Card className={(s.to || s.action) ? "transition hover:border-primary/50 hover:shadow-sm cursor-pointer h-full" : "h-full opacity-60"}>
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <s.icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s.desc}</CardContent>
            </Card>
          );

          if (s.action) return (
            <button key={s.title} onClick={s.action} className="block h-full text-left w-full">{card}</button>
          );
          if (s.to) return (
            <Link key={s.title} to={s.to} className="block h-full">{card}</Link>
          );
          return <div key={s.title}>{card}</div>;
        })}
      </div>
    </div>
  );
}

function UsersPanel({ onBack }: { onBack: () => void }) {
  const listFn = useServerFn(adminListUsers);
  const setRoleFn = useServerFn(adminSetUserRole);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });

  const roleMutation = useMutation({
    mutationFn: setRoleFn,
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = (targetUserId: string, role: string, hasRole: boolean) => {
    roleMutation.mutate({ data: { targetUserId, role, action: hasRole ? "remove" : "add" } });
  };

  const fmt = (date: string | null) =>
    date ? new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" /> Usuários
          </h1>
          <p className="text-sm text-muted-foreground">{users.length} conta(s) registrada(s)</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => {
            const isAdmin = u.roles.includes("admin");
            const isPremium = u.roles.includes("premium");
            return (
              <Card key={u.id}>
                <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Criado em {fmt(u.createdAt)} · Último acesso {fmt(u.lastSignIn)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {isAdmin && (
                        <Badge variant="outline" className="border-primary/40 text-primary gap-1">
                          <ShieldCheck className="h-3 w-3" /> Admin
                        </Badge>
                      )}
                      {isPremium && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-600 gap-1">
                          <Star className="h-3 w-3" /> Premium
                        </Badge>
                      )}
                      {!isAdmin && !isPremium && (
                        <Badge variant="outline" className="text-muted-foreground">Free</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant={isPremium ? "destructive" : "outline"}
                      disabled={roleMutation.isPending}
                      onClick={() => toggleRole(u.id, "premium", isPremium)}>
                      {isPremium ? "Remover Premium" : "Dar Premium"}
                    </Button>
                    <Button size="sm" variant={isAdmin ? "destructive" : "outline"}
                      disabled={roleMutation.isPending}
                      onClick={() => toggleRole(u.id, "admin", isAdmin)}>
                      {isAdmin ? "Remover Admin" : "Dar Admin"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
