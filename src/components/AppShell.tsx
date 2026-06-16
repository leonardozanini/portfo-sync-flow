import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetTrigger,
} from "@/components/ui/sheet";
import {
  LayoutDashboard, ArrowRightLeft, Settings, Shield, LogOut, Sparkles, Wallet, Menu, TrendingUp,
  Sun, Moon, Target,
} from "lucide-react";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { useTheme } from "@/hooks/useTheme";
import { TickerTape, usePortfolioTicker } from "./TickerTape";
import { type ReactNode, useState } from "react";

const nav = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "/transactions", label: "Lançamentos", icon: ArrowRightLeft },
  { to: "/proventos", label: "Proventos", icon: TrendingUp },
  { to: "/estrategia", label: "Estratégia", icon: Target },
  { to: "/settings", label: "Ajustes", icon: Settings },
] as const;

function SidebarContent({ isAdmin, isPremium, onNavigate, safeTop = false }: {
  isAdmin: boolean;
  isPremium: boolean;
  onNavigate?: () => void;
  safeTop?: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
      style={safeTop ? { paddingTop: "env(safe-area-inset-top)" } : undefined}>
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
            onClick={onNavigate}
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
            onClick={onNavigate}
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
    </div>
  );
}

// ── Botão de toggle de tema ──────────────────────────────────────────────────
function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground transition-colors"
    >
      {isDark ? (
        <Sun className="h-4 w-4 transition-transform duration-300 rotate-0" />
      ) : (
        <Moon className="h-4 w-4 transition-transform duration-300 rotate-0" />
      )}
    </Button>
  );
}


// ── TickerTapeWrapper — carrega os dados da carteira e passa pro ticker ──────
function TickerTapeWrapper() {
  const portfolioItems = usePortfolioTicker();
  return <TickerTape portfolioItems={portfolioItems} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isAdmin, isPremium, signOut } = useAuth();
  const router = useRouter();
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col md:flex">
        <SidebarContent isAdmin={isAdmin} isPremium={isPremium} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-4 py-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SidebarContent
                  isAdmin={isAdmin}
                  isPremium={isPremium}
                  onNavigate={() => setMobileOpen(false)}
                  safeTop={true}
                />
              </SheetContent>
            </Sheet>
            <Link to="/dashboard" className="font-semibold md:hidden">Folio</Link>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <CurrencySwitcher />

            {/* Theme toggle */}
            <ThemeToggle />

            {/* Avatar + menu */}
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

        {/* Ticker tape */}
        <TickerTapeWrapper />

        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
