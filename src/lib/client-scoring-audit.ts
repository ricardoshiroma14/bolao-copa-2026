import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  computeQualifiers,
  type MatchLite,
  type PredLite,
  type TeamLite,
} from "@/lib/group-standings";
import { R32, type SlotSpec } from "@/lib/wc2026-bracket";
import { matchNumberFromRealMatch } from "@/lib/bracket-match-number";
import { lookupThirdsAssignment } from "@/lib/wc2026-thirds-combinations";
import {
  BRACKET_SOURCE_MATCHES,
  bracketMatchNum,
  calculateRankingPoints,
  isCanonicalBracketStageSlot,
  classifyPredictionScore,
  classifyScore,
  isMatchScorable,
  normalizeScoring,
  pickStorageFor,
  scoreBracketRowPoints,
  scoreInputForIdenticalMatch,
  scorePredictionPoints,
  type MatchScoring,
  type MatchScoringInput,
} from "@/lib/scoring";
import { normalizeTeamsForDisplay } from "@/lib/team-names";

export type ScoringAuditIssue = {
  area: string;
  pool_id: string | null;
  pool_name: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  subject: string;
  actual: string | number | null;
  expected: string | number | null;
  detail: string;
};

export type ScoringAuditResult = {
  ok: boolean;
  source: "edge-function" | "admin-client";
  checked: {
    pools: number;
    teams: number;
    matches: number;
    predictions: number;
    bracketRows: number;
    championRows: number;
    rankingRows: number;
    issues: number;
  };
  cache: ScoringCacheAudit;
  issues: ScoringAuditIssue[];
  repaired?: ScoringRepairCounts;
};

type TableName = keyof Database["public"]["Tables"];
type PointTableName = "predictions" | "bracket_predictions" | "champion_predictions";
type PointUpdate = { table: PointTableName; id: string; points: number };

export type ScoringRepairCounts = {
  predictions: number;
  bracketRows: number;
  championRows: number;
  total: number;
};

export type ScoringCacheAudit = {
  stale: boolean;
  predictions: number;
  bracketRows: number;
  championRows: number;
  total: number;
};

type PoolRow = MatchScoringInput & {
  id: string;
  name: string;
};
type MatchRow = MatchLite & {
  external_id: string | null;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  status: string;
};
type PredictionRow = {
  id: string;
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
};
type BracketRow = {
  id: string;
  pool_id: string;
  user_id: string;
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  points: number | null;
};
type ChampionRow = {
  id: string;
  pool_id: string;
  user_id: string;
  team_id: string | null;
  points: number | null;
};
type MemberRow = { pool_id: string; user_id: string; has_paid: boolean };
type ProfileRow = { id: string; display_name: string | null };
type AuditUser = { id: string; name: string; email: string | null };

async function fetchAll<T>(table: TableName, select: string): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${String(table)}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function resolveR32Slot(
  spec: SlotSpec,
  qualifiers: ReturnType<typeof computeQualifiers>,
  matchNum: number,
) {
  if (spec.kind === "winner") return qualifiers.byGroup[spec.group]?.[0]?.team.id ?? null;
  if (spec.kind === "runnerUp") return qualifiers.byGroup[spec.group]?.[1]?.team.id ?? null;
  if (spec.kind !== "third") return null;

  const thirdGroups = qualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
  const assignment = lookupThirdsAssignment(thirdGroups);
  const group = assignment?.[matchNum];
  return group ? (qualifiers.byGroup[group]?.[2]?.team.id ?? null) : null;
}

function add(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function teamSetFromMatches(matchByNum: Map<number, MatchRow>, nums: number[]) {
  const set = new Set<string>();
  for (const num of nums) {
    const match = matchByNum.get(num);
    if (!match) continue;
    if (match.home_team_id) set.add(match.home_team_id);
    if (match.away_team_id) set.add(match.away_team_id);
  }
  return set;
}

function makeUser(userId: string, profilesById: Map<string, ProfileRow>): AuditUser {
  const profile = profilesById.get(userId);
  return {
    id: userId,
    name: profile?.display_name || userId,
    email: null,
  };
}

function issue(
  issues: ScoringAuditIssue[],
  area: string,
  subject: string,
  actual: string | number | null,
  expected: string | number | null,
  detail: string,
  pool?: PoolRow | null,
  user?: AuditUser | null,
) {
  issues.push({
    area,
    pool_id: pool?.id ?? null,
    pool_name: pool?.name ?? null,
    user_id: user?.id ?? null,
    user_name: user?.name ?? null,
    user_email: user?.email ?? null,
    subject,
    actual,
    expected,
    detail,
  });
}

function incrementCache(cache: ScoringCacheAudit, table: PointTableName) {
  cache.total++;
  if (table === "predictions") cache.predictions++;
  else if (table === "bracket_predictions") cache.bracketRows++;
  else cache.championRows++;
  cache.stale = cache.total > 0;
}

function expectedChampionPoints(row: ChampionRow, scoring: MatchScoring, final?: MatchRow) {
  if (
    !final ||
    final.status !== "finished" ||
    final.home_score == null ||
    final.away_score == null
  ) {
    return 0;
  }
  const championTeamId =
    final.home_score === final.away_score
      ? final.winner_team_id
      : final.home_score > final.away_score
        ? final.home_team_id
        : final.away_team_id;
  return championTeamId && row.team_id === championTeamId ? scoring.bonus_champion : 0;
}

export async function runClientScoringAudit(): Promise<ScoringAuditResult> {
  const { pointUpdates, ...result } = await calculateClientScoringAudit();
  return result;
}

async function calculateClientScoringAudit(): Promise<
  ScoringAuditResult & { pointUpdates: PointUpdate[] }
> {
  const [pools, teams, matches, predictions, brackets, champions, members, profiles] =
    await Promise.all([
      fetchAll<PoolRow>("pools", "*"),
      fetchAll<TeamLite>("teams", "id,name,code,group_name").then(normalizeTeamsForDisplay),
      fetchAll<MatchRow>(
        "matches",
        "id,external_id,stage,group_name,home_team_id,away_team_id,kickoff_at,home_score,away_score,winner_team_id,status",
      ),
      fetchAll<PredictionRow>("predictions", "id,user_id,match_id,home_score,away_score,points"),
      fetchAll<BracketRow>(
        "bracket_predictions",
        "id,pool_id,user_id,stage,slot,team_id,home_score,away_score,points",
      ),
      fetchAll<ChampionRow>("champion_predictions", "id,pool_id,user_id,team_id,points"),
      fetchAll<MemberRow>("pool_members", "pool_id,user_id,has_paid"),
      fetchAll<ProfileRow>("profiles", "id,display_name"),
    ]);

  const issues: ScoringAuditIssue[] = [];
  const pointUpdates: PointUpdate[] = [];
  const cache: ScoringCacheAudit = {
    stale: false,
    predictions: 0,
    bracketRows: 0,
    championRows: 0,
    total: 0,
  };
  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const matchByNum = new Map<number, MatchRow>();
  for (const match of matches) {
    if (match.stage === "group") continue;
    const matchNum = matchNumberFromRealMatch(match);
    if (matchNum == null) {
      issue(
        issues,
        "dados-base",
        `match ${match.id}`,
        "sem número",
        "M73-M104",
        `Não foi possível mapear stage=${match.stage}.`,
      );
    } else {
      matchByNum.set(matchNum, match);
    }
  }

  const groupMatches = matches.filter((m) => m.stage === "group");
  const groupMatchIds = new Set(groupMatches.map((m) => m.id));
  const groupPredsByUser = new Map<string, PredLite[]>();
  for (const pred of predictions) {
    if (!groupMatchIds.has(pred.match_id)) continue;
    const list = groupPredsByUser.get(pred.user_id) ?? [];
    list.push({
      match_id: pred.match_id,
      home_score: pred.home_score,
      away_score: pred.away_score,
    });
    groupPredsByUser.set(pred.user_id, list);
  }
  const qualifiersByUser = new Map<string, ReturnType<typeof computeQualifiers>>();
  const userQualifiers = (userId: string) => {
    let qualifiers = qualifiersByUser.get(userId);
    if (!qualifiers) {
      qualifiers = computeQualifiers(teams, groupMatches, groupPredsByUser.get(userId) ?? []);
      qualifiersByUser.set(userId, qualifiers);
    }
    return qualifiers;
  };

  let checkedPredictions = 0;
  for (const pred of predictions) {
    const match = matchById.get(pred.match_id);
    if (!match) continue;
    checkedPredictions++;
    const expected = scorePredictionPoints(pred, match);
    if ((pred.points ?? 0) !== expected) {
      incrementCache(cache, "predictions");
    }
  }

  let checkedBracketRows = 0;
  let checkedChampionRows = 0;
  let checkedRankingRows = 0;

  for (const pool of pools) {
    const scoring = normalizeScoring(pool);
    const poolMembers = members.filter((m) => m.pool_id === pool.id);
    const memberIds = new Set(poolMembers.map((m) => m.user_id));
    const poolBrackets = brackets.filter((b) => b.pool_id === pool.id);
    const poolCanonicalBrackets = poolBrackets.filter((b) =>
      isCanonicalBracketStageSlot(b.stage, b.slot),
    );
    const poolChampions = champions.filter((c) => c.pool_id === pool.id);
    const picksByUser = new Map<string, Map<string, string | null>>();
    for (const b of poolCanonicalBrackets) {
      const picks = picksByUser.get(b.user_id) ?? new Map<string, string | null>();
      picks.set(`${b.stage}-${b.slot}`, b.team_id);
      picksByUser.set(b.user_id, picks);
    }

    const userPickForMatch = (userId: string, matchNum: number) => {
      const storage = pickStorageFor(matchNum);
      if (!storage) return null;
      return picksByUser.get(userId)?.get(`${storage.stage}-${storage.slot}`) ?? null;
    };
    const predictedLoser = (
      participants: [string | null, string | null] | null,
      winnerId: string | null,
    ) => {
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
        const qualifiers = userQualifiers(userId);
        return [
          resolveR32Slot(spec.a, qualifiers, matchNum),
          resolveR32Slot(spec.b, qualifiers, matchNum),
        ];
      }
      if (matchNum === 103) {
        return [
          predictedLoser(predictedParticipantsForMatch(userId, 101), userPickForMatch(userId, 101)),
          predictedLoser(predictedParticipantsForMatch(userId, 102), userPickForMatch(userId, 102)),
        ];
      }
      const sources = BRACKET_SOURCE_MATCHES[matchNum];
      return sources
        ? [userPickForMatch(userId, sources[0]), userPickForMatch(userId, sources[1])]
        : null;
    };

    const expectedBracketTotals = new Map<string, number>();
    const expectedPredictionTotals = new Map<string, number>();
    for (const pred of predictions) {
      const match = matchById.get(pred.match_id);
      if (!match) continue;
      add(expectedPredictionTotals, pred.user_id, scorePredictionPoints(pred, match, scoring));
    }

    for (const b of poolCanonicalBrackets) {
      checkedBracketRows++;
      const matchNum = bracketMatchNum(b.stage, b.slot);
      const real = matchNum == null ? undefined : matchByNum.get(matchNum);
      let sourcePoints = 0;
      let scorePoints = 0;

      if (matchNum != null && real) {
        const isRoundOf32 = matchNum >= 73 && matchNum <= 88;
        let sourceHits = 0;
        if (matchNum === 103) {
          const realTeams = new Set([real.home_team_id, real.away_team_id].filter(Boolean));
          if (b.team_id && realTeams.has(b.team_id)) sourceHits += 1;
        } else if (isRoundOf32) {
          const qualifiers = new Set(userQualifiers(b.user_id).qualified.map((q) => q.team.id));
          if (real.home_team_id && qualifiers.has(real.home_team_id)) sourceHits += 1;
          if (real.away_team_id && qualifiers.has(real.away_team_id)) sourceHits += 1;
        } else {
          const sources = BRACKET_SOURCE_MATCHES[matchNum];
          if (sources && real.home_team_id && real.away_team_id) {
            const pickA = userPickForMatch(b.user_id, sources[0]);
            const pickB = userPickForMatch(b.user_id, sources[1]);
            if (pickA && (pickA === real.home_team_id || pickA === real.away_team_id))
              sourceHits += 1;
            if (pickB && (pickB === real.home_team_id || pickB === real.away_team_id))
              sourceHits += 1;
          }
        }

        const breakdown = scoreBracketRowPoints({
          matchNum,
          pick: b,
          real,
          predictedParticipants: predictedParticipantsForMatch(b.user_id, matchNum),
          sourceHits,
          scoring,
        });
        sourcePoints = breakdown.sourcePoints;
        scorePoints = breakdown.scorePoints;
      }

      const expected = sourcePoints + scorePoints;
      add(expectedBracketTotals, b.user_id, expected);
      if ((b.points ?? 0) !== expected) {
        pointUpdates.push({ table: "bracket_predictions", id: b.id, points: expected });
        incrementCache(cache, "bracket_predictions");
      }
    }

    const expectedChampionTotals = new Map<string, number>();
    for (const c of poolChampions) {
      checkedChampionRows++;
      const expected = expectedChampionPoints(c, scoring, matchByNum.get(104));
      add(expectedChampionTotals, c.user_id, expected);
      if ((c.points ?? 0) !== expected) {
        pointUpdates.push({ table: "champion_predictions", id: c.id, points: expected });
        incrementCache(cache, "champion_predictions");
      }
    }

    for (const userId of memberIds) {
      checkedRankingRows++;
      calculateRankingForUser({
        userId,
        scoring,
        predictions,
        poolBrackets: poolCanonicalBrackets,
        poolChampions,
        matchById,
        matchByNum,
        picksByUser,
        userQualifiers,
        predictedParticipantsForMatch,
      });
      // Stored points are audited as stale cache above. The visible ranking is
      // recalculated from raw predictions, including Round-of-32 qualifier
      // points that may not have a corresponding stored bracket cache row.
    }
  }

  return {
    ok: issues.length === 0,
    source: "admin-client",
    checked: {
      pools: pools.length,
      teams: teams.length,
      matches: matches.length,
      predictions: checkedPredictions,
      bracketRows: checkedBracketRows,
      championRows: checkedChampionRows,
      rankingRows: checkedRankingRows,
      issues: issues.length,
    },
    cache,
    issues,
    pointUpdates,
  };
}

function calculateRankingForUser({
  userId,
  scoring,
  predictions,
  poolBrackets,
  poolChampions,
  matchById,
  matchByNum,
  userQualifiers,
  predictedParticipantsForMatch,
}: {
  userId: string;
  scoring: MatchScoring;
  predictions: PredictionRow[];
  poolBrackets: BracketRow[];
  poolChampions: ChampionRow[];
  matchById: Map<string, MatchRow>;
  matchByNum: Map<number, MatchRow>;
  picksByUser: Map<string, Map<string, string | null>>;
  userQualifiers: (userId: string) => ReturnType<typeof computeQualifiers>;
  predictedParticipantsForMatch: (
    userId: string,
    matchNum: number,
  ) => [string | null, string | null] | null;
}) {
  const counters: Record<string, number> = {
    exact: 0,
    winnerPlusScore: 0,
    winnerOnly: 0,
    qual32: 0,
    r32: 0,
    r16: 0,
    sf: 0,
    third: 0,
    final: 0,
    champion: 0,
  };

  for (const pred of predictions.filter((p) => p.user_id === userId)) {
    const match = matchById.get(pred.match_id);
    if (!match) continue;
    const scoreType = classifyPredictionScore(pred, match);
    if (scoreType === "exact") counters.exact++;
    else if (scoreType === "winnerPlusScore") counters.winnerPlusScore++;
    else if (scoreType === "winnerOnly") counters.winnerOnly++;
  }

  const teamsInOitavas = teamSetFromMatches(matchByNum, range(89, 96));
  const teamsInQuartas = teamSetFromMatches(matchByNum, range(97, 100));
  const teamsInSemis = teamSetFromMatches(matchByNum, [101, 102]);
  const teamsInFinal = teamSetFromMatches(matchByNum, [104]);
  const teamsInThird = teamSetFromMatches(matchByNum, [103]);
  const actualR32Teams = teamSetFromMatches(matchByNum, range(73, 88));

  if (scoring.round_of_32_points_enabled && actualR32Teams.size > 0) {
    counters.qual32 = userQualifiers(userId).qualified.filter((q) =>
      actualR32Teams.has(q.team.id),
    ).length;
  }

  const stageToCounter = (stage: string, slot: number) => {
    if (stage === "round_of_16") return { key: "r32", set: teamsInOitavas };
    if (stage === "quarter") return { key: "r16", set: teamsInQuartas };
    if (stage === "semi") return { key: "sf", set: teamsInSemis };
    if (stage === "final" && (slot === 0 || slot === 1)) return { key: "final", set: teamsInFinal };
    if (stage === "third_place") return { key: "third", set: teamsInThird };
    return null;
  };

  for (const b of poolBrackets.filter((row) => row.user_id === userId)) {
    const stageCounter = stageToCounter(b.stage, b.slot);
    if (stageCounter && b.team_id && stageCounter.set.has(b.team_id)) {
      counters[stageCounter.key]++;
    }

    const matchNum = bracketMatchNum(b.stage, b.slot);
    if (
      matchNum == null ||
      (matchNum >= 73 && matchNum <= 88 && !scoring.round_of_32_points_enabled)
    )
      continue;
    const real = matchByNum.get(matchNum);
    if (
      !real ||
      !isMatchScorable(real) ||
      !real.winner_team_id ||
      b.team_id !== real.winner_team_id
    )
      continue;
    const scoreInput = scoreInputForIdenticalMatch(
      b,
      real,
      predictedParticipantsForMatch(userId, matchNum),
    );
    if (!scoreInput || real.home_score == null || real.away_score == null) continue;
    const scoreType = classifyScore(
      scoreInput.home_score,
      scoreInput.away_score,
      real.home_score,
      real.away_score,
    );
    if (scoreType === "exact") counters.exact++;
    else if (scoreType === "winnerPlusScore") counters.winnerPlusScore++;
    else if (scoreType === "winnerOnly") counters.winnerOnly++;
  }

  const champion = poolChampions.find((c) => c.user_id === userId);
  if (champion && expectedChampionPoints(champion, scoring, matchByNum.get(104)) > 0) {
    counters.champion = 1;
  }

  return { counters, points: calculateRankingPoints(counters, scoring) };
}
