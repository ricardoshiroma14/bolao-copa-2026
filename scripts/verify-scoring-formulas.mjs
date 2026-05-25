import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const tmp = mkdtempSync(path.join(tmpdir(), "bolao-scoring-"));

function transpile(sourcePath, outputName, rewrite = (source) => source) {
  const source = rewrite(readFileSync(sourcePath, "utf8"));
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  writeFileSync(path.join(tmp, outputName), output);
}

transpile("src/lib/round-of-32-release.ts", "round-of-32-release.mjs");
transpile("src/lib/group-standings.ts", "group-standings.mjs");
transpile("src/lib/scoring.ts", "scoring.mjs", (source) =>
  source.replace("./round-of-32-release", "./round-of-32-release.mjs"),
);

const scoring = await import(path.join(tmp, "scoring.mjs"));
const standings = await import(path.join(tmp, "group-standings.mjs"));

const {
  DEFAULT_MATCH_SCORING,
  bracketMatchNum,
  calculateRankingPoints,
  classifyPredictionScore,
  classifyScore,
  isMatchScorable,
  normalizeScoring,
  pickStorageFor,
  scoreBracketRowPoints,
  scoreInputForIdenticalMatch,
  scoreMatchPoints,
  scorePredictionPoints,
  sourceBonusForMatch,
} = scoring;
const { computeQualifiers } = standings;

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    failures.push(`${message}: expected ${expected}, got ${actual}`);
  }
}

function deepEq(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    failures.push(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

const scoringValues = DEFAULT_MATCH_SCORING;
const customScoringValues = {
  ...DEFAULT_MATCH_SCORING,
  scoring_exact: 11,
  scoring_diff: 8,
  scoring_winner: 6,
  bonus_round_of_32: 21,
  bonus_round_of_16: 31,
  bonus_quarter: 41,
  bonus_semi: 51,
  bonus_third_place: 56,
  bonus_final: 71,
  bonus_champion: 52,
  round_of_32_points_enabled: true,
};

eq(classifyScore(2, 0, 2, 0), "exact", "exact score classification");
eq(scoreMatchPoints(2, 0, 2, 0, scoringValues), 10, "exact score points");
eq(scoreMatchPoints(2, 0, 2, 0, customScoringValues), 11, "custom exact score points");
eq(classifyScore(2, 1, 2, 0), "winnerPlusScore", "winner plus one score classification");
eq(scoreMatchPoints(2, 1, 2, 0, scoringValues), 7, "winner plus one score points");
eq(scoreMatchPoints(2, 1, 2, 0, customScoringValues), 8, "custom winner plus one score points");
eq(classifyScore(3, 1, 2, 0), "winnerOnly", "winner only classification");
eq(scoreMatchPoints(3, 1, 2, 0, scoringValues), 5, "winner only points");
eq(scoreMatchPoints(3, 1, 2, 0, customScoringValues), 6, "custom winner only points");
eq(classifyScore(1, 1, 2, 0), "miss", "wrong result classification");
eq(scoreMatchPoints(1, 1, 2, 0, scoringValues), 0, "wrong result points");
eq(classifyScore(2, 2, 1, 1), "winnerOnly", "non-exact draw classification");
eq(scoreMatchPoints(2, 2, 1, 1, scoringValues), 5, "non-exact draw points");
eq(
  isMatchScorable({ status: "scheduled", home_score: 2, away_score: 0 }),
  false,
  "scheduled match with scores is not scorable",
);
eq(
  classifyPredictionScore(
    { home_score: 2, away_score: 0 },
    { status: "scheduled", home_score: 2, away_score: 0 },
  ),
  null,
  "scheduled prediction does not classify",
);
eq(
  scorePredictionPoints(
    { home_score: 2, away_score: 0 },
    { status: "scheduled", home_score: 2, away_score: 0 },
    scoringValues,
  ),
  0,
  "scheduled match with scores stores zero points",
);
eq(
  scorePredictionPoints(
    { home_score: 2, away_score: 0 },
    { status: "live", home_score: 2, away_score: 0 },
    scoringValues,
  ),
  10,
  "live match with scores is scorable",
);

eq(normalizeScoring(null).round_of_32_points_enabled, false, "R32 default disabled");
eq(
  normalizeScoring({ round_of_32_points_enabled: true }).round_of_32_points_enabled,
  true,
  "R32 explicit enabled",
);
eq(
  normalizeScoring({ bonus_round_of_32_wrong: 1 }).round_of_32_points_enabled,
  true,
  "R32 legacy fallback enabled",
);
eq(
  normalizeScoring({ bonus_round_of_32_wrong: 15 }).round_of_32_points_enabled,
  false,
  "R32 legacy fallback disabled",
);

eq(sourceBonusForMatch(73, scoringValues), 20, "R32 source bonus");
eq(sourceBonusForMatch(89, scoringValues), 30, "R16 source bonus");
eq(sourceBonusForMatch(97, scoringValues), 40, "quarter source bonus");
eq(sourceBonusForMatch(101, scoringValues), 50, "semi source bonus M101");
eq(sourceBonusForMatch(102, scoringValues), 50, "semi source bonus M102");
eq(sourceBonusForMatch(103, scoringValues), 55, "third-place source bonus");
eq(sourceBonusForMatch(104, scoringValues), 70, "finalist source bonus");

eq(bracketMatchNum("round_of_16", 0), 73, "R32 storage slot maps to M73");
eq(bracketMatchNum("quarter", 0), 89, "R16 storage slot maps to M89");
eq(bracketMatchNum("semi", 0), 97, "quarter storage slot maps to M97");
eq(bracketMatchNum("final", 0), 101, "semi winner slot maps to M101");
eq(bracketMatchNum("final", 2), 104, "final score slot maps to M104");
eq(bracketMatchNum("third_place", 1), 103, "third-place row maps to M103");
deepEq(pickStorageFor(104), { stage: "final", slot: 2 }, "M104 storage lookup");

const realAB = {
  home_team_id: "A",
  away_team_id: "B",
  home_score: 2,
  away_score: 1,
  winner_team_id: "A",
  status: "finished",
};

deepEq(
  scoreInputForIdenticalMatch({ home_score: 2, away_score: 1 }, realAB, ["A", "B"]),
  { home_score: 2, away_score: 1 },
  "identical matchup keeps score orientation",
);
deepEq(
  scoreInputForIdenticalMatch({ home_score: 1, away_score: 2 }, realAB, ["B", "A"]),
  { home_score: 2, away_score: 1 },
  "flipped identical matchup swaps score orientation",
);
eq(
  scoreInputForIdenticalMatch({ home_score: 0, away_score: 3 }, realAB, ["C", "B"]),
  null,
  "non-identical matchup suppresses score bonus",
);

let breakdown = scoreBracketRowPoints({
  matchNum: 73,
  pick: { team_id: "A", home_score: 2, away_score: 1 },
  real: realAB,
  predictedParticipants: ["A", "B"],
  sourceHits: 2,
  scoring: scoringValues,
});
deepEq(
  breakdown,
  { sourcePoints: 0, scorePoints: 0, total: 0, roundOf32Suppressed: true },
  "R32 points suppressed until release",
);

breakdown = scoreBracketRowPoints({
  matchNum: 73,
  pick: { team_id: "A", home_score: 2, away_score: 1 },
  real: realAB,
  predictedParticipants: ["A", "B"],
  sourceHits: 2,
  scoring: { ...scoringValues, round_of_32_points_enabled: true },
});
deepEq(
  breakdown,
  { sourcePoints: 40, scorePoints: 10, total: 50, roundOf32Suppressed: false },
  "released R32 applies source and exact-score points",
);

const realThirdPlace = {
  home_team_id: "FRA",
  away_team_id: "ESP",
  home_score: 1,
  away_score: 2,
  winner_team_id: "ESP",
  status: "finished",
};

breakdown = scoreBracketRowPoints({
  matchNum: 103,
  pick: { team_id: "ESP", home_score: 0, away_score: 3 },
  real: realThirdPlace,
  predictedParticipants: ["BEL", "ESP"],
  sourceHits: 1,
  scoring: scoringValues,
});
deepEq(
  breakdown,
  { sourcePoints: 55, scorePoints: 0, total: 55, roundOf32Suppressed: false },
  "non-identical M103 with correct winner keeps source bonus but suppresses score bonus",
);

const realFinal = {
  home_team_id: "ARG",
  away_team_id: "BRA",
  home_score: 0,
  away_score: 1,
  winner_team_id: "BRA",
  status: "finished",
};

breakdown = scoreBracketRowPoints({
  matchNum: 104,
  pick: { team_id: "BRA", home_score: 1, away_score: 5 },
  real: realFinal,
  predictedParticipants: ["POR", "BRA"],
  sourceHits: 1,
  scoring: scoringValues,
});
deepEq(
  breakdown,
  { sourcePoints: 70, scorePoints: 0, total: 70, roundOf32Suppressed: false },
  "non-identical final with correct winner keeps finalist source but suppresses score bonus",
);

breakdown = scoreBracketRowPoints({
  matchNum: 104,
  pick: { team_id: "A", home_score: 1, away_score: 2 },
  real: realAB,
  predictedParticipants: ["B", "A"],
  sourceHits: 2,
  scoring: scoringValues,
});
deepEq(
  breakdown,
  { sourcePoints: 140, scorePoints: 10, total: 150, roundOf32Suppressed: false },
  "flipped identical final applies finalist source and exact score bonus",
);

breakdown = scoreBracketRowPoints({
  matchNum: 104,
  pick: { team_id: "A", home_score: 1, away_score: 2 },
  real: { ...realAB, status: "scheduled" },
  predictedParticipants: ["B", "A"],
  sourceHits: 2,
  scoring: scoringValues,
});
deepEq(
  breakdown,
  { sourcePoints: 140, scorePoints: 0, total: 140, roundOf32Suppressed: false },
  "scheduled knockout match keeps source bonus but suppresses score bonus",
);

eq(
  calculateRankingPoints(
    {
      exact: 1,
      winnerPlusScore: 1,
      winnerOnly: 1,
      qual32: 8,
      r32: 2,
      r16: 2,
      sf: 1,
      third: 1,
      final: 2,
      champion: 1,
    },
    scoringValues,
  ),
  10 + 7 + 5 + 0 + 2 * 30 + 2 * 40 + 50 + 55 + 2 * 70 + 50,
  "ranking total with R32 disabled",
);

eq(
  calculateRankingPoints(
    {
      exact: 1,
      winnerPlusScore: 1,
      winnerOnly: 1,
      qual32: 8,
      r32: 2,
      r16: 2,
      sf: 1,
      third: 1,
      final: 2,
      champion: 1,
    },
    customScoringValues,
  ),
  11 + 8 + 6 + 8 * 21 + 2 * 31 + 2 * 41 + 51 + 56 + 2 * 71 + 52,
  "ranking total with custom scoring and R32 enabled",
);

const headToHeadTeams = ["A1", "A2", "A3", "A4"].map((id) => ({
  id,
  name: id,
  code: id,
  group_name: "A",
}));
const headToHeadMatches = [
  ["m1", "A1", "A2"],
  ["m2", "A1", "A3"],
  ["m3", "A1", "A4"],
  ["m4", "A2", "A3"],
  ["m5", "A2", "A4"],
  ["m6", "A3", "A4"],
].map(([id, home, away]) => ({
  id,
  stage: "group",
  group_name: "A",
  home_team_id: home,
  away_team_id: away,
}));
const headToHeadPreds = [
  ["m1", 1, 0],
  ["m2", 0, 2],
  ["m3", 0, 0],
  ["m4", 2, 0],
  ["m5", 0, 0],
  ["m6", 0, 0],
].map(([match_id, home_score, away_score]) => ({ match_id, home_score, away_score }));
const headToHeadQualifiers = computeQualifiers(headToHeadTeams, headToHeadMatches, headToHeadPreds);
deepEq(
  headToHeadQualifiers.byGroup.A.map((row) => row.team.id),
  ["A2", "A3", "A1", "A4"],
  "group standings use head-to-head mini-table before overall fallback",
);

const thirdPlaceGroups = "ABCDEFGHIJKL".split("");
const thirdPlaceTeams = thirdPlaceGroups.flatMap((group) =>
  [1, 2, 3, 4].map((slot) => ({
    id: `${group}${slot}`,
    name: `${group}${slot}`,
    code: `${group}${slot}`,
    group_name: group,
  })),
);
const thirdPlaceQualifiers = computeQualifiers(thirdPlaceTeams, [], []);
deepEq(
  thirdPlaceQualifiers.thirds.map((row) => row.team.id),
  ["A3", "B3", "C3", "D3", "E3", "F3", "G3", "H3"],
  "best third-place selection keeps exactly eight teams in deterministic order",
);

check(failures.length === 0, "scoring formula regression suite completed");

if (failures.length) {
  console.error("Scoring formula verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Scoring formula verification passed.");
