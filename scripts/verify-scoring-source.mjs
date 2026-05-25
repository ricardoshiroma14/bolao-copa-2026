import { readFileSync } from "node:fs";

const userFacingFiles = [
  "src/components/pool/MatchesTab.tsx",
  "src/components/pool/ParticipantDetailsDialog.tsx",
  "src/components/pool/RankingTab.tsx",
];

const bracketFormulaFiles = [
  "scripts/audit-scoring.mjs",
  "src/components/pool/MatchesTab.tsx",
  "src/lib/client-scoring-audit.ts",
  "supabase/functions/audit-scoring/index.ts",
  "supabase/functions/score-predictions/index.ts",
];

const matchPredictionFormulaFiles = [
  "scripts/audit-scoring.mjs",
  "src/components/pool/MatchesTab.tsx",
  "src/components/pool/RankingTab.tsx",
  "src/lib/client-scoring-audit.ts",
  "supabase/functions/audit-scoring/index.ts",
  "supabase/functions/score-predictions/index.ts",
];

const groupFormulaFiles = [
  "scripts/audit-scoring.mjs",
  "supabase/functions/audit-scoring/index.ts",
  "supabase/functions/score-predictions/index.ts",
];

const failures = [];

function forbidStoredPointSelects(file, text) {
  const scoringTables = ["predictions", "bracket_predictions", "champion_predictions"];
  for (const table of scoringTables) {
    const tableSelectPattern = new RegExp(
      `\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)[\\s\\S]{0,240}?\\.select\\(\\s*([\\s\\S]{0,320}?)\\)`,
      "g",
    );
    for (const match of text.matchAll(tableSelectPattern)) {
      const selectArg = match[1];
      if (/["'`][^"'`]*\*[^"'`]*["'`]/.test(selectArg)) {
        failures.push(
          `${file}: user-facing ${table} query must select explicit raw columns, not wildcard columns`,
        );
      }
      if (/["'`][^"'`]*\bpoints\b[^"'`]*["'`]/.test(selectArg)) {
        failures.push(
          `${file}: user-facing ${table} query must not select stored points; calculate from raw picks and official results`,
        );
      }
    }
  }
}

for (const file of userFacingFiles) {
  const text = readFileSync(file, "utf8");

  if (!text.includes("@/lib/scoring")) {
    failures.push(`${file}: must import shared scoring helpers from src/lib/scoring.ts`);
  }

  const forbiddenFormulaCopies = [
    /function\s+scoreMatchPoints\b/,
    /function\s+sourceBonusForMatch\b/,
    /function\s+scoreInputForIdenticalMatch\b/,
    /function\s+bracketMatchNum\b/,
    /Math\.sign\([^)]*\)\s*!==\s*Math\.sign/,
  ];
  for (const pattern of forbiddenFormulaCopies) {
    if (pattern.test(text)) {
      failures.push(
        `${file}: duplicates scoring formula logic instead of using src/lib/scoring.ts`,
      );
    }
  }

  forbidStoredPointSelects(file, text);
}

for (const file of bracketFormulaFiles) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("scoreBracketRowPoints")) {
    failures.push(`${file}: must use shared scoreBracketRowPoints helper`);
  }
}

for (const file of matchPredictionFormulaFiles) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("scorePredictionPoints") && !text.includes("classifyPredictionScore")) {
    failures.push(`${file}: must use shared match-prediction scoring/status helper`);
  }
}

for (const file of [
  "scripts/audit-scoring.mjs",
  "src/components/pool/RankingTab.tsx",
  "src/lib/client-scoring-audit.ts",
  "supabase/functions/audit-scoring/index.ts",
]) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("isMatchScorable(real)")) {
    failures.push(
      `${file}: knockout PE / VC+PE / VCPI ranking counters must check official match status before counting score hits`,
    );
  }
}

const participantDetailsText = readFileSync(
  "src/components/pool/ParticipantDetailsDialog.tsx",
  "utf8",
);
if (
  !/function\s+scoreOnlyPoints[\s\S]*?isMatchScorable\(realMatch\)/.test(participantDetailsText)
) {
  failures.push(
    "src/components/pool/ParticipantDetailsDialog.tsx: score-only details points must check official match status before displaying PE / VC+PE / VCPI",
  );
}

for (const file of groupFormulaFiles) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("src/lib/group-standings") && !text.includes("group-standings.mjs")) {
    failures.push(`${file}: must use shared group standings and qualifier helper`);
  }
  const forbiddenGroupCopies = [
    /function\s+buildStandings\b/,
    /function\s+sortGroup\b/,
    /function\s+resolveTiedCluster\b/,
    /function\s+computeQualifiers\b/,
    /function\s+compareOverall\b/,
    /function\s+cmpOverall\b/,
    /function\s+emptyStanding\b/,
    /function\s+emptyRow\b/,
  ];
  for (const pattern of forbiddenGroupCopies) {
    if (pattern.test(text)) {
      failures.push(`${file}: must import shared group standings formulas, not copy them`);
      break;
    }
  }
}

const auditText = readFileSync("scripts/audit-scoring.mjs", "utf8");
const forbiddenAuditCopies = [
  /^const\s+DEFAULT_SCORING\s*=/m,
  /^const\s+SOURCE_MATCHES\s*=/m,
  /function\s+scoreMatch\b/,
  /function\s+classifyScore\b/,
  /function\s+sourceBonusForMatch\b/,
  /function\s+scoreInputForIdenticalMatch\b/,
  /function\s+bracketMatchNum\b/,
  /function\s+pickStorageFor\b/,
  /function\s+normalizeScoring\b/,
  /function\s+calculateRankingPoints\b/,
  /function\s+buildStandings\b/,
  /function\s+sortGroup\b/,
  /function\s+resolveTiedCluster\b/,
  /function\s+computeQualifiers\b/,
  /function\s+compareOverall\b/,
  /function\s+emptyStanding\b/,
];
for (const pattern of forbiddenAuditCopies) {
  if (pattern.test(auditText)) {
    failures.push("scripts/audit-scoring.mjs: must import shared scoring formulas, not copy them");
    break;
  }
}

const adminRouteText = readFileSync("src/routes/admin.tsx", "utf8");
const rankingTabText = readFileSync("src/components/pool/RankingTab.tsx", "utf8");
const syncMatchesText = readFileSync("supabase/functions/sync-matches/index.ts", "utf8");
const edgeAuditText = readFileSync("supabase/functions/audit-scoring/index.ts", "utf8");
const clientAuditText = readFileSync("src/lib/client-scoring-audit.ts", "utf8");
for (const [file, text] of [
  ["scripts/audit-scoring.mjs", auditText],
  ["src/lib/client-scoring-audit.ts", clientAuditText],
  ["supabase/functions/audit-scoring/index.ts", edgeAuditText],
]) {
  if (text.includes('"ranking-vs-formula"') || text.includes('"ranking total"')) {
    failures.push(`${file}: audit must not compare visible ranking to stored point-cache totals`);
  }
}
if (!adminRouteText.includes("data.scoring?.predictions")) {
  failures.push("src/routes/admin.tsx: sync action must surface scoring returned by sync-matches");
}
if (!adminRouteText.includes("data.scoring?.champions")) {
  failures.push(
    "src/routes/admin.tsx: sync action must surface champion scoring returned by sync-matches",
  );
}
const syncUpsertIndex = syncMatchesText.indexOf(".upsert(matchRows");
const syncScoreIndex = syncMatchesText.indexOf(
  'functions.invoke<ScorePredictionsResult>("score-predictions"',
);
if (syncScoreIndex === -1) {
  failures.push(
    "supabase/functions/sync-matches/index.ts: sync-matches must invoke score-predictions after match updates to avoid stale points",
  );
}
if (syncUpsertIndex === -1 || syncScoreIndex === -1 || syncUpsertIndex > syncScoreIndex) {
  failures.push(
    "supabase/functions/sync-matches/index.ts: score-predictions must run after matchRows upsert",
  );
}
if (
  !syncMatchesText.includes("headers: { Authorization: scoringAuthorization }") ||
  !syncMatchesText.includes("`Bearer ${serviceKey}`")
) {
  failures.push(
    "supabase/functions/sync-matches/index.ts: score-predictions invoke must forward admin auth or service-role auth for cron",
  );
}
const scorePredictionsText = readFileSync("supabase/functions/score-predictions/index.ts", "utf8");
const bracketMatchNumberText = readFileSync("src/lib/bracket-match-number.ts", "utf8");
for (const table of ["pools", "bracket_predictions", "champion_predictions"]) {
  const wildcardPattern = new RegExp(
    `\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)[\\s\\S]{0,160}?\\.select\\(\\s*["'\`]\\*["'\`]\\s*\\)`,
  );
  if (wildcardPattern.test(scorePredictionsText)) {
    failures.push(
      `supabase/functions/score-predictions/index.ts: ${table} query must select explicit columns used by scoring`,
    );
  }
}
if (
  !/\.from\(\s*["'`]matches["'`]\s*\)[\s\S]{0,260}\.eq\(\s*["'`]stage["'`]\s*,\s*["'`]final["'`]\s*\)[\s\S]{0,260}\.order\(\s*["'`]kickoff_at["'`]\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)[\s\S]{0,120}\.limit\(\s*1\s*\)[\s\S]{0,120}\.maybeSingle\(\s*\)/.test(
    scorePredictionsText,
  )
) {
  failures.push(
    "supabase/functions/score-predictions/index.ts: final champion lookup must use latest finished final with deterministic ordering",
  );
}
if (
  !scorePredictionsText.includes("src/lib/bracket-match-number.ts") ||
  !scorePredictionsText.includes("matchNumberFromRealMatch")
) {
  failures.push(
    "supabase/functions/score-predictions/index.ts: must use the shared knockout match-number resolver",
  );
}
if (
  !rankingTabText.includes("@/lib/bracket-match-number") ||
  !rankingTabText.includes("matchNumberFromRealMatch")
) {
  failures.push(
    "src/components/pool/RankingTab.tsx: must use the shared knockout match-number resolver",
  );
}
if (
  !bracketMatchNumberText.includes("BRACKET_SCHEDULE") ||
  !bracketMatchNumberText.includes("stageMatches.length === 1") ||
  !bracketMatchNumberText.includes("external_id")
) {
  failures.push(
    "src/lib/bracket-match-number.ts: shared knockout match resolver must handle external_id, unique-stage, and schedule fallback",
  );
}
if (
  /counters\.champion\s*=\s*\(?champion\.points\s*\?\?\s*0\)?\s*>\s*0\s*\?\s*1\s*:\s*0/.test(
    edgeAuditText,
  )
) {
  failures.push(
    "supabase/functions/audit-scoring/index.ts: ranking champion counter must be recalculated from formula, not stored champion.points",
  );
}

if (failures.length) {
  console.error("Scoring source verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Scoring source verification passed.");
