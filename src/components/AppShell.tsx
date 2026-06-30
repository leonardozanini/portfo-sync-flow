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
  Sun, Moon, Target, Brain,
} from "lucide-react";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { useTheme } from "@/hooks/useTheme";
import { TickerTape, usePortfolioTicker } from "./TickerTape";
import { type ReactNode, useState } from "react";

const nav = [
  { to: "/dashboard", label: "Visão geral", shortLabel: "Resumo", icon: LayoutDashboard },
  { to: "/transactions", label: "Lançamentos", shortLabel: "Lança.", icon: ArrowRightLeft },
  { to: "/proventos", label: "Proventos", shortLabel: "Provent.", icon: TrendingUp },
  { to: "/estrategia", label: "Estratégia", shortLabel: "Estrat.", icon: Target },
  { to: "/analise", label: "Análise IA", shortLabel: "IA", icon: Brain },
  { to: "/settings", label: "Ajustes", shortLabel: "Ajustes", icon: Settings },
] as const;

// ── Sidebar compacta — só ícones + label minúsculo, estilo Folio tech ───────
function SidebarContent({ isAdmin, isPremium, onNavigate, safeTop = false, compact = true }: {
  isAdmin: boolean;
  isPremium: boolean;
  onNavigate?: () => void;
  safeTop?: boolean;
  compact?: boolean;
}) {
  const itemClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-medium uppercase tracking-wide transition-colors ${
      compact ? "h-11 w-11" : "h-11 w-full flex-row gap-3 px-3 text-sm normal-case tracking-normal"
    } ${
      active
        ? "bg-primary/10 text-primary"
        : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
    }`;

  return (
    <div className="flex h-full flex-col items-center bg-sidebar text-sidebar-foreground border-r border-sidebar-border py-5 gap-1.5"
      style={safeTop ? { paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" } : undefined}>
      {/* Logo: gradiente azul → roxo */}
      <div className="folio-gradient mb-5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-sm font-bold text-white">
        F
      </div>

      <nav className={`flex flex-1 flex-col gap-1.5 ${compact ? "" : "w-full px-3"}`}>
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            onClick={onNavigate}
            activeProps={{ className: "!bg-primary/10 !text-primary" }}
            className={itemClass(false)}
          >
            <n.icon className="h-[18px] w-[18px]" />
            {compact ? n.shortLabel ?? n.label : n.label}
          </Link>
        ))}
        {isAdmin && (
          <>
            <div className={compact ? "my-1 h-px w-7 bg-sidebar-border" : "my-2 h-px w-full bg-sidebar-border"} />
            <Link
              to="/admin"
              onClick={onNavigate}
              activeProps={{ className: "!bg-primary/10 !text-primary" }}
              className={itemClass(false)}
            >
              <Shield className="h-[18px] w-[18px]" />
              {compact ? "Admin" : "Administração"}
            </Link>
          </>
        )}
      </nav>

      {!isPremium && (
        compact ? (
          <div className="flex h-11 w-11 items-center justify-center" title="Conta gratuita — faça upgrade">
            <Sparkles className="h-[18px] w-[18px] text-primary" />
          </div>
        ) : (
          <div className="mx-3 mb-1 rounded-xl bg-sidebar-accent p-3 text-xs">
            <div className="mb-1.5 flex items-center gap-2 font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Conta gratuita
            </div>
            <p className="text-[11px] text-sidebar-foreground/60">
              Upgrade para desbloquear analytics avançado.
            </p>
          </div>
        )
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
      {/* Desktop sidebar — compacta, só ícones (estilo Folio tech) */}
      <aside className="hidden w-[68px] shrink-0 flex-col md:flex">
        <SidebarContent isAdmin={isAdmin} isPremium={isPremium} compact />
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
                  compact={false}
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
                <Button variant="outline" size="sm" className="folio-gradient h-9 w-9 rounded-full p-0 border-0 text-white font-semibold">{initials}</Button>
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
