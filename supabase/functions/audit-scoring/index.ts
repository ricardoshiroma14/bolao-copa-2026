import { createClient } from "npm:@supabase/supabase-js@2";
import { lookupThirdsAssignment } from "../../../src/lib/wc2026-thirds-combinations.ts";
import {
  BRACKET_SOURCE_MATCHES,
  bracketMatchNum,
  calculateRankingPoints,
  classifyPredictionScore,
  classifyScore,
  isCanonicalBracketStageSlot,
  isMatchScorable,
  normalizeScoring,
  pickStorageFor,
  scoreBracketRowPoints,
  scoreInputForIdenticalMatch,
  scorePredictionPoints,
  type MatchScoring,
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

class AdminAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

type QualifierResult = ReturnType<typeof computeQualifiers>;
type PoolRow = MatchScoringInput & {
  id: string;
  name: string;
  bonus_round_of_32_wrong?: number | null;
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
type ProfileRow = { id: string; display_name: string | null };
type MemberRow = { pool_id: string; user_id: string; has_paid: boolean };
type AuthUserRow = { id: string; email: string | null };
type AuditUser = { id: string; name: string; email: string | null };
type AuditIssue = {
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

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new AdminAuthError(500, `${name} não configurada`);
  return value;
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AdminAuthError(401, "Unauthorized: Bearer token obrigatório");
  }
  return token;
}

async function requireAdmin(req: Request, supabase: ReturnType<typeof createClient>) {
  const token = getBearerToken(req);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) throw new AdminAuthError(401, "Unauthorized: token inválido");

  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError) throw new AdminAuthError(500, "Falha ao validar permissões");
  if (!role) throw new AdminAuthError(403, "Forbidden: admin obrigatório");
  return user.id;
}

async function fetchAll<T>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  select: string,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchAuthUsers(supabase: ReturnType<typeof createClient>): Promise<AuthUserRow[]> {
  const users: AuthUserRow[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    users.push(...(data.users ?? []).map((u) => ({ id: u.id, email: u.email ?? null })));
    if (!data.users || data.users.length < 1000) break;
  }
  return users;
}

function resolveR32Slot(spec: SlotSpec, qualifiers: QualifierResult, matchNum: number) {
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

function teamSetFromMatches(matchByNum: Map<number, MatchRow>, nums: number[]) {
  const teams = new Set<string>();
  for (const num of nums) {
    const match = matchByNum.get(num);
    if (!match) continue;
    if (match.home_team_id) teams.add(match.home_team_id);
    if (match.away_team_id) teams.add(match.away_team_id);
  }
  return teams;
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function issue(
  issues: AuditIssue[],
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

function makeUser(
  userId: string,
  profilesById: Map<string, ProfileRow>,
  authUsersById: Map<string, AuthUserRow>,
): AuditUser {
  const profile = profilesById.get(userId);
  const authUser = authUsersById.get(userId);
  return {
    id: userId,
    name: profile?.display_name || authUser?.email || userId,
    email: authUser?.email ?? null,
  };
}

function expectedChampionPoints(row: ChampionRow, scoring: MatchScoring, final?: MatchRow) {
  if (
    !final ||
    final.status !== "finished" ||
    final.home_score == null ||
    final.away_score == null
  ) {
    return { points: 0, championTeamId: null as string | null };
  }
  const championTeamId =
    final.home_score === final.away_score
      ? final.winner_team_id
      : final.home_score > final.away_score
        ? final.home_team_id
        : final.away_team_id;
  return {
    points: championTeamId && row.team_id === championTeamId ? scoring.bonus_champion : 0,
    championTeamId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
    await requireAdmin(req, supabase);

    const result = await runAudit(supabase);
    return new Response(JSON.stringify({ ok: result.issues.length === 0, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown error";
    const status = e instanceof AdminAuthError ? e.status : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runAudit(supabase: ReturnType<typeof createClient>) {
  const [pools, teams, matches, predictions, brackets, champions, members, profiles, authUsers] =
    await Promise.all([
      fetchAll<PoolRow>(supabase, "pools", "*"),
      fetchAll<TeamLite>(supabase, "teams", "id,name,code,group_name"),
      fetchAll<MatchRow>(
        supabase,
        "matches",
        "id,external_id,stage,group_name,home_team_id,away_team_id,kickoff_at,home_score,away_score,winner_team_id,status",
      ),
      fetchAll<PredictionRow>(
        supabase,
        "predictions",
        "id,user_id,match_id,home_score,away_score,points",
      ),
      fetchAll<BracketRow>(
        supabase,
        "bracket_predictions",
        "id,pool_id,user_id,stage,slot,team_id,home_score,away_score,points",
      ),
      fetchAll<ChampionRow>(supabase, "champion_predictions", "id,pool_id,user_id,team_id,points"),
      fetchAll<MemberRow>(supabase, "pool_members", "pool_id,user_id,has_paid"),
      fetchAll<ProfileRow>(supabase, "profiles", "id,display_name"),
      fetchAuthUsers(supabase),
    ]);

  const issues: AuditIssue[] = [];
  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const authUsersById = new Map(authUsers.map((u) => [u.id, u]));
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
        `Não foi possível mapear stage=${match.stage} para o número oficial.`,
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
  const qualifiersByUser = new Map<string, QualifierResult>();
  const userQualifiers = (userId: string) => {
    let q = qualifiersByUser.get(userId);
    if (!q) {
      q = computeQualifiers(teams, groupMatches, groupPredsByUser.get(userId) ?? []);
      qualifiersByUser.set(userId, q);
    }
    return q;
  };

  let checkedPredictions = 0;
  for (const pred of predictions) {
    const match = matchById.get(pred.match_id);
    if (!match) continue;
    checkedPredictions++;
  }

  const poolSummaries = [];
  let checkedBracketRows = 0;
  let checkedChampionRows = 0;
  let checkedRankingRows = 0;

  for (const pool of pools) {
    const scoring = normalizeScoring(pool);
    const poolMembers = members.filter((m) => m.pool_id === pool.id);
    const memberIds = new Set(poolMembers.map((m) => m.user_id));
    const poolBrackets = brackets.filter((b) => b.pool_id === pool.id);
    const poolChampions = champions.filter((c) => c.pool_id === pool.id);
    const picksByUser = new Map<string, Map<string, string | null>>();
    for (const b of poolBrackets) {
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
    const storedBracketTotals = new Map<string, number>();
    const expectedVisibleMatchTotals = new Map<string, number>();
    const storedVisibleMatchTotals = new Map<string, number>();
    const expectedPredictionTotals = new Map<string, number>();
    for (const pred of predictions) {
      const match = matchById.get(pred.match_id);
      if (!match) continue;
      add(expectedPredictionTotals, pred.user_id, scorePredictionPoints(pred, match, scoring));
    }

    const canonicalPoolBrackets = poolBrackets.filter((b) =>
      isCanonicalBracketStageSlot(b.stage, b.slot),
    );
    for (const b of canonicalPoolBrackets) {
      checkedBracketRows++;
      const matchNum = bracketMatchNum(b.stage, b.slot);
      const real = matchNum == null ? undefined : matchByNum.get(matchNum);
      let expected = 0;
      let sourcePoints = 0;
      let scorePoints = 0;

      if (matchNum != null && real) {
        const isRoundOf32 = matchNum >= 73 && matchNum <= 88;
        let sourceHits = 0;
        if (matchNum === 103) {
          const realTeams = new Set([real.home_team_id, real.away_team_id].filter(Boolean));
          if (b.team_id && realTeams.has(b.team_id)) sourceHits += 1;
        } else if (isRoundOf32) {
          const qualSet = new Set(userQualifiers(b.user_id).qualified.map((q) => q.team.id));
          if (real.home_team_id && qualSet.has(real.home_team_id)) sourceHits += 1;
          if (real.away_team_id && qualSet.has(real.away_team_id)) sourceHits += 1;
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

      expected = sourcePoints + scorePoints;
      add(expectedBracketTotals, b.user_id, expected);
      add(storedBracketTotals, b.user_id, b.points ?? 0);
      if (matchNum != null) {
        const key = `${b.user_id}:${matchNum}`;
        add(expectedVisibleMatchTotals, key, expected);
        add(storedVisibleMatchTotals, key, b.points ?? 0);
      }
      if ((b.points ?? 0) !== expected) {
        issue(
          issues,
          "banco-bracket",
          `M${matchNum ?? "?"} ${b.stage}/${b.slot}`,
          b.points ?? 0,
          expected,
          `Fonte=${sourcePoints}; placar=${scorePoints}; confronto idêntico só habilita 10/7/5.`,
          pool,
          makeUser(b.user_id, profilesById, authUsersById),
        );
      }
    }

    for (const [key, expected] of expectedVisibleMatchTotals) {
      const actual = storedVisibleMatchTotals.get(key) ?? 0;
      if (actual === expected) continue;
      const [userId, matchNum] = key.split(":");
      issue(
        issues,
        "tabela-da-copa",
        `M${matchNum}`,
        actual,
        expected,
        "Total visível esperado para este jogo na Tabela da Copa.",
        pool,
        makeUser(userId, profilesById, authUsersById),
      );
    }

    const expectedChampionTotals = new Map<string, number>();
    const storedChampionTotals = new Map<string, number>();
    for (const c of poolChampions) {
      checkedChampionRows++;
      const { points, championTeamId } = expectedChampionPoints(c, scoring, matchByNum.get(104));
      add(expectedChampionTotals, c.user_id, points);
      add(storedChampionTotals, c.user_id, c.points ?? 0);
      if ((c.points ?? 0) !== points) {
        issue(
          issues,
          "banco-campeao",
          `champion ${c.id}`,
          c.points ?? 0,
          points,
          `Campeão oficial: ${championTeamId ?? "não definido"}.`,
          pool,
          makeUser(c.user_id, profilesById, authUsersById),
        );
      }
    }

    for (const userId of memberIds) {
      checkedRankingRows++;
      calculateRankingForUser(
        userId,
        scoring,
        predictions,
        canonicalPoolBrackets,
        poolChampions,
        matchById,
        matchByNum,
        picksByUser,
        userQualifiers,
        predictedParticipantsForMatch,
      );
      // Stored points are audited as stale cache above. The visible ranking is
      // recalculated from raw predictions, including Round-of-32 qualifier
      // points that may not have a corresponding stored bracket cache row.
    }

    poolSummaries.push({
      id: pool.id,
      name: pool.name,
      members: poolMembers.length,
      bracketRows: canonicalPoolBrackets.length,
      championRows: poolChampions.length,
      roundOf32Released: scoring.round_of_32_points_enabled,
    });
  }

  return {
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
    pools: poolSummaries,
    issues,
  };
}

function calculateRankingForUser(
  userId: string,
  scoring: MatchScoring,
  predictions: PredictionRow[],
  poolBrackets: BracketRow[],
  poolChampions: ChampionRow[],
  matchById: Map<string, MatchRow>,
  matchByNum: Map<number, MatchRow>,
  picksByUser: Map<string, Map<string, string | null>>,
  userQualifiers: (userId: string) => QualifierResult,
  predictedParticipantsForMatch: (
    userId: string,
    matchNum: number,
  ) => [string | null, string | null] | null,
) {
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

  for (const b of poolBrackets.filter(
    (row) => row.user_id === userId && isCanonicalBracketStageSlot(row.stage, row.slot),
  )) {
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
  if (champion) {
    counters.champion =
      expectedChampionPoints(champion, scoring, matchByNum.get(104)).points > 0 ? 1 : 0;
  }

  return { counters, points: calculateRankingPoints(counters, scoring) };
}
