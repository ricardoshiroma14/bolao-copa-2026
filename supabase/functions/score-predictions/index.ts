// Recalculate prediction points for all finished matches and bracket/champion picks
// using the official pool scoring rules.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MatchScoringCfg = {
  scoring_exact: number;
  scoring_diff: number;
  scoring_winner: number;
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
};

type TeamLite = { id: string; name: string; code: string; group_name: string | null };
type MatchLite = {
  id: string;
  stage: string;
  group_name: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};
type PredLite = { match_id: string; home_score: number; away_score: number };

type StandRow = {
  team: TeamLite;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
};

function emptyRow(team: TeamLite): StandRow {
  return { team, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

function buildStandings(teams: TeamLite[], matches: MatchLite[], preds: PredLite[]): StandRow[] {
  const byId = new Map<string, StandRow>();
  teams.forEach((t) => byId.set(t.id, emptyRow(t)));
  const predBy = new Map(preds.map((p) => [p.match_id, p]));
  for (const m of matches) {
    if (!m.home_team_id || !m.away_team_id) continue;
    const p = predBy.get(m.id);
    if (!p) continue;
    const h = byId.get(m.home_team_id);
    const a = byId.get(m.away_team_id);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.gf += p.home_score;
    h.ga += p.away_score;
    a.gf += p.away_score;
    a.ga += p.home_score;
    if (p.home_score > p.away_score) {
      h.wins++;
      h.points += 3;
      a.losses++;
    } else if (p.home_score < p.away_score) {
      a.wins++;
      a.points += 3;
      h.losses++;
    } else {
      h.draws++;
      a.draws++;
      h.points++;
      a.points++;
    }
  }
  byId.forEach((r) => {
    r.gd = r.gf - r.ga;
  });
  return Array.from(byId.values());
}

function cmpOverall(a: StandRow, b: StandRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.team.name.localeCompare(b.team.name);
}

function sortGroup(rows: StandRow[], groupMatches: MatchLite[], preds: PredLite[]): StandRow[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  const result: StandRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].points === sorted[i].points) j++;
    const cluster = sorted.slice(i, j);
    if (cluster.length === 1) result.push(cluster[0]);
    else {
      const ids = new Set(cluster.map((r) => r.team.id));
      const subMatches = groupMatches.filter(
        (m) =>
          m.home_team_id && m.away_team_id && ids.has(m.home_team_id) && ids.has(m.away_team_id),
      );
      const mini = buildStandings(
        cluster.map((r) => r.team),
        subMatches,
        preds,
      );
      const miniById = new Map(mini.map((m) => [m.team.id, m]));
      result.push(
        ...[...cluster].sort((a, b) => {
          const ma = miniById.get(a.team.id)!;
          const mb = miniById.get(b.team.id)!;
          if (mb.points !== ma.points) return mb.points - ma.points;
          if (mb.gd !== ma.gd) return mb.gd - ma.gd;
          if (mb.gf !== ma.gf) return mb.gf - ma.gf;
          return cmpOverall(a, b);
        }),
      );
    }
    i = j;
  }
  return result;
}

function computeQualifiedIds(
  teams: TeamLite[],
  matches: MatchLite[],
  preds: PredLite[],
): Set<string> {
  const groupNames = Array.from(
    new Set(teams.map((t) => t.group_name).filter((g): g is string => !!g)),
  ).sort();
  const ids = new Set<string>();
  const thirdsRaw: StandRow[] = [];
  for (const g of groupNames) {
    const groupTeams = teams.filter((t) => t.group_name === g);
    const groupMatches = matches.filter((m) => m.stage === "group" && m.group_name === g);
    const rows = sortGroup(buildStandings(groupTeams, groupMatches, preds), groupMatches, preds);
    if (rows[0]) ids.add(rows[0].team.id);
    if (rows[1]) ids.add(rows[1].team.id);
    if (rows[2]) thirdsRaw.push(rows[2]);
  }
  thirdsRaw
    .sort(cmpOverall)
    .slice(0, 8)
    .forEach((r) => ids.add(r.team.id));
  return ids;
}

/**
 * Match scoring (per official rules):
 *  - Exact score                        → 10
 *  - Right winner AND one of the scores → 7
 *  - Only winner / draw (non-exact)     → 5
 *  - Otherwise                          → 0
 */
function scoreMatch(
  predH: number,
  predA: number,
  realH: number,
  realA: number,
  cfg: MatchScoringCfg,
): number {
  if (predH === realH && predA === realA) return cfg.scoring_exact;
  const predWinner = Math.sign(predH - predA);
  const realWinner = Math.sign(realH - realA);
  if (predWinner !== realWinner) return 0;
  if (predH === realH || predA === realA) return cfg.scoring_diff;
  return cfg.scoring_winner;
}

// Bracket source map — which two match numbers feed into target match number.
// For 73-88 (R32) sources are group qualifiers (handled separately).
// For 103 (3rd place) sources are losers of 101 / 102 (special).
const SOURCE_MATCHES: Record<number, [number, number]> = {
  89: [74, 77],
  90: [73, 75],
  91: [76, 78],
  92: [79, 80],
  93: [83, 84],
  94: [81, 82],
  95: [86, 88],
  96: [85, 87],
  97: [89, 90],
  98: [93, 94],
  99: [91, 92],
  100: [95, 96],
  101: [97, 98],
  102: [99, 100],
  104: [101, 102],
};

function bracketMatchNum(stage: string, slot: number): number | null {
  if (stage === "round_of_16") return 73 + slot;
  if (stage === "quarter") return 89 + slot;
  if (stage === "semi") return 97 + slot;
  if (stage === "final") {
    if (slot === 0) return 101;
    if (slot === 1) return 102;
    if (slot === 2) return 104;
  }
  if (stage === "third_place" && (slot === 0 || slot === 1)) return 103;
  return null;
}

// Which storage stage/slot corresponds to "user's pick for the winner of matchN"?
function pickStorageFor(matchNum: number): { stage: string; slot: number } | null {
  if (matchNum >= 73 && matchNum <= 88) return { stage: "round_of_16", slot: matchNum - 73 };
  if (matchNum >= 89 && matchNum <= 96) return { stage: "quarter", slot: matchNum - 89 };
  if (matchNum >= 97 && matchNum <= 100) return { stage: "semi", slot: matchNum - 97 };
  if (matchNum === 101) return { stage: "final", slot: 0 };
  if (matchNum === 102) return { stage: "final", slot: 1 };
  if (matchNum === 104) return { stage: "final", slot: 2 };
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pools } = await supabase.from("pools").select("*");
    if (!pools?.length) return ok({ predictions: 0, brackets: 0 });

    const defaultCfg: MatchScoringCfg = {
      scoring_exact: 10,
      scoring_diff: 7,
      scoring_winner: 5,
    };

    // ----- Match (group + knockout) prediction scoring -----
    const { data: finishedMatches } = await supabase
      .from("matches")
      .select("id, home_score, away_score, stage, status")
      .not("home_score", "is", null)
      .not("away_score", "is", null);

    let predUpdates = 0;
    for (const m of (finishedMatches ?? []) as MatchRow[]) {
      if (m.home_score == null || m.away_score == null) continue;
      const { data: preds } = await supabase
        .from("predictions")
        .select("id, home_score, away_score")
        .eq("match_id", m.id);
      for (const p of (preds ?? []) as MatchScoreRow[]) {
        const pts = scoreMatch(
          p.home_score!,
          p.away_score!,
          m.home_score,
          m.away_score,
          defaultCfg,
        );
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
        "id, external_id, stage, group_name, home_team_id, away_team_id, home_score, away_score, winner_team_id",
      );
    type RealMatch = {
      id: string;
      external_id: string | null;
      stage: string;
      group_name: string | null;
      home_team_id: string | null;
      away_team_id: string | null;
      home_score: number | null;
      away_score: number | null;
      winner_team_id: string | null;
    };
    const allMatches = (allMatchesData ?? []) as RealMatch[];

    const matchByNum = new Map<number, RealMatch>();
    for (const mm of allMatches) {
      // external_id format: "wc2026-m73" — extract trailing match number after the last 'm'
      const match = mm.external_id ? String(mm.external_id).match(/m(\d{2,3})\b/i) : null;
      const num = match ? parseInt(match[1], 10) : NaN;
      if (Number.isFinite(num)) matchByNum.set(num, mm);
    }
    const groupMatches = allMatches.filter((m) => m.stage === "group");

    function loserOf(matchNum: number): string | null {
      const real = matchByNum.get(matchNum);
      if (!real || !real.winner_team_id) return null;
      if (real.winner_team_id === real.home_team_id) return real.away_team_id;
      if (real.winner_team_id === real.away_team_id) return real.home_team_id;
      return null;
    }

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
    function getUserQualifiers(userId: string): Set<string> {
      let s = userQualifiersCache.get(userId);
      if (s) return s;
      const ups = predsByUser.get(userId) ?? [];
      s = computeQualifiedIds(teams, groupMatches, ups);
      userQualifiersCache.set(userId, s);
      return s;
    }

    let bracketUpdates = 0;
    for (const pool of pools) {
      const sourceBonusForMatch = (matchNum: number): number => {
        if (matchNum >= 73 && matchNum <= 88) return pool.bonus_round_of_32 ?? 0;
        if (matchNum >= 89 && matchNum <= 96) return pool.bonus_round_of_16 ?? 0;
        if (matchNum >= 97 && matchNum <= 100) return pool.bonus_quarter ?? 0;
        if (matchNum === 101 || matchNum === 102) return pool.bonus_semi ?? 0;
        if (matchNum === 103) return pool.bonus_third_place ?? 0;
        if (matchNum === 104) return pool.bonus_final ?? 0;
        return 0;
      };

      // Per-user lookup of bracket picks → keyed by `${stage}-${slot}` → team_id
      const { data: brackets } = await supabase
        .from("bracket_predictions")
        .select("*")
        .eq("pool_id", pool.id);

      const picksByUser = new Map<string, Map<string, string | null>>();
      for (const b of brackets ?? []) {
        const m = picksByUser.get(b.user_id) ?? new Map<string, string | null>();
        m.set(`${b.stage}-${b.slot}`, b.team_id);
        picksByUser.set(b.user_id, m);
      }
      const userPickForMatch = (userId: string, matchNum: number): string | null => {
        const sto = pickStorageFor(matchNum);
        if (!sto) return null;
        return picksByUser.get(userId)?.get(`${sto.stage}-${sto.slot}`) ?? null;
      };

      for (const b of brackets ?? []) {
        let pts = 0;
        const matchNum = bracketMatchNum(b.stage, b.slot);
        const real = matchNum != null ? matchByNum.get(matchNum) : undefined;

        if (matchNum != null && real) {
          const bonus = sourceBonusForMatch(matchNum);

          if (matchNum === 103) {
            // 3rd place: each slot row independently — check if pick matches one of
            // the two real teams in M103 (which are the losers of M101/M102).
            if (b.team_id) {
              const realTeams = new Set(
                [real.home_team_id, real.away_team_id].filter(Boolean) as string[],
              );
              if (realTeams.has(b.team_id)) pts += bonus;
            }
          } else if (matchNum >= 73 && matchNum <= 88) {
            // R32: source is groups → count real teams in user's qualifier set.
            const qualSet = getUserQualifiers(b.user_id);
            if (real.home_team_id && qualSet.has(real.home_team_id)) pts += bonus;
            if (real.away_team_id && qualSet.has(real.away_team_id)) pts += bonus;
          } else {
            // R16, QF, SF, Final: source = 2 previous match winners.
            const srcs = SOURCE_MATCHES[matchNum];
            if (srcs && real.home_team_id && real.away_team_id) {
              const [srcA, srcB] = srcs;
              // The home team of `real` came from srcA, away from srcB
              // (bracket spec order is preserved when admin fills R16/QF/SF/Final
              //  via the bracket structure). Check user's picks for both source matches.
              const pickA = userPickForMatch(b.user_id, srcA);
              const pickB = userPickForMatch(b.user_id, srcB);
              if (pickA && (pickA === real.home_team_id || pickA === real.away_team_id)) {
                pts += bonus;
              }
              if (pickB && (pickB === real.home_team_id || pickB === real.away_team_id)) {
                pts += bonus;
              }
            }
          }

          // Score (placar exato/VC+PE/VCPI) bonus — only when winner pick is correct
          // and the user provided scores on the bracket row.
          if (
            b.team_id &&
            real.winner_team_id &&
            real.winner_team_id === b.team_id &&
            real.home_score != null &&
            real.away_score != null &&
            b.home_score != null &&
            b.away_score != null
          ) {
            // Bracket scores are stored in the displayed/official match order
            // (home slot vs away slot), regardless of which team the user
            // picked as winner. Compare directly without swapping.
            pts += scoreMatch(
              b.home_score,
              b.away_score,
              real.home_score,
              real.away_score,
              defaultCfg,
            );
          }
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
        .select("*")
        .eq("pool_id", pool.id);
      for (const c of champs ?? []) {
        const pts = championTeamId && c.team_id === championTeamId ? pool.bonus_champion : 0;
        await supabase.from("champion_predictions").update({ points: pts }).eq("id", c.id);
      }
    }

    return ok({ predictions: predUpdates, brackets: bracketUpdates });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function ok(body: ScoreFunctionResult) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
