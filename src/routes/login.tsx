import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar — Folio" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { signInWithEmail, signInWithGoogle, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate({ to: "/dashboard", replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Entrar</CardTitle>
          <CardDescription>Acesse sua carteira consolidada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              const { error } = await signInWithEmail(email, password);
              setSubmitting(false);
              if (error) toast.error(error);
              else navigate({ to: "/dashboard", replace: true });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button className="w-full" disabled={submitting}>Entrar</Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">ou</span></div>
          </div>

          <Button variant="outline" className="w-full" onClick={async () => {
            const { error } = await signInWithGoogle();
            if (error) toast.error(error);
          }}>
            Continuar com Google
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Não tem conta? <Link to="/signup" className="font-medium text-foreground hover:underline">Criar conta</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
