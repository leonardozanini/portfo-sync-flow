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
  Sun, Moon, Target, Brain, Calculator, Droplets,
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
  { to: "/valuation", label: "Valuation", shortLabel: "Valuat.", icon: Calculator },
  { to: "/analise", label: "Análise IA", shortLabel: "IA", icon: Brain },
  { to: "/liquidez", label: "Liquidez Cripto", shortLabel: "Liquid.", icon: Droplets },
  { to: "/settings", label: "Ajustes", shortLabel: "Ajustes", icon: Settings },
] as const;

// ── Sidebar — compacta por padrão, expande ao passar o mouse (desktop) ──────
// Em mobile (Sheet) sempre renderiza expandida via prop `compact={false}`
function SidebarContent({ isAdmin, isPremium, onNavigate, safeTop = false, compact = true, expanded = false }: {
  isAdmin: boolean;
  isPremium: boolean;
  onNavigate?: () => void;
  safeTop?: boolean;
  compact?: boolean;
  expanded?: boolean;
}) {
  // "compact" controla o modo mobile/desktop; "expanded" controla se a sidebar
  // compacta está com o mouse em cima (hover) mostrando os labels
  const showLabels = !compact || expanded;

  const itemClass = (active: boolean) =>
    `group/item flex items-center rounded-xl text-sm font-medium transition-all duration-150 ${
      compact
        ? `h-11 ${expanded ? "w-full justify-start gap-3 px-3" : "w-11 justify-center"}`
        : "h-11 w-full flex-row gap-3 px-3"
    } ${
      active
        ? "bg-primary/10 text-primary"
        : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
    }`;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border py-5 gap-1.5 overflow-hidden"
      style={safeTop ? { paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" } : undefined}>
      {/* Logo: gradiente azul → roxo */}
      <div className={`flex items-center gap-2.5 mb-5 shrink-0 ${compact ? (expanded ? "px-3" : "justify-center") : "px-3"}`}>
        <div className="folio-gradient grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-sm font-bold text-white">
          F
        </div>
        {showLabels && (
          <span className="whitespace-nowrap font-semibold text-[15px] tracking-tight">Folio</span>
        )}
      </div>

      <nav className={`flex flex-1 flex-col gap-1.5 ${compact ? (expanded ? "w-full px-3" : "items-center") : "w-full px-3"}`}>
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            onClick={onNavigate}
            activeProps={{ className: "!bg-primary/10 !text-primary" }}
            className={itemClass(false)}
            title={compact && !expanded ? n.label : undefined}
          >
            <n.icon className="h-[18px] w-[18px] shrink-0" />
            {showLabels && <span className="whitespace-nowrap">{n.label}</span>}
          </Link>
        ))}
        {isAdmin && (
          <>
            <div className={compact && !expanded ? "my-1 h-px w-7 self-center bg-sidebar-border" : "my-2 h-px w-full bg-sidebar-border"} />
            <Link
              to="/admin"
              onClick={onNavigate}
              activeProps={{ className: "!bg-primary/10 !text-primary" }}
              className={itemClass(false)}
              title={compact && !expanded ? "Administração" : undefined}
            >
              <Shield className="h-[18px] w-[18px] shrink-0" />
              {showLabels && <span className="whitespace-nowrap">Administração</span>}
            </Link>
          </>
        )}
      </nav>

      {!isPremium && (
        compact && !expanded ? (
          <div className="flex h-11 w-11 items-center justify-center self-center" title="Conta gratuita — faça upgrade">
            <Sparkles className="h-[18px] w-[18px] text-primary" />
          </div>
        ) : (
          <div className="mx-3 mb-1 rounded-xl bg-sidebar-accent p-3 text-xs whitespace-nowrap overflow-hidden">
            <div className="mb-1.5 flex items-center gap-2 font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
              Conta gratuita
            </div>
            <p className="text-[11px] text-sidebar-foreground/60 whitespace-normal">
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
  const [sidebarHover, setSidebarHover] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Spacer fixo — reserva sempre 68px no fluxo do layout, mesmo com o hover */}
      <div className="hidden w-[68px] shrink-0 md:block" />

      {/* Desktop sidebar — fixa, expande sobrepondo o conteúdo ao passar o mouse */}
      <aside
        onMouseEnter={() => setSidebarHover(true)}
        onMouseLeave={() => setSidebarHover(false)}
        className={`hidden md:flex md:flex-col fixed top-0 left-0 bottom-0 z-30 transition-[width] duration-200 ease-out shadow-2xl ${
          sidebarHover ? "w-[220px]" : "w-[68px]"
        }`}
      >
        <SidebarContent isAdmin={isAdmin} isPremium={isPremium} compact expanded={sidebarHover} />
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

        {/* Atribuição obrigatória do TickerLogos (logos de ativos internacionais) */}
        <footer className="px-4 md:px-8 pb-3 text-center">
          <a
            href="https://www.allinvestview.com/tools/ticker-logos/"
            target="_blank"
            rel="noopener"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Logos by AllInvestView
          </a>
        </footer>
      </div>
    </div>
  );
}
