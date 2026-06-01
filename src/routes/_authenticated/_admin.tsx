import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin")({
  component: AdminGate,
});

function AdminGate() {
  const { isAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isLoading && !isAdmin) {
      toast.error("Acesso restrito a administradores.");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [isAdmin, isLoading, navigate]);
  if (!isAdmin) return null;
  return <Outlet />;
}
