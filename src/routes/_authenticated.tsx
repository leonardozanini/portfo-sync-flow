import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { DisplayCurrencyProvider } from "@/components/CurrencySwitcher";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate({ to: "/login", replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <DisplayCurrencyProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </DisplayCurrencyProvider>
  );
}
