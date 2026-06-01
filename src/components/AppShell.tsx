import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, ArrowRightLeft, Settings, Shield, LogOut, Sparkles, Wallet,
} from "lucide-react";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { type ReactNode } from "react";

const nav = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "/transactions", label: "Lançamentos", icon: ArrowRightLeft },
  { to: "/settings", label: "Ajustes", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isAdmin, isPremium, signOut } = useAuth();
  const router = useRouter();
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-6 py-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold leading-none">Folio</div>
            <div className="text-xs text-sidebar-foreground/60">Consolidador de carteira</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              to="/admin"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
              className="mt-4 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
            >
              <Shield className="h-4 w-4" />
              Administração
            </Link>
          )}
        </nav>
        {!isPremium && (
          <div className="m-3 rounded-lg bg-sidebar-accent p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-sidebar-primary" />
              Conta gratuita
            </div>
            <p className="text-xs text-sidebar-foreground/70">
              Faça upgrade para desbloquear analytics avançado e alertas.
            </p>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-4 py-3 md:px-8">
          <div className="md:hidden">
            <Link to="/dashboard" className="font-semibold">Folio</Link>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <CurrencySwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 rounded-full p-0">
                  {initials}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm">{user?.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {isAdmin ? "Admin" : isPremium ? "Premium" : "Gratuito"}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.navigate({ to: "/settings" })}>
                  <Settings className="mr-2 h-4 w-4" /> Ajustes
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => { await signOut(); router.navigate({ to: "/login" }); }}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
