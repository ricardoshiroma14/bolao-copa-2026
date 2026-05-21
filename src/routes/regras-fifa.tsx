import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, BookOpen } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/regras-fifa")({
  component: RegrasFifaPage,
  head: () => ({
    meta: [
      { title: "Regras de desempate FIFA — Copa do Mundo 2026" },
      {
        name: "description",
        content:
          "Critérios oficiais de desempate da fase de grupos da Copa do Mundo FIFA 2026 e seleção dos 8 melhores terceiros colocados.",
      },
    ],
  }),
});

const FIFA_URL =
  "https://www.fifa.com/pt/tournaments/mens/worldcup/canadamexicousa2026/articles/copa-mundo-grupos-regulamento-classificacao-desempate";

function RegrasFifaPage() {
  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          to="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>

        <div className="mb-6 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-primary">
            <BookOpen className="h-5 w-5" />
            <div className="text-xs font-semibold uppercase tracking-wider">Regulamento FIFA</div>
          </div>
          <h1 className="mt-1 text-3xl font-black uppercase tracking-tight">Regras de desempate</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Critérios oficiais aplicados na fase de grupos da Copa do Mundo 2026 e na seleção dos 8
            melhores terceiros colocados que avançam para as oitavas.
          </p>
          <a href={FIFA_URL} target="_blank" rel="noreferrer" className="mt-4 inline-block">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Ver regulamento oficial no site da FIFA
            </Button>
          </a>
        </div>

        <section className="mb-6 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold uppercase tracking-tight">
            Empate dentro de um grupo
          </h2>
          <p className="text-sm text-muted-foreground">
            Se duas ou mais seleções terminarem a fase de grupos com o mesmo número de pontos, os
            critérios abaixo são aplicados <strong>na ordem</strong> para definir a classificação.
          </p>

          <div className="mt-5 space-y-5 text-sm">
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-primary">
                Etapa 1 — Confronto direto
              </div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Maior número de pontos entre as seleções empatadas</li>
                <li>Melhor saldo de gols entre as seleções empatadas</li>
                <li>Maior número de gols marcados entre as seleções empatadas</li>
              </ol>
            </div>

            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-primary">
                Etapa 2 — Toda a fase de grupos
              </div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Melhor saldo de gols em todos os jogos do grupo</li>
                <li>Maior número de gols marcados em todos os jogos do grupo</li>
                <li>
                  Melhor índice de fair play (cartões amarelos e vermelhos da equipe e comissão)
                </li>
              </ol>
            </div>

            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-primary">
                Etapa 3 — Ranking FIFA
              </div>
              <p>
                Se ainda assim persistir o empate, vale a posição mais recente no FIFA/Coca-Cola
                Men's World Ranking.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold uppercase tracking-tight">
            8 melhores terceiros colocados
          </h2>
          <p className="text-sm text-muted-foreground">
            Os 8 melhores entre as seleções que terminarem em terceiro lugar avançam para as oitavas
            de final. A ordem é definida assim:
          </p>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
            <li>Maior número de pontos em todos os jogos do grupo</li>
            <li>Melhor saldo de gols em todos os jogos do grupo</li>
            <li>Maior número de gols marcados em todos os jogos do grupo</li>
            <li>Melhor índice de fair play da equipe e comissão</li>
            <li>Posição mais recente no FIFA/Coca-Cola Men's World Ranking</li>
          </ol>
        </section>

        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-muted-foreground">
          <strong className="text-foreground">Nota sobre o bolão:</strong> a classificação simulada
          aplica automaticamente as etapas 1 e 2. Os critérios de fair play e ranking FIFA não são
          modelados — quando o empate persistir, a ordem alfabética é usada apenas como fallback
          neutro para previsões.
        </section>
      </main>
    </div>
  );
}
