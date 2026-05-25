#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function loadSharedScoring() {
  const tmp = fs.mkdtempSync(path.join(tmpdir(), "bolao-audit-scoring-"));
  const transpile = (sourcePath, outputName, rewrite = (source) => source) => {
    const source = rewrite(fs.readFileSync(path.join(repoRoot, sourcePath), "utf8"));
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    }).outputText;
    fs.writeFileSync(path.join(tmp, outputName), output);
  };

  transpile("src/lib/round-of-32-release.ts", "round-of-32-release.mjs");
  transpile("src/lib/group-standings.ts", "group-standings.mjs");
  transpile("src/lib/wc2026-bracket.ts", "wc2026-bracket.mjs");
  transpile("src/lib/wc2026-bracket-schedule.ts", "wc2026-bracket-schedule.mjs");
  transpile("src/lib/bracket-match-number.ts", "bracket-match-number.mjs", (source) =>
    source
      .replace("./wc2026-bracket.ts", "./wc2026-bracket.mjs")
      .replace("./wc2026-bracket-schedule.ts", "./wc2026-bracket-schedule.mjs"),
  );
  transpile("src/lib/scoring.ts", "scoring.mjs", (source) =>
    source.replace("./round-of-32-release", "./round-of-32-release.mjs"),
  );
  return {
    scoring: await import(path.join(tmp, "scoring.mjs")),
    standings: await import(path.join(tmp, "group-standings.mjs")),
    bracket: await import(path.join(tmp, "wc2026-bracket.mjs")),
    matchNumber: await import(path.join(tmp, "bracket-match-number.mjs")),
  };
}

const sharedModules = await loadSharedScoring();
const {
  BRACKET_SOURCE_MATCHES: SOURCE_MATCHES,
  DEFAULT_MATCH_SCORING: DEFAULT_SCORING,
  bracketMatchNum,
  calculateRankingPoints,
  classifyPredictionScore,
  isMatchScorable,
  normalizeScoring,
  pickStorageFor,
  scoreBracketRowPoints,
  scoreInputForIdenticalMatch,
  scorePredictionPoints,
} = sharedModules.scoring;
const { computeQualifiers } = sharedModules.standings;
const { R32 } = sharedModules.bracket;
const { matchNumberFromRealMatch } = sharedModules.matchNumber;

function parseArgs(argv) {
  const args = {
    pool: null,
    user: null,
    json: false,
    max: 50,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--pool") args.pool = argv[++i] ?? null;
    else if (arg.startsWith("--pool=")) args.pool = arg.slice("--pool=".length);
    else if (arg === "--user") args.user = argv[++i] ?? null;
    else if (arg.startsWith("--user=")) args.user = arg.slice("--user=".length);
    else if (arg === "--max") args.max = Number(argv[++i] ?? args.max);
    else if (arg.startsWith("--max=")) args.max = Number(arg.slice("--max=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: npm run audit:scoring -- [options]

Options:
  --pool <id-or-name>  Audit only one pool.
  --user <id-or-name>  Show issues only for matching participant id/display name.
  --json              Print machine-readable JSON.
  --max <n>           Maximum issue lines in text output. Default: 50.
  --help              Show this help.

Environment:
  Uses SUPABASE_URL or VITE_SUPABASE_URL.
  Uses SUPABASE_SERVICE_ROLE_KEY when available, otherwise the publishable key.
  Service-role access is recommended so RLS cannot hide rows from the audit.`);
  console.log(`
Note:
  Stored points cache differences are reported separately and do not fail the audit.
  User-facing scoring screens recalculate from raw picks and official results.`);
}

function loadEnv() {
  const envPath = path.join(repoRoot, ".env");
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) env[key] = value;
  }
  return env;
}

async function fetchAll(client, table, select, build = (query) => query) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const query = build(
      client
        .from(table)
        .select(select)
        .range(from, from + pageSize - 1),
    );
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchAuthUsers(client, enabled) {
  if (!enabled) return [];
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    users.push(...(data?.users ?? []));
    if (!data?.users || data.users.length < 1000) break;
  }
  return users.map((user) => ({ id: user.id, email: user.email ?? null }));
}

function loadThirdPlaceCombinations() {
  const source = fs.readFileSync(
    path.join(repoRoot, "src/lib/wc2026-thirds-combinations.ts"),
    "utf8",
  );
  const match = source.match(
    /export const THIRD_PLACE_COMBINATIONS:[\s\S]*?=\s*(\{[\s\S]*?\});\s*export function/,
  );
  if (!match) throw new Error("Could not read THIRD_PLACE_COMBINATIONS from source file.");
  const json = match[1].replace(/^(\s*)([A-L]{8}):/gm, '$1"$2":').replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(json);
}

const THIRD_PLACE_COMBINATIONS = loadThirdPlaceCombinations();

function lookupThirdsAssignment(groups) {
  if (groups.length !== 8) return null;
  const key = [...groups].sort().join("");
  return THIRD_PLACE_COMBINATIONS[key] ?? null;
}

function resolveR32Slot(spec, qualifiers, matchNum) {
  if (spec.kind === "winner") return qualifiers.byGroup[spec.group]?.[0]?.team.id ?? null;
  if (spec.kind === "runnerUp") return qualifiers.byGroup[spec.group]?.[1]?.team.id ?? null;

  const thirdGroups = qualifiers.qualified
    .filter((qualified) => qualified.position === 3)
    .map((qualified) => qualified.group);
  const assignment = lookupThirdsAssignment(thirdGroups);
  const group = assignment?.[matchNum];
  return group ? (qualifiers.byGroup[group]?.[2]?.team.id ?? null) : null;
}

function teamSetFromMatches(matchByNum, nums) {
  const teams = new Set();
  for (const num of nums) {
    const match = matchByNum.get(num);
    if (!match) continue;
    if (match.home_team_id) teams.add(match.home_team_id);
    if (match.away_team_id) teams.add(match.away_team_id);
  }
  return teams;
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function addToMap(map, key, amount) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function issue(issues, area, subject, actual, expected, detail, pool, user) {
  issues.push({
    area,
    pool: pool ? { id: pool.id, name: pool.name } : null,
    user,
    subject,
    actual,
    expected,
    detail,
  });
}

function shouldIncludeUser(user, userFilter) {
  if (!userFilter) return true;
  const needle = userFilter.toLowerCase();
  return (
    user.id.toLowerCase().includes(needle) ||
    user.name.toLowerCase().includes(needle) ||
    (user.email?.toLowerCase().includes(needle) ?? false)
  );
}

function userFor(userId, profilesById, authUsersById = new Map()) {
  const profile = profilesById.get(userId);
  const authUser = authUsersById.get(userId);
  return {
    id: userId,
    name: profile?.display_name || authUser?.email || userId,
    email: authUser?.email ?? null,
  };
}

function staticSourceChecks(issues) {
  const matchesTab = fs.readFileSync(
    path.join(repoRoot, "src/components/pool/MatchesTab.tsx"),
    "utf8",
  );
  const detailsDialog = fs.readFileSync(
    path.join(repoRoot, "src/components/pool/ParticipantDetailsDialog.tsx"),
    "utf8",
  );

  if (
    !matchesTab.includes("calculatedKnockoutDisplayPoints") ||
    !matchesTab.includes("scoreBracketRowPoints") ||
    !matchesTab.includes("sourceHits")
  ) {
    issue(
      issues,
      "tabela-da-copa",
      "MatchesTab formula",
      "missing source-bonus formula",
      "source bonus + identical-match score bonus",
      "Tabela da Copa must not show only 10/7/5 for knockout games.",
    );
  }

  if (!detailsDialog.includes("Score-only points") || !detailsDialog.includes("teamsMatch")) {
    issue(
      issues,
      "detalhes-participante",
      "ParticipantDetailsDialog formula",
      "missing score-only identical-match guard",
      "score-only details guarded by identical matchup",
      "Details screen should keep PE/VC+PE/VCPI visible without source bonus.",
    );
  }
}

function buildAuditContext(rows) {
  const teams = rows.teams;
  const matches = rows.matches;
  const profilesById = new Map(rows.profiles.map((profile) => [profile.id, profile]));
  const authUsersById = new Map(rows.authUsers.map((user) => [user.id, user]));
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const matchByNum = new Map();
  const missingNumberedKnockouts = [];

  for (const match of matches) {
    if (match.stage === "group") continue;
    const matchNum = matchNumberFromRealMatch(match);
    if (matchNum == null) {
      missingNumberedKnockouts.push(match);
      continue;
    }
    matchByNum.set(matchNum, match);
  }

  const groupMatches = matches.filter((match) => match.stage === "group");
  const groupMatchIds = new Set(groupMatches.map((match) => match.id));
  const groupPredsByUser = new Map();
  for (const pred of rows.predictions) {
    if (!groupMatchIds.has(pred.match_id)) continue;
    const preds = groupPredsByUser.get(pred.user_id) ?? [];
    preds.push({
      match_id: pred.match_id,
      home_score: pred.home_score,
      away_score: pred.away_score,
    });
    groupPredsByUser.set(pred.user_id, preds);
  }

  const qualifiersByUser = new Map();
  const userQualifiers = (userId) => {
    let qualifiers = qualifiersByUser.get(userId);
    if (qualifiers) return qualifiers;
    qualifiers = computeQualifiers(teams, groupMatches, groupPredsByUser.get(userId) ?? []);
    qualifiersByUser.set(userId, qualifiers);
    return qualifiers;
  };

  return {
    teams,
    matches,
    profilesById,
    authUsersById,
    matchById,
    matchByNum,
    missingNumberedKnockouts,
    groupMatches,
    groupMatchIds,
    groupPredsByUser,
    userQualifiers,
  };
}

function expectedBracketPoints({ row, pool, scoring, matchByNum, picksByUser, userQualifiers }) {
  const matchNum = bracketMatchNum(row.stage, row.slot);
  const real = matchNum != null ? matchByNum.get(matchNum) : null;
  if (matchNum == null || !real) {
    return { points: 0, matchNum, reason: "missing official match" };
  }

  const userPickForMatch = (userId, num) => {
    const storage = pickStorageFor(num);
    if (!storage) return null;
    return picksByUser.get(userId)?.get(`${storage.stage}-${storage.slot}`) ?? null;
  };

  const predictedLoser = (participants, winnerId) => {
    if (!participants || !winnerId) return null;
    const [home, away] = participants;
    if (winnerId === home) return away;
    if (winnerId === away) return home;
    return null;
  };

  const predictedParticipantsForMatch = (userId, num) => {
    if (num >= 73 && num <= 88) {
      const spec = R32.find((slot) => slot.match === num);
      if (!spec) return null;
      const qualifiers = userQualifiers(userId);
      return [resolveR32Slot(spec.a, qualifiers, num), resolveR32Slot(spec.b, qualifiers, num)];
    }
    if (num === 103) {
      const semi101 = predictedParticipantsForMatch(userId, 101);
      const semi102 = predictedParticipantsForMatch(userId, 102);
      return [
        predictedLoser(semi101, userPickForMatch(userId, 101)),
        predictedLoser(semi102, userPickForMatch(userId, 102)),
      ];
    }
    const sources = SOURCE_MATCHES[num];
    return sources
      ? [userPickForMatch(userId, sources[0]), userPickForMatch(userId, sources[1])]
      : null;
  };

  const isRoundOf32Match = matchNum >= 73 && matchNum <= 88;
  let sourceHits = 0;
  if (matchNum === 103) {
    const realTeams = new Set([real.home_team_id, real.away_team_id].filter(Boolean));
    if (row.team_id && realTeams.has(row.team_id)) sourceHits += 1;
  } else if (isRoundOf32Match) {
    const qualifierSet = new Set(userQualifiers(row.user_id).qualified.map((q) => q.team.id));
    if (real.home_team_id && qualifierSet.has(real.home_team_id)) sourceHits += 1;
    if (real.away_team_id && qualifierSet.has(real.away_team_id)) sourceHits += 1;
  } else {
    const sources = SOURCE_MATCHES[matchNum];
    if (sources && real.home_team_id && real.away_team_id) {
      const [sourceA, sourceB] = sources;
      const pickA = userPickForMatch(row.user_id, sourceA);
      const pickB = userPickForMatch(row.user_id, sourceB);
      if (pickA && (pickA === real.home_team_id || pickA === real.away_team_id)) sourceHits += 1;
      if (pickB && (pickB === real.home_team_id || pickB === real.away_team_id)) sourceHits += 1;
    }
  }

  const breakdown = scoreBracketRowPoints({
    matchNum,
    pick: row,
    real,
    predictedParticipants: predictedParticipantsForMatch(row.user_id, matchNum),
    sourceHits,
    scoring,
  });

  return { points: breakdown.total, matchNum, reason: `pool=${pool.name}` };
}

function expectedChampionPoints(row, scoring, matchByNum) {
  const final = matchByNum.get(104);
  if (
    !final ||
    final.status !== "finished" ||
    final.home_score == null ||
    final.away_score == null
  ) {
    return { points: 0, championTeamId: null };
  }

  let championTeamId = null;
  if (final.home_score === final.away_score) {
    championTeamId = final.winner_team_id;
  } else {
    championTeamId = final.home_score > final.away_score ? final.home_team_id : final.away_team_id;
  }

  return {
    points: championTeamId && row.team_id === championTeamId ? scoring.bonus_champion : 0,
    championTeamId,
  };
}

function computeRankingForUser({
  userId,
  scoring,
  context,
  rows,
  poolBracketRows,
  poolChampionRows,
  picksByUser,
}) {
  const counters = {
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

  for (const pred of rows.predictions.filter((item) => item.user_id === userId)) {
    const match = context.matchById.get(pred.match_id);
    if (!match) continue;
    const scoreType = classifyPredictionScore(pred, match);
    if (scoreType === "exact") counters.exact += 1;
    else if (scoreType === "winnerPlusScore") counters.winnerPlusScore += 1;
    else if (scoreType === "winnerOnly") counters.winnerOnly += 1;
  }

  const teamsInOitavas = teamSetFromMatches(context.matchByNum, range(89, 96));
  const teamsInQuartas = teamSetFromMatches(context.matchByNum, range(97, 100));
  const teamsInSemis = teamSetFromMatches(context.matchByNum, [101, 102]);
  const teamsInFinal = teamSetFromMatches(context.matchByNum, [104]);
  const teamsInThird = teamSetFromMatches(context.matchByNum, [103]);
  const actualR32Teams = teamSetFromMatches(context.matchByNum, range(73, 88));

  if (scoring.round_of_32_points_enabled && actualR32Teams.size > 0) {
    counters.qual32 = context
      .userQualifiers(userId)
      .qualified.filter((qualified) => actualR32Teams.has(qualified.team.id)).length;
  }

  const stageToCounter = (stage, slot) => {
    if (stage === "round_of_16") return { key: "r32", set: teamsInOitavas };
    if (stage === "quarter") return { key: "r16", set: teamsInQuartas };
    if (stage === "semi") return { key: "sf", set: teamsInSemis };
    if (stage === "final" && (slot === 0 || slot === 1)) return { key: "final", set: teamsInFinal };
    if (stage === "third_place") return { key: "third", set: teamsInThird };
    return null;
  };

  for (const row of poolBracketRows.filter((item) => item.user_id === userId)) {
    const stageCounter = stageToCounter(row.stage, row.slot);
    if (stageCounter && row.team_id && stageCounter.set.has(row.team_id)) {
      counters[stageCounter.key] += 1;
    }

    const expected = expectedBracketPoints({
      row,
      pool: { name: "ranking", id: row.pool_id },
      scoring,
      matchByNum: context.matchByNum,
      picksByUser,
      userQualifiers: context.userQualifiers,
    });
    const matchNum = expected.matchNum;
    if (matchNum == null) continue;
    if (matchNum >= 73 && matchNum <= 88 && !scoring.round_of_32_points_enabled) continue;
    const real = context.matchByNum.get(matchNum);
    if (
      !real ||
      !isMatchScorable(real) ||
      !real.winner_team_id ||
      row.team_id !== real.winner_team_id
    )
      continue;

    const scoreInput = scoreInputForIdenticalMatch(
      row,
      real,
      (() => {
        const storagePickForMatch = (num) => {
          const storage = pickStorageFor(num);
          if (!storage) return null;
          return picksByUser.get(userId)?.get(`${storage.stage}-${storage.slot}`) ?? null;
        };
        const predictedLoser = (participants, winnerId) => {
          if (!participants || !winnerId) return null;
          const [home, away] = participants;
          if (winnerId === home) return away;
          if (winnerId === away) return home;
          return null;
        };
        const participantsFor = (num) => {
          if (num >= 73 && num <= 88) {
            const spec = R32.find((slot) => slot.match === num);
            if (!spec) return null;
            const qualifiers = context.userQualifiers(userId);
            return [
              resolveR32Slot(spec.a, qualifiers, num),
              resolveR32Slot(spec.b, qualifiers, num),
            ];
          }
          if (num === 103) {
            const semi101 = participantsFor(101);
            const semi102 = participantsFor(102);
            return [
              predictedLoser(semi101, storagePickForMatch(101)),
              predictedLoser(semi102, storagePickForMatch(102)),
            ];
          }
          const sources = SOURCE_MATCHES[num];
          return sources
            ? [storagePickForMatch(sources[0]), storagePickForMatch(sources[1])]
            : null;
        };
        return participantsFor(matchNum);
      })(),
    );
    if (!scoreInput || real.home_score == null || real.away_score == null) continue;
    const scoreType = classifyScore(
      scoreInput.home_score,
      scoreInput.away_score,
      real.home_score,
      real.away_score,
    );
    if (scoreType === "exact") counters.exact += 1;
    else if (scoreType === "winnerPlusScore") counters.winnerPlusScore += 1;
    else if (scoreType === "winnerOnly") counters.winnerOnly += 1;
  }

  const champion = poolChampionRows.find((item) => item.user_id === userId);
  if (champion) {
    const { points } = expectedChampionPoints(champion, scoring, context.matchByNum);
    counters.champion = points > 0 ? 1 : 0;
  }

  return {
    counters,
    points: calculateRankingPoints(counters, scoring),
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const env = loadEnv();
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_ANON_KEY ??
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const usingServiceRole = !!env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase credentials. Set SUPABASE_URL and a Supabase key.");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const rows = {
    pools: await fetchAll(supabase, "pools", "*"),
    teams: await fetchAll(supabase, "teams", "id,name,code,group_name"),
    matches: await fetchAll(
      supabase,
      "matches",
      "id,external_id,stage,group_name,home_team_id,away_team_id,kickoff_at,home_score,away_score,winner_team_id,status",
    ),
    predictions: await fetchAll(
      supabase,
      "predictions",
      "id,user_id,match_id,home_score,away_score,points",
    ),
    brackets: await fetchAll(
      supabase,
      "bracket_predictions",
      "id,pool_id,user_id,stage,slot,team_id,home_score,away_score,points",
    ),
    champions: await fetchAll(
      supabase,
      "champion_predictions",
      "id,pool_id,user_id,team_id,points",
    ),
    members: await fetchAll(supabase, "pool_members", "pool_id,user_id,has_paid"),
    profiles: await fetchAll(supabase, "profiles", "id,display_name"),
    authUsers: await fetchAuthUsers(supabase, usingServiceRole),
  };

  const context = buildAuditContext(rows);
  const issues = [];
  const cache = {
    stale: false,
    predictions: 0,
    bracketRows: 0,
    championRows: 0,
    total: 0,
  };
  const incrementCache = (kind) => {
    cache.total += 1;
    cache.stale = true;
    if (kind === "predictions") cache.predictions += 1;
    else if (kind === "bracketRows") cache.bracketRows += 1;
    else cache.championRows += 1;
  };
  staticSourceChecks(issues);

  if (rows.pools.length === 0 || rows.matches.length === 0) {
    issue(
      issues,
      "dados-base",
      "Supabase visibility",
      `pools=${rows.pools.length}, matches=${rows.matches.length}`,
      "non-empty production data",
      usingServiceRole
        ? "The audit could not find base rows even with service-role access."
        : "The audit is running without SUPABASE_SERVICE_ROLE_KEY; RLS may be hiding production rows.",
    );
  }

  for (const match of context.missingNumberedKnockouts) {
    issue(
      issues,
      "dados-base",
      `match ${match.id}`,
      "missing match number",
      "external_id with M73-M104",
      `Could not map knockout match stage=${match.stage} to its official number.`,
    );
  }

  let checkedPredictions = 0;
  for (const pred of rows.predictions) {
    const match = context.matchById.get(pred.match_id);
    if (!match) continue;
    checkedPredictions += 1;
    const expected = scorePredictionPoints(pred, match);

    if ((pred.points ?? 0) !== expected) incrementCache("predictions");
  }

  const selectedPools = rows.pools.filter((pool) => {
    if (!args.pool) return true;
    const needle = args.pool.toLowerCase();
    return pool.id.toLowerCase().includes(needle) || pool.name.toLowerCase().includes(needle);
  });

  if (rows.pools.length > 0 && selectedPools.length === 0) {
    issue(
      issues,
      "dados-base",
      "pool filter",
      args.pool,
      "existing pool id or name",
      "No pool matched the requested --pool filter.",
    );
  }

  let checkedBracketRows = 0;
  let checkedChampionRows = 0;
  const poolSummaries = [];

  for (const pool of selectedPools) {
    const scoring = normalizeScoring(pool);
    const poolMembers = rows.members.filter((member) => member.pool_id === pool.id);
    const memberIds = new Set(poolMembers.map((member) => member.user_id));
    const poolBracketRows = rows.brackets.filter((row) => row.pool_id === pool.id);
    const poolChampionRows = rows.champions.filter((row) => row.pool_id === pool.id);
    const picksByUser = new Map();
    for (const row of poolBracketRows) {
      const picks = picksByUser.get(row.user_id) ?? new Map();
      picks.set(`${row.stage}-${row.slot}`, row.team_id);
      picksByUser.set(row.user_id, picks);
    }

    const expectedBracketTotalsByUser = new Map();
    const expectedPredictionTotalsByUser = new Map();
    for (const pred of rows.predictions) {
      const match = context.matchById.get(pred.match_id);
      if (!match) continue;
      addToMap(
        expectedPredictionTotalsByUser,
        pred.user_id,
        scorePredictionPoints(pred, match, scoring),
      );
    }

    for (const row of poolBracketRows) {
      checkedBracketRows += 1;
      const expected = expectedBracketPoints({
        row,
        pool,
        scoring,
        matchByNum: context.matchByNum,
        picksByUser,
        userQualifiers: context.userQualifiers,
      });
      addToMap(expectedBracketTotalsByUser, row.user_id, expected.points);

      if ((row.points ?? 0) !== expected.points) incrementCache("bracketRows");
    }

    const expectedChampionTotalsByUser = new Map();
    for (const row of poolChampionRows) {
      checkedChampionRows += 1;
      const expected = expectedChampionPoints(row, scoring, context.matchByNum);
      addToMap(expectedChampionTotalsByUser, row.user_id, expected.points);
      if ((row.points ?? 0) !== expected.points) incrementCache("championRows");
    }

    for (const memberId of memberIds) {
      const user = userFor(memberId, context.profilesById, context.authUsersById);
      if (!shouldIncludeUser(user, args.user)) continue;

      computeRankingForUser({
        userId: memberId,
        scoring,
        context,
        rows,
        poolBracketRows,
        poolChampionRows,
        picksByUser,
      });
      // Stored points are audited as stale cache above. The visible ranking is
      // recalculated from raw predictions, including Round-of-32 qualifier
      // points that may not have a corresponding stored bracket cache row.
    }

    poolSummaries.push({
      id: pool.id,
      name: pool.name,
      members: poolMembers.length,
      bracketRows: poolBracketRows.length,
      championRows: poolChampionRows.length,
      roundOf32Released: scoring.round_of_32_points_enabled,
    });
  }

  const result = {
    ok: issues.length === 0,
    usingServiceRole,
    checked: {
      pools: selectedPools.length,
      teams: rows.teams.length,
      matches: rows.matches.length,
      predictions: checkedPredictions,
      bracketRows: checkedBracketRows,
      championRows: checkedChampionRows,
      authUsers: rows.authUsers.length,
    },
    pools: poolSummaries,
    cache,
    issues,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTextResult(result, args.max);
  }

  return result.ok ? 0 : 1;
}

function printTextResult(result, maxIssues) {
  console.log(result.ok ? "Scoring audit PASSED" : "Scoring audit FAILED");
  console.log(
    `Checked ${result.checked.pools} pool(s), ${result.checked.matches} match(es), ${result.checked.predictions} prediction row(s), ${result.checked.bracketRows} bracket row(s), ${result.checked.championRows} champion row(s), ${result.checked.authUsers} auth user(s).`,
  );
  if (!result.usingServiceRole) {
    console.log("Warning: running without SUPABASE_SERVICE_ROLE_KEY; RLS may hide rows.");
  }
  if (result.cache?.stale) {
    console.log(
      `Stored point cache is stale in ${result.cache.total} row(s): predictions=${result.cache.predictions}, bracket=${result.cache.bracketRows}, champion=${result.cache.championRows}. User-facing scoring screens recalculate from raw data.`,
    );
  }
  for (const pool of result.pools) {
    console.log(
      `Pool: ${pool.name} (${pool.id}) | members=${pool.members} bracketRows=${pool.bracketRows} championRows=${pool.championRows} round32Released=${pool.roundOf32Released}`,
    );
  }
  if (!result.issues.length) return;

  console.log("");
  console.log(
    `Issues (${result.issues.length}, showing first ${Math.min(maxIssues, result.issues.length)}):`,
  );
  for (const item of result.issues.slice(0, maxIssues)) {
    const pool = item.pool ? `${item.pool.name}` : "global";
    const user = item.user
      ? `${item.user.name}${item.user.email ? ` <${item.user.email}>` : ""} (${item.user.id})`
      : "n/a";
    console.log(
      `- [${item.area}] ${pool} | ${user} | ${item.subject}: actual=${item.actual} expected=${item.expected} | ${item.detail}`,
    );
  }
  if (result.issues.length > maxIssues) {
    console.log(`... ${result.issues.length - maxIssues} more issue(s). Re-run with --max.`);
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
