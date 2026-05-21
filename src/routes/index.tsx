import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Trophy, Target, Users, BarChart3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-24">
        {/* Hero */}
        <section className="pt-20 pb-24 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Copa do Mundo 2026
          </div>
          <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">
            O bolão da galera
            <br />
            <span className="text-primary">decide aqui.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Crie seu bolão, palpite o placar de cada jogo, monte o chaveamento e mostre quem entende
            mesmo de futebol.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            {user ? (
              <Link to="/dashboard">
                <Button size="lg" className="font-bold uppercase tracking-wide">
                  Ir para meus bolões
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/auth">
                  <Button size="lg" className="font-bold uppercase tracking-wide">
                    Criar conta grátis
                  </Button>
                </Link>
                <Link to="/auth">
                  <Button size="lg" variant="outline" className="font-bold uppercase tracking-wide">
                    Entrar
                  </Button>
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Features */}
        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Target,
              title: "Palpites por jogo",
              desc: "Cravar o placar exato vale mais. Acertar só o vencedor já pontua.",
            },
            {
              icon: Trophy,
              title: "Chaveamento e campeão",
              desc: "Monte o mata-mata da sua cabeça e palpite quem leva a taça.",
            },
            {
              icon: Users,
              title: "Bolão privado",
              desc: "Crie um grupo, mande o código de convite pros amigos e jogue junto.",
            },
            {
              icon: BarChart3,
              title: "Ranking ao vivo",
              desc: "Pontuação atualiza assim que o jogo termina. Sem briga, sem planilha.",
            },
            {
              icon: Sparkles,
              title: "Dados oficiais",
              desc: "Resultados sincronizados de uma fonte confiável de dados de futebol.",
            },
            {
              icon: Trophy,
              title: "Bônus por fase",
              desc: "Acertar quem chega em quartas, semis e final dá pontos extras.",
            },
          ].map((f, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-6 transition hover:border-primary/40"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
