import { readFileSync } from "node:fs";

const failures = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function includesAll(source, path, markers) {
  for (const marker of markers) {
    check(source.includes(marker), `${path}: missing ${marker}`);
  }
}

function rejects(pattern, source, path, message) {
  check(!pattern.test(source), `${path}: ${message}`);
}

const hardeningMigrationPath =
  "supabase/migrations/20260522234500_harden_pool_membership_and_points.sql";
const hardeningMigration = read(hardeningMigrationPath);

includesAll(hardeningMigration, hardeningMigrationPath, [
  'DROP POLICY IF EXISTS "User joins pool" ON public.pool_members',
  "CREATE OR REPLACE FUNCTION public.join_pool_by_invite_code",
  "GRANT EXECUTE ON FUNCTION public.join_pool_by_invite_code(TEXT) TO authenticated",
  "CREATE OR REPLACE FUNCTION public.prevent_participant_point_tampering",
  "CREATE OR REPLACE FUNCTION public.handle_new_user",
  "CREATE TRIGGER prevent_predictions_points_insert",
  "CREATE TRIGGER prevent_predictions_points_update",
  "CREATE TRIGGER prevent_bracket_predictions_points_insert",
  "CREATE TRIGGER prevent_bracket_predictions_points_update",
  "CREATE TRIGGER prevent_champion_predictions_points_insert",
  "CREATE TRIGGER prevent_champion_predictions_points_update",
]);

rejects(
  /_default_pool|Auto-join/i,
  hardeningMigration,
  hardeningMigrationPath,
  "must not reintroduce default-pool auto-join",
);

for (const table of ["predictions", "bracket_predictions", "champion_predictions"]) {
  check(
    hardeningMigration.includes(`ON public.${table}`),
    `${hardeningMigrationPath}: missing point trigger coverage for ${table}`,
  );
}

for (const path of ["src/lib/redirect-to-pool.ts", "src/routes/dashboard.tsx"]) {
  const source = read(path);
  rejects(
    /\.from\(["'`]pool_members["'`]\)[\s\S]*\.(insert|upsert)\s*\(/,
    source,
    path,
    "must not create pool_members rows directly from the browser",
  );
}

const dashboard = read("src/routes/dashboard.tsx");
includesAll(dashboard, "src/routes/dashboard.tsx", ["join_pool_by_invite_code", "_invite_code"]);

const clientAudit = read("src/lib/client-scoring-audit.ts");
rejects(
  /\.from\(["'`](predictions|bracket_predictions|champion_predictions)["'`]\)[\s\S]*\.update\(\s*\{\s*points\b/,
  clientAudit,
  "src/lib/client-scoring-audit.ts",
  "must not repair stored points with a browser Supabase session",
);
rejects(
  /refreshStoredScoringCache/,
  clientAudit,
  "src/lib/client-scoring-audit.ts",
  "must not expose a client-side stored-points repair helper",
);

const adminRoute = read("src/routes/admin.tsx");
rejects(
  /refreshStoredScoringCache/,
  adminRoute,
  "src/routes/admin.tsx",
  "must not fall back to client-side point repair",
);

const sharedAdminAuthPath = "supabase/functions/_shared/admin-auth.ts";
const sharedAdminAuth = read(sharedAdminAuthPath);
includesAll(sharedAdminAuth, sharedAdminAuthPath, [
  "export class AdminAuthError",
  "export async function requireAdmin",
  "supabase.auth.getUser(token)",
  '.eq("role", "admin")',
]);

const scorePredictionsPath = "supabase/functions/score-predictions/index.ts";
const scorePredictions = read(scorePredictionsPath);
includesAll(scorePredictions, scorePredictionsPath, [
  'import { AdminAuthError, requireAdmin } from "../_shared/admin-auth.ts"',
  "await requireAdmin(req)",
  "e instanceof AdminAuthError ? e.status : 500",
]);
const authIndex = scorePredictions.indexOf("await requireAdmin(req)");
const serviceClientIndex = scorePredictions.indexOf("const supabase = createClient");
check(
  authIndex !== -1 && serviceClientIndex !== -1 && authIndex < serviceClientIndex,
  `${scorePredictionsPath}: must authorize admin before creating the service-role client`,
);

const syncMatchesPath = "supabase/functions/sync-matches/index.ts";
const syncMatches = read(syncMatchesPath);
includesAll(syncMatches, syncMatchesPath, [
  'import { AdminAuthError, requireAdmin } from "../_shared/admin-auth.ts"',
  "async function requireAdminOrCron",
  "isCronRequest(req)",
  "await requireAdmin(req)",
  "const authMode = await requireAdminOrCron(req)",
  'functions.invoke<ScorePredictionsResult>("score-predictions"',
  'const scoringAuthorization = authMode === "cron" ? `Bearer ${serviceKey}` : authorization',
  "headers: { Authorization: scoringAuthorization }",
]);
const syncAuthIndex = syncMatches.indexOf("const authMode = await requireAdminOrCron(req)");
const syncServiceClientIndex = syncMatches.indexOf("const supabase = createClient");
const syncScoreIndex = syncMatches.indexOf(
  'functions.invoke<ScorePredictionsResult>("score-predictions"',
);
check(
  syncAuthIndex !== -1 && syncServiceClientIndex !== -1 && syncAuthIndex < syncServiceClientIndex,
  `${syncMatchesPath}: must authorize admin before creating the service-role client`,
);
check(
  syncScoreIndex !== -1 && syncMatches.indexOf(".upsert(matchRows") < syncScoreIndex,
  `${syncMatchesPath}: must invoke score-predictions after upserting matches`,
);

if (failures.length) {
  console.error("Security regression checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Security regression checks passed.");
