// Pure helpers to compute simulated group standings from user predictions
// following FIFA 2026 tie-breaking rules.

export type TeamLite = { id: string; name: string; code: string; group_name: string | null };
export type MatchLite = {
  id: string;
  stage: string;
  group_name: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};
export type PredLite = { match_id: string; home_score: number; away_score: number };

export type Row = {
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

function emptyRow(team: TeamLite): Row {
  return { team, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

/** Build standings for a given subset of matches and teams. */
export function buildStandings(teams: TeamLite[], matches: MatchLite[], preds: PredLite[]): Row[] {
  const byId = new Map<string, Row>();
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

/** Compare using FIFA step 2 (overall) — used as fallback after head-to-head. */
function cmpOverall(a: Row, b: Row): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.team.name.localeCompare(b.team.name);
}

/** Sort group rows applying step 1 (head-to-head) then step 2/3 fallbacks. */
export function sortGroup(rows: Row[], groupMatches: MatchLite[], preds: PredLite[]): Row[] {
  // First pass: by points
  const sorted = [...rows].sort((a, b) => b.points - a.points);

  // Identify clusters of teams tied on points → apply step 1 within them
  const result: Row[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].points === sorted[i].points) j++;
    const cluster = sorted.slice(i, j);
    if (cluster.length === 1) {
      result.push(cluster[0]);
    } else {
      result.push(...resolveCluster(cluster, groupMatches, preds));
    }
    i = j;
  }
  return result;
}

function resolveCluster(cluster: Row[], groupMatches: MatchLite[], preds: PredLite[]): Row[] {
  const ids = new Set(cluster.map((r) => r.team.id));
  // Mini-table among tied teams
  const subMatches = groupMatches.filter(
    (m) => m.home_team_id && m.away_team_id && ids.has(m.home_team_id) && ids.has(m.away_team_id),
  );
  const mini = buildStandings(
    cluster.map((r) => r.team),
    subMatches,
    preds,
  );
  const miniById = new Map(mini.map((m) => [m.team.id, m]));

  return [...cluster].sort((a, b) => {
    const ma = miniById.get(a.team.id)!;
    const mb = miniById.get(b.team.id)!;
    if (mb.points !== ma.points) return mb.points - ma.points;
    if (mb.gd !== ma.gd) return mb.gd - ma.gd;
    if (mb.gf !== ma.gf) return mb.gf - ma.gf;
    // Step 2 fallback (overall)
    return cmpOverall(a, b);
  });
}

export type QualifiedTeam = { team: TeamLite; group: string; position: 1 | 2 | 3 };

/**
 * Returns 1st and 2nd of each group plus the 8 best 3rd-placed teams.
 * Ranking-FIFA fallback is replaced by name-alphabetical (neutral).
 */
export function computeQualifiers(
  teams: TeamLite[],
  matches: MatchLite[],
  preds: PredLite[],
): { byGroup: Record<string, Row[]>; qualified: QualifiedTeam[]; thirds: Row[] } {
  const groupNames = Array.from(
    new Set(teams.map((t) => t.group_name).filter((g): g is string => !!g)),
  ).sort();

  const byGroup: Record<string, Row[]> = {};
  const qualified: QualifiedTeam[] = [];
  const thirdsRaw: { row: Row; group: string }[] = [];

  for (const g of groupNames) {
    const groupTeams = teams.filter((t) => t.group_name === g);
    const groupMatches = matches.filter((m) => m.stage === "group" && m.group_name === g);
    const rows = sortGroup(buildStandings(groupTeams, groupMatches, preds), groupMatches, preds);
    byGroup[g] = rows;
    if (rows[0]) qualified.push({ team: rows[0].team, group: g, position: 1 });
    if (rows[1]) qualified.push({ team: rows[1].team, group: g, position: 2 });
    if (rows[2]) thirdsRaw.push({ row: rows[2], group: g });
  }

  // Best 8 thirds: overall points → gd → gf → name
  const thirds = thirdsRaw
    .map((t) => t.row)
    .sort(cmpOverall)
    .slice(0, 8);
  thirds.forEach((r) =>
    qualified.push({ team: r.team, group: r.team.group_name ?? "?", position: 3 }),
  );

  return { byGroup, qualified, thirds };
}
