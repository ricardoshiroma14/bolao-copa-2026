// Recalculate prediction points for all finished matches and bracket/champion picks
// using the official pool scoring rules.
import { createClient } from "npm:@supabase/supabase-js@2";
import { lookupThirdsAssignment } from "../../../src/lib/wc2026-thirds-combinations.ts";
import {
  BRACKET_SOURCE_MATCHES,
  bracketMatchNum,
  isCanonicalBracketStageSlot,
  normalizeScoring,
  pickStorageFor,
  scoreBracketRowPoints,
  scorePredictionPoints,
  type MatchScoringInput,
} from "../../../src/lib/scoring.ts";
import {
  computeQualifiers,
  type MatchLite,
  type PredLite,
  type TeamLite,
} from "../../../src/lib/group-standings.ts";
import { R32, type SlotSpec } from "../../../src/lib/wc2026-bracket.ts";
import { matchNumberFromRealMatch } from "../../../src/lib/bracket-match-number.ts";
import { AdminAuthError, requireAdmin } from "../_shared/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MatchRow = {
  id: string;
  home_score: number | null;
  away_score: number | null;
  stage: string;
  status: string;
};

type MatchScoreRow = {
  id: string;
  home_score: number | null;
  away_score: number | null;
};

type ScoreFunctionResult = {
  predictions: number;
  brackets: number;
  champions: number;
};

type PoolRow = MatchScoringInput & {
  id: string;
};

type BracketPredictionRow = {
  id: string;
  user_id: string;
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

type ChampionPredictionRow = {
  id: string;
  team_id: string | null;
};

type QualifierResult = ReturnType<typeof computeQualifiers>;

function resolveR32Slot(
  spec: SlotSpec,
  qualifiers: QualifierResult,
  matchNum: number,
): string | null {
  if (spec.kind === "winner") return qualifiers.byGroup[spec.group]?.[0]?.team.id ?? null;
  if (spec.kind === "runnerUp") return qualifiers.byGroup[spec.group]?.[1]?.team.id ?? null;

  const thirdGroups = qualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
  const assignment = lookupThirdsAssignment(thirdGroups);
  const group = assignment?.[matchNum];
  return group ? (qualifiers.byGroup[group]?.[2]?.team.id ?? null) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireAdmin(req);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pools } = await supabase
      .from("pools")
      .select(
        "id, scoring_exact, scoring_diff, scoring_winner, bonus_round_of_32, bonus_round_of_32_wrong, bonus_round_of_16, bonus_quarter, bonus_semi, bonus_third_place, bonus_final, bonus_champion, round_of_32_points_enabled",
      );
    if (!pools?.length) return ok({ predictions: 0, brackets: 0, champions: 0 });

    // ----- Match (group + knockout) prediction scoring -----
    const { data: predictionMatches } = await supabase
      .from("matches")
      .select("id, home_score, away_score, stage, status");

    let predUpdates = 0;
    for (const m of (predictionMatches ?? []) as MatchRow[]) {
      const { data: preds } = await supabase
        .from("predictions")
        .select("id, home_score, away_score")
        .eq("match_id", m.id);
      for (const p of (preds ?? []) as MatchScoreRow[]) {
        const pts = scorePredictionPoints(p, m);
        await supabase.from("predictions").update({ points: pts }).eq("id", p.id);
        predUpdates++;
      }
    }

    // ----- Bracket scoring (NEW MODEL) -----
    // Per-bracket-row points = (count of correctly predicted source teams) × source_bonus
    //                        + scoreMatch(...) if winner pick is correct
    const { data: allTeams } = await supabase.from("teams").select("id, name, code, group_name");
    const teams = (allTeams ?? []) as TeamLite[];

    const { data: allMatchesData } = await supabase
      .from("matches")
      .select(
        "id, external_id, stage, group_name, kickoff_at, home_team_id, away_team_id, home_score, away_score, winner_team_id, status",
      );
    type RealMatch = {
      id: string;
      external_id: string | null;
      stage: string;
      group_name: string | null;
      kickoff_at: string;
      home_team_id: string | null;
      away_team_id: string | null;
      home_score: number | null;
      away_score: number | null;
      winner_team_id: string | null;
      status: string | null;
    };
    const allMatches = (allMatchesData ?? []) as RealMatch[];

    const matchByNum = new Map<number, RealMatch>();
    for (const mm of allMatches) {
      const matchNum = matchNumberFromRealMatch(mm);
      if (matchNum) matchByNum.set(matchNum, mm);
    }
    const groupMatches = allMatches.filter((m) => m.stage === "group");

    // All group predictions to compute per-user qualifier sets.
    const { data: allGroupPredsData } = await supabase
      .from("predictions")
      .select("user_id, match_id, home_score, away_score");
    type RawPred = { user_id: string; match_id: string; home_score: number; away_score: number };
    const allGroupPreds = (allGroupPredsData ?? []) as RawPred[];
    const groupMatchIds = new Set(groupMatches.map((m) => m.id));
    const predsByUser = new Map<string, PredLite[]>();
    for (const p of allGroupPreds) {
      if (!groupMatchIds.has(p.match_id)) continue;
      const arr = predsByUser.get(p.user_id) ?? [];
      arr.push({ match_id: p.match_id, home_score: p.home_score, away_score: p.away_score });
      predsByUser.set(p.user_id, arr);
    }
    const userQualifiersCache = new Map<string, Set<string>>();
    const userQualifierResultCache = new Map<string, QualifierResult>();
    function getUserQualifierResult(userId: string): QualifierResult {
      let result = userQualifierResultCache.get(userId);
      if (result) return result;
      const ups = predsByUser.get(userId) ?? [];
      result = computeQualifiers(teams, groupMatches, ups);
      userQualifierResultCache.set(userId, result);
      return result;
    }
    function getUserQualifiers(userId: string): Set<string> {
      let s = userQualifiersCache.get(userId);
      if (s) return s;
      s = new Set(getUserQualifierResult(userId).qualified.map((q) => q.team.id));
      userQualifiersCache.set(userId, s);
      return s;
    }

    let bracketUpdates = 0;
    let championUpdates = 0;
    for (const pool of pools as PoolRow[]) {
      const scoring = normalizeScoring(pool);

      // Per-user lookup of bracket picks → keyed by `${stage}-${slot}` → team_id
      const { data: brackets } = await supabase
        .from("bracket_predictions")
        .select("id, user_id, stage, slot, team_id, home_score, away_score")
        .eq("pool_id", pool.id);

      const picksByUser = new Map<string, Map<string, string | null>>();
      for (const b of (brackets ?? []) as BracketPredictionRow[]) {
        const m = picksByUser.get(b.user_id) ?? new Map<string, string | null>();
        m.set(`${b.stage}-${b.slot}`, b.team_id);
        picksByUser.set(b.user_id, m);
      }
      const userPickForMatch = (userId: string, matchNum: number): string | null => {
        const sto = pickStorageFor(matchNum);
        if (!sto) return null;
        return picksByUser.get(userId)?.get(`${sto.stage}-${sto.slot}`) ?? null;
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
        userId: string,
        matchNum: number,
      ): [string | null, string | null] | null => {
        if (matchNum >= 73 && matchNum <= 88) {
          const spec = R32.find((row) => row.match === matchNum);
          if (!spec) return null;
          const qualifiers = getUserQualifierResult(userId);
          return [
            resolveR32Slot(spec.a, qualifiers, matchNum),
            resolveR32Slot(spec.b, qualifiers, matchNum),
          ];
        }
        if (matchNum === 103) {
          const semi101 = predictedParticipantsForMatch(userId, 101);
          const semi102 = predictedParticipantsForMatch(userId, 102);
          return [
            predictedLoser(semi101, userPickForMatch(userId, 101)),
            predictedLoser(semi102, userPickForMatch(userId, 102)),
          ];
        }
        const srcs = BRACKET_SOURCE_MATCHES[matchNum];
        return srcs ? [userPickForMatch(userId, srcs[0]), userPickForMatch(userId, srcs[1])] : null;
      };

      for (const b of (brackets ?? []) as BracketPredictionRow[]) {
        let pts = 0;
        if (!isCanonicalBracketStageSlot(b.stage, b.slot)) {
          await supabase.from("bracket_predictions").update({ points: 0 }).eq("id", b.id);
          bracketUpdates++;
          continue;
        }
        const matchNum = bracketMatchNum(b.stage, b.slot);
        const real = matchNum != null ? matchByNum.get(matchNum) : undefined;

        if (matchNum != null && real) {
          let sourceHits = 0;

          if (matchNum === 103) {
            // 3rd place: each slot row independently — check if pick matches one of
            // the two real teams in M103 (which are the losers of M101/M102).
            if (b.team_id) {
              const realTeams = new Set(
                [real.home_team_id, real.away_team_id].filter(Boolean) as string[],
              );
              if (realTeams.has(b.team_id)) sourceHits += 1;
            }
          } else if (matchNum >= 73 && matchNum <= 88) {
            const qualSet = getUserQualifiers(b.user_id);
            if (real.home_team_id && qualSet.has(real.home_team_id)) sourceHits += 1;
            if (real.away_team_id && qualSet.has(real.away_team_id)) sourceHits += 1;
          } else {
            // R16, QF, SF, Final: source = 2 previous match winners.
            const srcs = BRACKET_SOURCE_MATCHES[matchNum];
            if (srcs && real.home_team_id && real.away_team_id) {
              const [srcA, srcB] = srcs;
              // The home team of `real` came from srcA, away from srcB
              // (bracket spec order is preserved when admin fills R16/QF/SF/Final
              //  via the bracket structure). Check user's picks for both source matches.
              const pickA = userPickForMatch(b.user_id, srcA);
              const pickB = userPickForMatch(b.user_id, srcB);
              if (pickA && (pickA === real.home_team_id || pickA === real.away_team_id)) {
                sourceHits += 1;
              }
              if (pickB && (pickB === real.home_team_id || pickB === real.away_team_id)) {
                sourceHits += 1;
              }
            }
          }

          pts = scoreBracketRowPoints({
            matchNum,
            pick: b,
            real,
            predictedParticipants: predictedParticipantsForMatch(b.user_id, matchNum),
            sourceHits,
            scoring,
          }).total;
        }

        await supabase.from("bracket_predictions").update({ points: pts }).eq("id", b.id);
        bracketUpdates++;
      }

      // Champion: only awarded when final is finished
      const { data: finalMatch } = await supabase
        .from("matches")
        .select("home_team_id, away_team_id, home_score, away_score, winner_team_id, status")
        .eq("stage", "final")
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let championTeamId: string | null = null;
      if (finalMatch && finalMatch.home_score != null && finalMatch.away_score != null) {
        if (finalMatch.home_score === finalMatch.away_score) {
          championTeamId = finalMatch.winner_team_id;
        } else {
          championTeamId =
            finalMatch.home_score > finalMatch.away_score
              ? finalMatch.home_team_id
              : finalMatch.away_team_id;
        }
      }
      const { data: champs } = await supabase
        .from("champion_predictions")
        .select("id, team_id")
        .eq("pool_id", pool.id);
      for (const c of (champs ?? []) as ChampionPredictionRow[]) {
        const pts = championTeamId && c.team_id === championTeamId ? scoring.bonus_champion : 0;
        await supabase.from("champion_predictions").update({ points: pts }).eq("id", c.id);
        championUpdates++;
      }
    }

    return ok({ predictions: predUpdates, brackets: bracketUpdates, champions: championUpdates });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown error";

    const status = e instanceof AdminAuthError ? e.status : 500;

    if (e instanceof AdminAuthError) {
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: e.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function ok(body: ScoreFunctionResult) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
