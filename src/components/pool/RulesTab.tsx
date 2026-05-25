import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

type Pool = {
  scoring_exact: number;
  scoring_diff: number;
  scoring_winner: number;
  bonus_round_of_32: number;
  bonus_round_of_32_wrong: number;
  bonus_round_of_16: number;
  bonus_round_of_16_wrong: number;
  bonus_quarter: number;
  bonus_quarter_wrong: number;
  bonus_semi: number;
  bonus_semi_wrong: number;
  bonus_third_place: number;
  bonus_third_place_wrong: number;
  bonus_final: number;
  bonus_final_wrong: number;
  bonus_champion: number;
};

export function RulesTab({ pool }: { pool: Pool }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-bold uppercase tracking-tight">REGRAS</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Os participantes terão que preencher os resultados dos 104 jogos da copa.</li>
          <li>
            O participante poderá enviar o bolão e fazer o pagamento até o dia 10/6/2026 às 16:00,
            caso não aconteça, o mesmo será eliminado.
          </li>
          <li>
            Se o participante esquecer o preenchimento de algum jogo, ele não somará pontos nesse
            jogo.
          </li>
          <li>
            Após o participante preencher o resultado do jogo ele tem que clicar no botão salvar à
            sua direita na página para ser contabilizado.
          </li>
          <li>
            Após salvar todos os palpites, o participante deve usar a função{" "}
            <span className="text-foreground font-semibold">Imprimir palpites</span> para gerar uma
            cópia datada e acompanhar os resultados. Em caso de erro ou divergência no site, essa
            impressão datada deverá ser apresentada ao organizador do bolão para conferência.
          </li>
          <li>
            Caso tenha algum erro no site em algum jogo que prejudique algum participante, esse jogo
            não será contabilizado PARA TODOS os participantes.
          </li>
          <li>
            Todos participantes terão acessos a todos os bolões, mas a visualização só irá acontecer
            após o fim das inscrições.
          </li>
          <li>
            Se ocorrer algum caso inesperado no bolão, será discutido e decidido a resolução do
            caso, pela maioria dos participantes no grupo do whatsapp.
          </li>
          <li>
            Esse ano o bolão teve o custo de $60 para sua execução devido às mudanças de plataforma
            e sistema que foram pagos à empresa IA (comprovante em anexo no grupo).
          </li>
          <li>
            <span className="text-foreground font-semibold">Premiação</span> (estimativa 60 pessoas)
            <ol className="mt-1 list-decimal pl-5 space-y-0.5 text-muted-foreground">
              <li>1º R$ 5.270</li>
              <li>2º R$ 1.500</li>
              <li>3º R$ 600</li>
              <li>4º R$ 300</li>
              <li>5º R$ 130</li>
            </ol>
            <p className="mt-1 text-xs italic">
              * valores exatos somente após o fechamento das inscrições
            </p>
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-bold uppercase tracking-tight">Pontos por jogo</h3>
        <ul className="divide-y divide-border text-sm">
          <Item
            label="Placar exato"
            detail="Ex: Resultado 2 × 0 / Bolão 2 × 0"
            pts={pool.scoring_exact}
          />
          <Item
            label="Vencedor + um dos placares exato"
            detail="Ex: Resultado 2 × 0 / Bolão 2 × 1"
            pts={pool.scoring_diff}
          />
          <Item
            label="Somente vencedor ou empate não-exato"
            detail="Ex: Resultado 1 × 4 / Bolão 0 × 3"
            pts={pool.scoring_winner}
          />
        </ul>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Nas fases eliminatórias as regras de pontuação por placar só continuarão a valer SOMENTE
            para os jogos idênticos.
          </li>
          <li>
            Nas fases eliminatórias, o placar a ser contabilizado em caso de vitória para o jogo
            idêntico, será o placar do jogo + da prorrogação.
          </li>
          <li>
            Nos jogos eliminatórios onde o participante escolher decisão por pênalti, basta apenas
            escolher o vencedor que avança à próxima fase.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-bold uppercase tracking-tight">Bônus de chaveamento</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 text-left">Fase</th>
                <th className="py-2 text-right">Time/Seleção classificada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <BracketRow stage="Rodada de 32" pts={pool.bonus_round_of_32} />
              <BracketRow stage="Oitavas de final" pts={pool.bonus_round_of_16} />
              <BracketRow stage="Quartas de final" pts={pool.bonus_quarter} />
              <BracketRow stage="Semifinal" pts={pool.bonus_semi} />
              <BracketRow stage="Disputa de 3º lugar" pts={pool.bonus_third_place} />
              <BracketRow stage="Final" pts={pool.bonus_final} />
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span className="font-semibold">Acertar o campeão</span>
          <span className="font-mono font-bold text-primary">+{pool.bonus_champion} pts</span>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-bold uppercase tracking-tight">Critérios de desempate</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>Maior número de placares exatos</li>
          <li>Maior número de times vencedores</li>
          <li>Maior número de classificados para as oitavas</li>
          <li>Maior número de classificados para as quartas</li>
          <li>Maior número de classificados para a semifinal</li>
          <li>Maior número de classificados para a final</li>
          <li>Acerto do campeão</li>
        </ol>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-3 text-lg font-bold uppercase tracking-tight">
          Regras da fase de grupos (FIFA)
        </h3>
        <p className="text-sm text-muted-foreground">
          Critérios oficiais de desempate dentro de cada grupo e seleção dos 8 melhores 3º
          colocados.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/regras-fifa"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <BookOpen className="h-4 w-4" /> Ver regras de desempate FIFA
          </Link>
          <a
            href="https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <BookOpen className="h-4 w-4" /> Ver tabela de chaveamento (mata-mata)
          </a>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Palpites são bloqueados assim que a partida começa. A pontuação é calculada automaticamente
        quando o resultado oficial é registrado.
      </p>
    </div>
  );
}

function Item({ label, detail, pts }: { label: string; detail?: string; pts: number }) {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div>
        <div className="font-semibold">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      <span className="font-mono font-bold text-primary whitespace-nowrap">+{pts} pts</span>
    </li>
  );
}

function BracketRow({ stage, pts }: { stage: string; pts: number }) {
  return (
    <tr>
      <td className="py-2.5 font-semibold">{stage}</td>
      <td className="py-2.5 text-right font-mono font-bold text-primary">+{pts}</td>
    </tr>
  );
}
