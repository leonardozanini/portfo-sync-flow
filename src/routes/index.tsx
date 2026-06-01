import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, BarChart3, Globe2, ShieldCheck, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Folio — Consolide sua carteira multi-moeda" },
      { name: "description", content: "Acompanhe ações, REITs, cripto e câmbio em uma única visão, em qualquer moeda." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="text-lg font-semibold tracking-tight">Folio</div>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost"><Link to="/login">Entrar</Link></Button>
          <Button asChild><Link to="/signup">Criar conta</Link></Button>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            <Zap className="h-3.5 w-3.5 text-accent" /> Em tempo real · Multi-moeda
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-6xl">
            Sua carteira de investimentos,
            <span className="text-accent"> consolidada</span>.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Ações, REITs, ETFs, cripto e renda fixa em qualquer moeda — converta com um clique, sem perder o registro original do lançamento.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg">
              <Link to="/signup">
                Começar grátis <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline"><Link to="/login">Já tenho conta</Link></Button>
          </div>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            { icon: Globe2, title: "Multi-moeda nativo", desc: "BRL, USD, EUR e mais. Alterne a moeda de exibição em qualquer tela." },
            { icon: BarChart3, title: "Evolução real", desc: "Patrimônio, alocação por classe e lucro/prejuízo com formatação condicional." },
            { icon: ShieldCheck, title: "Seus dados, seguros", desc: "Row-level security garante que só você vê seus lançamentos." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="h-6 w-6 text-accent" />
              <div className="mt-4 font-semibold">{f.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Folio
      </footer>
    </div>
  );
}
