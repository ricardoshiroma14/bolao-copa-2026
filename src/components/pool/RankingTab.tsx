import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Medal, Award, CheckCircle2, Circle, Info, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useEffectiveAdmin } from "@/lib/admin-view";
import {
  BRACKET_SOURCE_MATCHES,
  bracketMatchNum,
  calculateRankingPoints,
  classifyPredictionScore,
  classifyScore,
  isMatchScorable,
  normalizeScoring,
  pickStorageFor,
  isCanonicalBracketStageSlot,
  scoreInputForIdenticalMatch,
  type MatchScoring,
} from "@/lib/scoring";
import {
  computeQualifiers,
  type TeamLite,
  type MatchLite,
  type PredLite,
} from "@/lib/group-standings";
import { normalizeTeamsForDisplay } from "@/lib/team-names";
import { R32, type SlotSpec } from "@/lib/wc2026-bracket";
import { matchNumberFromRealMatch } from "@/lib/bracket-match-number";
import { lookupThirdsAssignment } from "@/lib/wc2026-thirds-combinations";
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
  home_score: number;
  away_score: number;
  match_id: string;
};

type BracketPrediction = {
  user_id: string;
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

function isRoundOf32ReleaseColumnMissing(error: { message?: string } | null): boolean {
  return error?.message?.includes("round_of_32_points_enabled") ?? false;
}

function resolveR32Slot(
  spec: SlotSpec,
  qualifiers: ReturnType<typeof computeQualifiers>,
  matchNum: number,
): string | null {
  if (spec.kind === "winner") return qualifiers.byGroup[spec.group]?.[0]?.team.id ?? null;
  if (spec.kind === "runnerUp") return qualifiers.byGroup[spec.group]?.[1]?.team.id ?? null;
  if (spec.kind !== "third") return null;

  const thirdGroups = qualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
  const assignment = lookupThirdsAssignment(thirdGroups);
  const group = assignment?.[matchNum];
  return group ? (qualifiers.byGroup[group]?.[2]?.team.id ?? null) : null;
}

type ChampionPrediction = {
  user_id: string;
  team_id: string | null;
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
    sf: number;
    final: number;
    third: number;
  };
  champion_hit: number;
};

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
  const effectiveIsAdmin = useEffectiveAdmin(isAdmin);
  const rankingLocked = now < RANKING_RELEASE_UTC && !effectiveIsAdmin;

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
      const scoringColumns =
        "scoring_exact, scoring_diff, scoring_winner, bonus_round_of_32, bonus_round_of_32_wrong, bonus_round_of_16, bonus_quarter, bonus_semi, bonus_third_place, bonus_final, bonus_champion";
      const { data: poolScoring, error: poolError } = await supabase
        .from("pools")
        .select(`${scoringColumns}, round_of_32_points_enabled`)
        .eq("id", poolId)
        .maybeSingle();
      if (poolError && !isRoundOf32ReleaseColumnMissing(poolError)) throw poolError;
      const fallbackScoring =
        poolError && isRoundOf32ReleaseColumnMissing(poolError)
          ? await supabase.from("pools").select(scoringColumns).eq("id", poolId).maybeSingle()
          : null;
      if (fallbackScoring?.error) throw fallbackScoring.error;
      const scoring = normalizeScoring(fallbackScoring?.data ?? poolScoring);

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
        .select("user_id, home_score, away_score, match_id")
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
        .select("user_id, stage, slot, team_id, home_score, away_score")
        .eq("pool_id", poolId);

      const { data: teamsData } = await supabase.from("teams").select("id, name, code, group_name");
      const teamsLite = normalizeTeamsForDisplay((teamsData ?? []) as TeamLite[]);

      // Matches for bracket score checks and group-derived qualifiers.
      const { data: koMatchesNumbered } = await supabase
        .from("matches")
        .select(
          "id, external_id, stage, group_name, kickoff_at, home_score, away_score, home_team_id, away_team_id, winner_team_id, status",
        );
      type KoMatch = {
        id: string;
        external_id: string | null;
        stage: string;
        group_name: string | null;
        kickoff_at: string;
        home_score: number | null;
        away_score: number | null;
        home_team_id: string | null;
        away_team_id: string | null;
        winner_team_id: string | null;
        status: string;
      };
      const matchByNum = new Map<number, KoMatch>();
      ((koMatchesNumbered ?? []) as KoMatch[]).forEach((m) => {
        const matchNum = matchNumberFromRealMatch(m);
        if (matchNum) matchByNum.set(matchNum, m);
      });

      const { data: champs } = await supabase
        .from("champion_predictions")
        .select("user_id, team_id")
        .eq("pool_id", poolId);
      const groupMatches = ((koMatchesNumbered ?? []) as MatchLite[]).filter(
        (m) => m.stage === "group",
      );
      const groupMatchIds = new Set(groupMatches.map((m) => m.id));
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

      const exact: Record<string, number> = {};
      const winnerPlusScore: Record<string, number> = {};
      const winnerOnly: Record<string, number> = {};
      const bracketHits: Record<string, Row["bracket_hits"]> = {};
      const champHit: Record<string, number> = {};
      const ensureBracket = (uid: string) =>
        (bracketHits[uid] ??= { qual32: 0, r32: 0, r16: 0, sf: 0, final: 0, third: 0 });

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
      const picksByUser = new Map<string, Map<string, string | null>>();
      (brackets as BracketPrediction[] | null)?.forEach((b) => {
        const userPicks = picksByUser.get(b.user_id) ?? new Map<string, string | null>();
        userPicks.set(`${b.stage}-${b.slot}`, b.team_id);
        picksByUser.set(b.user_id, userPicks);
      });
      const qualifiersByUser = new Map<string, ReturnType<typeof computeQualifiers>>();
      const userQualifiers = (uid: string) => {
        let result = qualifiersByUser.get(uid);
        if (result) return result;
        result = computeQualifiers(teamsLite, groupMatches, predsByUser.get(uid) ?? []);
        qualifiersByUser.set(uid, result);
        return result;
      };
      const userPickForMatch = (uid: string, matchNum: number): string | null => {
        const storage = pickStorageFor(matchNum);
        if (!storage) return null;
        return picksByUser.get(uid)?.get(`${storage.stage}-${storage.slot}`) ?? null;
      };
      const predictedLoser = (
        participants: [string | null, string | null] | null,
        winnerId: string | null,
      ): string | null => {
        if (!participants || !winnerId) return null;
        const [home, away] = participants;
        if (winnerId === home) return away;
        if (winnerId === away) return home;
        return null;
      };
      const predictedParticipantsForMatch = (
        uid: string,
        matchNum: number,
      ): [string | null, string | null] | null => {
        if (matchNum >= 73 && matchNum <= 88) {
          const spec = R32.find((row) => row.match === matchNum);
          if (!spec) return null;
          const qualifiers = userQualifiers(uid);
          return [
            resolveR32Slot(spec.a, qualifiers, matchNum),
            resolveR32Slot(spec.b, qualifiers, matchNum),
          ];
        }
        if (matchNum === 103) {
          const semi101 = predictedParticipantsForMatch(uid, 101);
          const semi102 = predictedParticipantsForMatch(uid, 102);
          return [
            predictedLoser(semi101, userPickForMatch(uid, 101)),
            predictedLoser(semi102, userPickForMatch(uid, 102)),
          ];
        }
        const srcs = BRACKET_SOURCE_MATCHES[matchNum];
        return srcs ? [userPickForMatch(uid, srcs[0]), userPickForMatch(uid, srcs[1])] : null;
      };

      (preds as GroupPrediction[] | null)?.forEach((p) => {
        const m = matchById.get(p.match_id);
        if (!m) return;
        const scoreType = classifyPredictionScore(p, m);
        if (scoreType === "exact") exact[p.user_id] = (exact[p.user_id] || 0) + 1;
        if (scoreType === "winnerPlusScore")
          winnerPlusScore[p.user_id] = (winnerPlusScore[p.user_id] || 0) + 1;
        if (scoreType === "winnerOnly") winnerOnly[p.user_id] = (winnerOnly[p.user_id] || 0) + 1;
      });
      (brackets as BracketPrediction[] | null)?.forEach((b) => {
        if (!isCanonicalBracketStageSlot(b.stage, b.slot)) return;
        const resolver = STAGE_TO_KEY[b.stage];
        const resolved = resolver ? resolver(b.slot as number) : null;
        if (resolved && b.team_id && resolved.set.has(b.team_id)) {
          ensureBracket(b.user_id)[resolved.key] += 1;
        }

        // PE / VC+PE / VCPI counters from bracket score predictions only count
        // when the user's predicted matchup is identical to the official matchup.
        const matchNum = bracketMatchNum(b.stage, b.slot);
        if (matchNum == null || b.team_id == null || b.home_score == null || b.away_score == null)
          return;
        if (matchNum >= 73 && matchNum <= 88 && !scoring.round_of_32_points_enabled) return;
        const real = matchByNum.get(matchNum);
        if (!real || !isMatchScorable(real) || !real.winner_team_id) return;
        if (real.winner_team_id !== b.team_id) return; // wrong bracket pick
        const scoreInput = scoreInputForIdenticalMatch(
          b,
          real,
          predictedParticipantsForMatch(b.user_id, matchNum),
        );
        if (!scoreInput) return;
        const scoreType = classifyScore(
          scoreInput.home_score,
          scoreInput.away_score,
          real.home_score,
          real.away_score,
        );
        if (scoreType === "exact") exact[b.user_id] = (exact[b.user_id] || 0) + 1;
        else if (scoreType === "winnerPlusScore")
          winnerPlusScore[b.user_id] = (winnerPlusScore[b.user_id] || 0) + 1;
        else if (scoreType === "winnerOnly")
          winnerOnly[b.user_id] = (winnerOnly[b.user_id] || 0) + 1;
      });
      const finalMatch = matchByNum.get(104);
      const officialChampionId =
        finalMatch &&
        finalMatch.status === "finished" &&
        finalMatch.home_score != null &&
        finalMatch.away_score != null
          ? finalMatch.home_score === finalMatch.away_score
            ? finalMatch.winner_team_id
            : finalMatch.home_score > finalMatch.away_score
              ? finalMatch.home_team_id
              : finalMatch.away_team_id
          : null;
      (champs as ChampionPrediction[] | null)?.forEach((c) => {
        if (officialChampionId && c.team_id === officialChampionId) champHit[c.user_id] = 1;
      });

      // 32ª — count teams each user predicted to qualify from groups that
      // actually appear in the real Round of 32 (matches M73–M88).
      const actualR32Teams = new Set<string>();
      (koMatchesNumbered ?? []).forEach((m) => {
        if (m.stage !== "round_of_32") return;
        if (m.home_team_id) actualR32Teams.add(m.home_team_id);
        if (m.away_team_id) actualR32Teams.add(m.away_team_id);
      });
      if (scoring.round_of_32_points_enabled && actualR32Teams.size > 0 && teamsLite.length > 0) {
        for (const uid of userIds) {
          const userPreds = predsByUser.get(uid);
          if (!userPreds || userPreds.length === 0) continue;
          const { qualified } = userQualifiers(uid);
          const hits = qualified.filter((q) => actualR32Teams.has(q.team.id)).length;
          if (hits > 0) {
            ensureBracket(uid).qual32 = hits;
            // Points are applied from this counter only when the release toggle is on.
          }
        }
      }

      const rows: Row[] = pm.map((m) => {
        const p = profById.get(m.user_id);
        const exactHits = exact[m.user_id] || 0;
        const winnerPlusScoreHits = winnerPlusScore[m.user_id] || 0;
        const winnerOnlyHits = winnerOnly[m.user_id] || 0;
        const bracket = ensureBracket(m.user_id);
        const champion = champHit[m.user_id] || 0;
        return {
          user_id: m.user_id,
          name: p?.display_name ?? "Anônimo",
          avatar: p?.avatar_url,
          has_paid: !!m.has_paid,
          points: calculateRankingPoints(
            {
              exact: exactHits,
              winnerPlusScore: winnerPlusScoreHits,
              winnerOnly: winnerOnlyHits,
              qual32: bracket.qual32,
              r32: bracket.r32,
              r16: bracket.r16,
              sf: bracket.sf,
              final: bracket.final,
              third: bracket.third,
              champion: champion,
            },
            scoring,
          ),
          exact_hits: exactHits,
          winner_plus_score_hits: winnerPlusScoreHits,
          winner_only_hits: winnerOnlyHits,
          bracket_hits: bracket,
          champion_hit: champion,
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
    <div>
      {effectiveIsAdmin && (
        <style>{`
          @media print {
            @page {
              size: landscape;
              margin: 10mm;
            }
            body * {
              visibility: hidden;
            }
            .ranking-print {
              visibility: visible;
              display: block !important;
              position: absolute;
              inset: 0;
              background: white;
              color: black;
            }
            .ranking-print * {
              visibility: visible;
              color: black !important;
            }
            .ranking-screen {
              display: none !important;
            }
            .ranking-print table,
            .ranking-print th,
            .ranking-print td {
              border-color: #000 !important;
            }
          }
        `}</style>
      )}

      <div className="ranking-print hidden">
        <h2 className="mb-2 text-base font-black uppercase tracking-wide">Ranking do Bolão</h2>
        <p className="mb-3 text-xs">
          Apenas participantes com pagamento confirmado concorrem à premiação.
        </p>
        <table className="w-full border-collapse border border-border text-[10px]">
          <thead>
            <tr className="border-b border-border">
              <th className="border-r border-border px-1.5 py-1 text-center">#</th>
              <th className="border-r border-border px-1.5 py-1 text-left">Participante</th>
              <th className="border-r border-border px-1.5 py-1 text-center">Pago</th>
              <th className="border-r border-border px-1.5 py-1 text-right">Pontos</th>
              <th className="border-r border-border px-1.5 py-1 text-center">PE</th>
              <th className="border-r border-border px-1.5 py-1 text-center">VC+PE</th>
              <th className="border-r border-border px-1.5 py-1 text-center">VCPI</th>
              <th className="border-r border-border px-1.5 py-1 text-center">32ª</th>
              <th className="border-r border-border px-1.5 py-1 text-center">Oitavas</th>
              <th className="border-r border-border px-1.5 py-1 text-center">Quartas</th>
              <th className="border-r border-border px-1.5 py-1 text-center">SF</th>
              <th className="border-r border-border px-1.5 py-1 text-center">3C</th>
              <th className="border-r border-border px-1.5 py-1 text-center">F</th>
              <th className="px-1.5 py-1 text-center">C</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.user_id} className="border-b border-border">
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {i + 1}
                </td>
                <td className="border-r border-border px-1.5 py-1 font-semibold">{row.name}</td>
                <td className="border-r border-border px-1.5 py-1 text-center">
                  {row.has_paid ? "Sim" : "Não"}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-right font-bold tabular-nums">
                  {row.points}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.exact_hits}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.winner_plus_score_hits}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.winner_only_hits}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.bracket_hits.qual32}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.bracket_hits.r32}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.bracket_hits.r16}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.bracket_hits.sf}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.bracket_hits.third}
                </td>
                <td className="border-r border-border px-1.5 py-1 text-center tabular-nums">
                  {row.bracket_hits.final}
                </td>
                <td className="px-1.5 py-1 text-center tabular-nums">{row.champion_hit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ranking-screen overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>Apenas participantes com pagamento confirmado concorrem à premiação.</span>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <span className="hidden md:inline-flex items-center gap-1">
              <Info className="h-3 w-3" /> Desempate: PE → VC+PE → VCPI → fases.
            </span>
            {effectiveIsAdmin && (
              <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Imprimir ranking
              </Button>
            )}
          </div>
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
              <span className="font-semibold text-foreground">VC+PE</span> — Vencedor + 1 placar
              exato (acertou o vencedor e um dos placares)
            </li>
            <li>
              <span className="font-semibold text-foreground">VCPI</span> — Vencedor correto, placar
              incorreto (ou empate não-exato)
            </li>
            <li>
              <span className="font-semibold text-foreground">32ª</span> — Times classificados para
              a rodada de 32 (saída da fase de grupos, 20 pts cada)
            </li>
            <li>
              <span className="font-semibold text-foreground">Oitavas</span> — Acertos nas oitavas
              de final (R16)
            </li>
            <li>
              <span className="font-semibold text-foreground">Quartas</span> — Acertos nas quartas
              de final
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
