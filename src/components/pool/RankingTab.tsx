import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Medal, Award, CheckCircle2, Circle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import {
  computeQualifiers,
  type TeamLite,
  type MatchLite,
  type PredLite,
} from "@/lib/group-standings";
import { ParticipantDetailsDialog } from "./ParticipantDetailsDialog";

type MatchLiteForScore = {
  id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  stage: Database["public"]["Enums"]["match_stage"];
};

type GroupPrediction = {
  user_id: string;
  points: number | null;
  home_score: number;
  away_score: number;
  match_id: string;
};

type BracketPrediction = {
  user_id: string;
  points: number | null;
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

function bracketMatchNum(stage: string, slot: number): number | null {
  if (stage === "round_of_16") return 73 + slot; // M73..M88
  if (stage === "quarter") return 89 + slot; // M89..M96
  if (stage === "semi") return 97 + slot; // M97..M100
  if (stage === "final") {
    if (slot === 0) return 101;
    if (slot === 1) return 102;
    if (slot === 2) return 104;
  }
  if (stage === "third_place" && (slot === 0 || slot === 1)) return 103;
  return null;
}

type ChampionPrediction = {
  user_id: string;
  points: number | null;
};

type Row = {
  user_id: string;
  name: string;
  avatar?: string | null;
  has_paid: boolean;
  points: number;
  exact_hits: number;
  winner_plus_score_hits: number;
  winner_only_hits: number;
  // Counts of correct bracket hits per phase.
  bracket_hits: {
    qual32: number;
    r32: number;
    r16: number;
    qf: number;
    sf: number;
    final: number;
    third: number;
  };
  champion_hit: number;
};

function classifyMatchScore(
  predH: number,
  predA: number,
  realH: number,
  realA: number,
  _stage: Database["public"]["Enums"]["match_stage"],
) {
  if (predH === realH && predA === realA) return "exact";
  const predWinner = Math.sign(predH - predA);
  const realWinner = Math.sign(realH - realA);
  if (predWinner !== realWinner) return "miss";
  if (predH === realH || predA === realA) return "winnerPlusScore";
  return "winnerOnly";
}

export function RankingTab({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  // 11/06/2026 12:00 horário de Brasília (UTC-3) = 15:00 UTC
  const RANKING_RELEASE_UTC = Date.UTC(2026, 5, 11, 15, 0, 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const rankingLocked = now < RANKING_RELEASE_UTC && !isAdmin;

  useEffect(() => {
    const ch = supabase
      .channel(`ranking-${poolId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () =>
        qc.invalidateQueries({ queryKey: ["ranking", poolId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () =>
        qc.invalidateQueries({ queryKey: ["ranking", poolId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bracket_predictions",
          filter: `pool_id=eq.${poolId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["ranking", poolId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "champion_predictions",
          filter: `pool_id=eq.${poolId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["ranking", poolId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [poolId, qc]);

  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["ranking", poolId],
    enabled: !!user,
    queryFn: async () => {
      // Members + profiles (no FK join)
      const { data: pm, error } = await supabase
        .from("pool_members")
        .select("user_id, has_paid")
        .eq("pool_id", poolId);
      if (error) throw error;
      const userIds = pm.map((m) => m.user_id);
      if (!userIds.length) return [];

      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);
      const profById = new Map(profs?.map((p) => [p.id, p]) ?? []);

      // Predictions + match results (fetch separately, no FK embed)
      const { data: preds } = await supabase
        .from("predictions")
        .select("user_id, points, home_score, away_score, match_id")
        .in("user_id", userIds);
      const matchIds = Array.from(new Set((preds ?? []).map((p) => p.match_id)));
      const { data: matchRows } = matchIds.length
        ? await supabase
            .from("matches")
            .select("id, home_score, away_score, status, stage")
            .in("id", matchIds)
        : { data: [] as MatchLiteForScore[] };
      const matchById = new Map((matchRows ?? []).map((m: MatchLiteForScore) => [m.id, m]));

      const { data: brackets } = await supabase
        .from("bracket_predictions")
        .select("user_id, points, stage, slot, team_id, home_score, away_score")
        .eq("pool_id", poolId);

      // Knockout matches (for PE/VC+PE/VCPI scoring on bracket picks), keyed by match number.
      const { data: koMatchesNumbered } = await supabase
        .from("matches")
        .select(
          "external_id, home_score, away_score, home_team_id, away_team_id, winner_team_id, status",
        )
        .not("external_id", "is", null);
      type KoMatch = {
        external_id: string | null;
        home_score: number | null;
        away_score: number | null;
        home_team_id: string | null;
        away_team_id: string | null;
        winner_team_id: string | null;
        status: string;
      };
      const matchByNum = new Map<number, KoMatch>();
      ((koMatchesNumbered ?? []) as KoMatch[]).forEach((m) => {
        const match = m.external_id ? String(m.external_id).match(/m(\d{2,3})\b/i) : null;
        const num = match ? parseInt(match[1], 10) : NaN;
        if (Number.isFinite(num)) matchByNum.set(num, m);
      });

      const { data: champs } = await supabase
        .from("champion_predictions")
        .select("user_id, points")
        .eq("pool_id", poolId);
      const { data: poolRow } = await supabase
        .from("pools")
        .select("bonus_round_of_32")
        .eq("id", poolId)
        .maybeSingle();
      const bonusR32 = poolRow?.bonus_round_of_32 ?? 20;

      const totals: Record<string, number> = {};
      const exact: Record<string, number> = {};
      const winnerPlusScore: Record<string, number> = {};
      const winnerOnly: Record<string, number> = {};
      const bracketHits: Record<string, Row["bracket_hits"]> = {};
      const champHit: Record<string, number> = {};
      const ensureBracket = (uid: string) =>
        (bracketHits[uid] ??= { qual32: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, third: 0 });

      // Build sets of teams that actually advanced to each knockout stage,
      // so we count "hits" as picks whose team is in the corresponding real-stage set
      // (regardless of slot/bracket position).
      const teamsInStage = (nums: number[]) => {
        const s = new Set<string>();
        for (const n of nums) {
          const m = matchByNum.get(n);
          if (!m) continue;
          if (m.home_team_id) s.add(m.home_team_id);
          if (m.away_team_id) s.add(m.away_team_id);
        }
        return s;
      };
      const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
      const oitavasTeams = teamsInStage(range(89, 96)); // 16 teams advancing from R32
      const quartasTeams = teamsInStage(range(97, 100)); // 8 teams advancing from oitavas
      const semisTeams = teamsInStage([101, 102]); // 4 teams advancing from quartas
      const finalTeams = teamsInStage([104]); // 2 finalists
      const thirdTeams = teamsInStage([103]); // 2 third-place participants

      // DB stage → ranking column label + which real-stage team set to check membership against.
      const STAGE_TO_KEY: Record<
        string,
        (slot: number) => { key: keyof Row["bracket_hits"]; set: Set<string> } | null
      > = {
        round_of_16: () => ({ key: "r32", set: oitavasTeams }),
        quarter: () => ({ key: "r16", set: quartasTeams }),
        semi: () => ({ key: "sf", set: semisTeams }),
        final: (slot) => (slot === 0 || slot === 1 ? { key: "final", set: finalTeams } : null),
        third_place: () => ({ key: "third", set: thirdTeams }),
      };

      (preds as GroupPrediction[] | null)?.forEach((p) => {
        totals[p.user_id] = (totals[p.user_id] || 0) + (p.points || 0);
        const m = matchById.get(p.match_id);
        if (
          m &&
          ["finished", "live"].includes(m.status) &&
          m.home_score != null &&
          m.away_score != null
        ) {
          const scoreType = classifyMatchScore(
            p.home_score,
            p.away_score,
            m.home_score,
            m.away_score,
            m.stage,
          );
          if (scoreType === "exact") exact[p.user_id] = (exact[p.user_id] || 0) + 1;
          if (scoreType === "winnerPlusScore")
            winnerPlusScore[p.user_id] = (winnerPlusScore[p.user_id] || 0) + 1;
          if (scoreType === "winnerOnly") winnerOnly[p.user_id] = (winnerOnly[p.user_id] || 0) + 1;
        }
      });
      (brackets as BracketPrediction[] | null)?.forEach((b) => {
        totals[b.user_id] = (totals[b.user_id] || 0) + (b.points || 0);
        const resolver = STAGE_TO_KEY[b.stage];
        const resolved = resolver ? resolver(b.slot as number) : null;
        if (resolved && b.team_id && resolved.set.has(b.team_id)) {
          ensureBracket(b.user_id)[resolved.key] += 1;
        }

        // PE / VC+PE / VCPI counters from bracket score predictions whose pick
        // matches the actual winner of the corresponding knockout match.
        const matchNum = bracketMatchNum(b.stage, b.slot);
        if (matchNum == null || b.team_id == null || b.home_score == null || b.away_score == null)
          return;
        const real = matchByNum.get(matchNum);
        if (!real || real.home_score == null || real.away_score == null || !real.winner_team_id)
          return;
        if (real.winner_team_id !== b.team_id) return; // wrong bracket pick
        const scoreType = classifyMatchScore(
          b.home_score,
          b.away_score,
          real.home_score,
          real.away_score,
          "round_of_16" as Database["public"]["Enums"]["match_stage"],
        );
        if (scoreType === "exact") exact[b.user_id] = (exact[b.user_id] || 0) + 1;
        else if (scoreType === "winnerPlusScore")
          winnerPlusScore[b.user_id] = (winnerPlusScore[b.user_id] || 0) + 1;
        else if (scoreType === "winnerOnly")
          winnerOnly[b.user_id] = (winnerOnly[b.user_id] || 0) + 1;
      });
      (champs as ChampionPrediction[] | null)?.forEach((c) => {
        totals[c.user_id] = (totals[c.user_id] || 0) + (c.points || 0);
        if ((c.points ?? 0) > 0) champHit[c.user_id] = 1;
      });

      // 32ª — count teams each user predicted to qualify from groups that
      // actually appear in the real Round of 32 (matches M73–M88).
      const [{ data: teamsData }, { data: phaseMatches }] = await Promise.all([
        supabase.from("teams").select("id, name, code, group_name"),
        supabase
          .from("matches")
          .select("id, stage, group_name, home_team_id, away_team_id")
          .in("stage", ["group", "round_of_32"]),
      ]);
      const teamsLite = (teamsData ?? []) as TeamLite[];
      const groupMatches = ((phaseMatches ?? []) as MatchLite[]).filter((m) => m.stage === "group");
      const groupMatchIds = new Set(groupMatches.map((m) => m.id));
      const actualR32Teams = new Set<string>();
      (phaseMatches ?? []).forEach((m) => {
        if (m.stage !== "round_of_32") return;
        if (m.home_team_id) actualR32Teams.add(m.home_team_id);
        if (m.away_team_id) actualR32Teams.add(m.away_team_id);
      });
      if (actualR32Teams.size > 0 && teamsLite.length > 0) {
        const predsByUser = new Map<string, PredLite[]>();
        (preds as GroupPrediction[] | null)?.forEach((p) => {
          if (!groupMatchIds.has(p.match_id)) return;
          const arr = predsByUser.get(p.user_id) ?? [];
          arr.push({
            match_id: p.match_id,
            home_score: p.home_score,
            away_score: p.away_score,
          });
          predsByUser.set(p.user_id, arr);
        });
        for (const uid of userIds) {
          const userPreds = predsByUser.get(uid);
          if (!userPreds || userPreds.length === 0) continue;
          const { qualified } = computeQualifiers(teamsLite, groupMatches, userPreds);
          const hits = qualified.filter((q) => actualR32Teams.has(q.team.id)).length;
          if (hits > 0) {
            ensureBracket(uid).qual32 = hits;
            // qual32 bonus is now attributed per R32 line inside bracket_predictions.points
            // (each R32 row earns bonus_round_of_32 × number of correctly qualified real teams),
            // so we do NOT add it here to avoid double-counting.
          }
        }
      }

      const rows: Row[] = pm.map((m) => {
        const p = profById.get(m.user_id);
        return {
          user_id: m.user_id,
          name: p?.display_name ?? "Anônimo",
          avatar: p?.avatar_url,
          has_paid: !!m.has_paid,
          points: totals[m.user_id] || 0,
          exact_hits: exact[m.user_id] || 0,
          winner_plus_score_hits: winnerPlusScore[m.user_id] || 0,
          winner_only_hits: winnerOnly[m.user_id] || 0,
          bracket_hits: ensureBracket(m.user_id),
          champion_hit: champHit[m.user_id] || 0,
        };
      });

      // Official tie-breakers (in order):
      // 1. exact scores  2. winner hits  3-6. round_of_16/quarter/semi/final hits  7. champion
      rows.sort(
        (a, b) =>
          b.points - a.points ||
          b.exact_hits - a.exact_hits ||
          b.winner_plus_score_hits +
            b.winner_only_hits -
            (a.winner_plus_score_hits + a.winner_only_hits) ||
          b.winner_plus_score_hits - a.winner_plus_score_hits ||
          b.winner_only_hits - a.winner_only_hits ||
          b.bracket_hits.qual32 - a.bracket_hits.qual32 ||
          b.bracket_hits.r32 - a.bracket_hits.r32 ||
          b.bracket_hits.r16 - a.bracket_hits.r16 ||
          b.bracket_hits.qf - a.bracket_hits.qf ||
          b.bracket_hits.sf - a.bracket_hits.sf ||
          b.bracket_hits.third - a.bracket_hits.third ||
          b.bracket_hits.final - a.bracket_hits.final ||
          b.champion_hit - a.champion_hit ||
          a.name.localeCompare(b.name),
      );
      return rows;
    },
  });

  if (rankingLocked)
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <Trophy className="mx-auto mb-3 h-8 w-8 text-primary" />
        <p className="text-base font-semibold">Ranking ainda não disponível</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranking será disponibilizado a partir do dia 11/06 às 12:00 (horário de Brasília).
        </p>
      </div>
    );

  if (isLoading)
    return <div className="text-center text-muted-foreground">Carregando ranking...</div>;
  if (!data?.length)
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Sem participantes ainda.
      </div>
    );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        <span>Apenas participantes com pagamento confirmado concorrem à premiação.</span>
        <span className="hidden md:inline-flex items-center gap-1">
          <Info className="h-3 w-3" /> Desempate: PE → VC+PE → VCPI → fases.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="p-3 w-12 text-center">#</th>
              <th className="p-3">Participante</th>
              <th className="p-3 text-center w-16">Pago</th>
              <th className="p-3 text-right w-20">Pontos</th>
              <th className="p-3 text-center w-12" title="Placares exatos">
                PE
              </th>
              <th className="p-3 text-center w-16" title="Vencedor + um placar exato">
                VC+PE
              </th>
              <th className="p-3 text-center w-16" title="Vencedor correto, placar incorreto">
                VCPI
              </th>
              <th
                className="p-3 text-center w-12"
                title="Times classificados para a rodada de 32 (saída da fase de grupos)"
              >
                32ª
              </th>
              <th className="p-3 text-center w-12" title="Acertos nas oitavas de final (R16)">
                Oitavas
              </th>
              <th className="p-3 text-center w-12" title="Acertos nas quartas de final">
                Quartas
              </th>
              <th className="p-3 text-center w-12" title="Times que avançam para as semifinais">
                SF
              </th>
              <th className="p-3 text-center w-12" title="Acertos disputa de 3º lugar">
                3C
              </th>
              <th
                className="p-3 text-center w-12"
                title="Acertos na final (duas equipes que avançaram das semifinais)"
              >
                F
              </th>
              <th className="p-3 text-center w-12" title="Acertou o campeão">
                C
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const isMe = row.user_id === user?.id;
              const eligibleRank = row.has_paid
                ? data.filter((r) => r.has_paid).findIndex((r) => r.user_id === row.user_id)
                : -1;
              return (
                <tr
                  key={row.user_id}
                  className={`border-b border-border last:border-0 ${isMe ? "bg-primary/5" : ""} ${!row.has_paid ? "opacity-60" : ""}`}
                >
                  <td className="p-3 text-center">
                    {row.has_paid && eligibleRank === 0 ? (
                      <Trophy className="mx-auto h-5 w-5 text-amber-400" />
                    ) : row.has_paid && eligibleRank === 1 ? (
                      <Medal className="mx-auto h-5 w-5 text-zinc-300" />
                    ) : row.has_paid && eligibleRank === 2 ? (
                      <Award className="mx-auto h-5 w-5 text-amber-600" />
                    ) : (
                      <span className="font-bold text-muted-foreground">{i + 1}</span>
                    )}
                  </td>
                  <td className="p-3 font-semibold">
                    <button
                      type="button"
                      onClick={() => setSelected({ id: row.user_id, name: row.name })}
                      className="text-left hover:text-primary hover:underline underline-offset-2 transition-colors"
                    >
                      {row.name}
                    </button>
                    {isMe && <span className="ml-1 text-xs text-primary">(você)</span>}
                  </td>
                  <td className="p-3 text-center">
                    {row.has_paid ? (
                      <CheckCircle2 className="mx-auto h-4 w-4 text-primary" />
                    ) : (
                      <Circle className="mx-auto h-4 w-4 text-muted-foreground" />
                    )}
                  </td>
                  <td className="p-3 text-right font-mono text-lg font-bold tabular-nums text-primary">
                    {row.points}
                  </td>
                  <td className="p-3 text-center tabular-nums">{row.exact_hits}</td>
                  <td className="p-3 text-center tabular-nums">{row.winner_plus_score_hits}</td>
                  <td className="p-3 text-center tabular-nums">{row.winner_only_hits}</td>
                  <td className="p-3 text-center tabular-nums">{row.bracket_hits.qual32}</td>
                  <td className="p-3 text-center tabular-nums">{row.bracket_hits.r32}</td>
                  <td className="p-3 text-center tabular-nums">{row.bracket_hits.r16}</td>
                  <td className="p-3 text-center tabular-nums">{row.bracket_hits.sf}</td>
                  <td className="p-3 text-center tabular-nums">{row.bracket_hits.third}</td>
                  <td className="p-3 text-center tabular-nums">{row.bracket_hits.final}</td>
                  <td className="p-3 text-center tabular-nums">{row.champion_hit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-muted/10 px-4 py-3 text-[11px] text-muted-foreground">
        <div className="mb-1.5 font-bold uppercase tracking-wider text-foreground/80">
          Legenda das colunas
        </div>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <span className="font-semibold text-foreground">PE</span> — Placar Exato (acertou o
            placar exato do jogo)
          </li>
          <li>
            <span className="font-semibold text-foreground">VC+PE</span> — Vencedor + 1 placar exato
            (acertou o vencedor e um dos placares)
          </li>
          <li>
            <span className="font-semibold text-foreground">VCPI</span> — Vencedor correto, placar
            incorreto (ou empate não-exato)
          </li>
          <li>
            <span className="font-semibold text-foreground">32ª</span> — Times classificados para a
            rodada de 32 (saída da fase de grupos, 20 pts cada)
          </li>
          <li>
            <span className="font-semibold text-foreground">Oitavas</span> — Acertos nas oitavas de
            final (R16)
          </li>
          <li>
            <span className="font-semibold text-foreground">Quartas</span> — Acertos nas quartas de
            final
          </li>
          <li>
            <span className="font-semibold text-foreground">SF</span> — Acertos nas semifinais
          </li>
          <li>
            <span className="font-semibold text-foreground">3C</span> — Acerto na disputa de 3º
            lugar
          </li>
          <li>
            <span className="font-semibold text-foreground">F</span> — Acertos na fase final
            (equipes que chegaram à decisão)
          </li>
          <li>
            <span className="font-semibold text-foreground">C</span> — Acertou o campeão (vencedor
            da final)
          </li>
        </ul>
      </div>
      <ParticipantDetailsDialog
        poolId={poolId}
        userId={selected?.id ?? null}
        name={selected?.name ?? ""}
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      />
    </div>
  );
}
