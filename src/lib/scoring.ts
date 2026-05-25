import { isRoundOf32PointsReleased } from "./round-of-32-release";

export type MatchScoring = {
  scoring_exact: number;
  scoring_diff: number;
  scoring_winner: number;
  bonus_round_of_32: number;
  bonus_round_of_16: number;
  bonus_quarter: number;
  bonus_semi: number;
  bonus_third_place: number;
  bonus_final: number;
  bonus_champion: number;
  round_of_32_points_enabled: boolean;
};

export type MatchScoringInput = Partial<MatchScoring> & {
  bonus_round_of_32_wrong?: number | null;
};

export type ScoreClass = "exact" | "winnerPlusScore" | "winnerOnly" | "miss";

export const BRACKET_SOURCE_MATCHES: Record<number, [number, number]> = {
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
} as const;

export type BracketSourceMatchMap = typeof BRACKET_SOURCE_MATCHES;

export function isCanonicalBracketStageSlot(stage: string, slot: number): boolean {
  if (stage === "round_of_16") return slot >= 0 && slot <= 15;
  if (stage === "quarter") return slot >= 0 && slot <= 7;
  if (stage === "semi") return slot >= 0 && slot <= 3;
  if (stage === "final") return slot >= 0 && slot <= 2;
  if (stage === "third_place") return slot >= 0 && slot <= 1;
  return false;
}

export const R32_MATCH_NUM_MIN = 73;
export const R32_MATCH_NUM_MAX = 88;

export type RankingCounterNames =
  | "exact"
  | "winnerPlusScore"
  | "winnerOnly"
  | "qual32"
  | "r32"
  | "r16"
  | "sf"
  | "final"
  | "third"
  | "champion";

export type RankingCounters = Record<RankingCounterNames, number>;

export function calculateRankingPoints(
  counters: Pick<
    RankingCounters,
    | "exact"
    | "winnerPlusScore"
    | "winnerOnly"
    | "qual32"
    | "r32"
    | "r16"
    | "sf"
    | "final"
    | "third"
    | "champion"
  >,
  scoring: MatchScoring,
): number {
  return (
    counters.exact * scoring.scoring_exact +
    counters.winnerPlusScore * scoring.scoring_diff +
    counters.winnerOnly * scoring.scoring_winner +
    (scoring.round_of_32_points_enabled ? counters.qual32 * scoring.bonus_round_of_32 : 0) +
    counters.r32 * scoring.bonus_round_of_16 +
    counters.r16 * scoring.bonus_quarter +
    counters.sf * scoring.bonus_semi +
    counters.third * scoring.bonus_third_place +
    counters.final * scoring.bonus_final +
    counters.champion * scoring.bonus_champion
  );
}

export const DEFAULT_MATCH_SCORING: MatchScoring = {
  scoring_exact: 10,
  scoring_diff: 7,
  scoring_winner: 5,
  bonus_round_of_32: 20,
  bonus_round_of_16: 30,
  bonus_quarter: 40,
  bonus_semi: 50,
  bonus_third_place: 55,
  bonus_final: 70,
  bonus_champion: 50,
  round_of_32_points_enabled: false,
};

export function normalizeScoring(source: MatchScoringInput | null | undefined): MatchScoring {
  return {
    scoring_exact: source?.scoring_exact ?? DEFAULT_MATCH_SCORING.scoring_exact,
    scoring_diff: source?.scoring_diff ?? DEFAULT_MATCH_SCORING.scoring_diff,
    scoring_winner: source?.scoring_winner ?? DEFAULT_MATCH_SCORING.scoring_winner,
    bonus_round_of_32: source?.bonus_round_of_32 ?? DEFAULT_MATCH_SCORING.bonus_round_of_32,
    bonus_round_of_16: source?.bonus_round_of_16 ?? DEFAULT_MATCH_SCORING.bonus_round_of_16,
    bonus_quarter: source?.bonus_quarter ?? DEFAULT_MATCH_SCORING.bonus_quarter,
    bonus_semi: source?.bonus_semi ?? DEFAULT_MATCH_SCORING.bonus_semi,
    bonus_third_place: source?.bonus_third_place ?? DEFAULT_MATCH_SCORING.bonus_third_place,
    bonus_final: source?.bonus_final ?? DEFAULT_MATCH_SCORING.bonus_final,
    bonus_champion: source?.bonus_champion ?? DEFAULT_MATCH_SCORING.bonus_champion,
    round_of_32_points_enabled: isRoundOf32PointsReleased(source),
  };
}

export function classifyScore(
  predHome: number,
  predAway: number,
  realHome: number,
  realAway: number,
): ScoreClass {
  if (predHome === realHome && predAway === realAway) return "exact";
  if (Math.sign(predHome - predAway) !== Math.sign(realHome - realAway)) return "miss";
  if (predHome === realHome || predAway === realAway) return "winnerPlusScore";
  return "winnerOnly";
}

export function scoreMatchPoints(
  predHome: number,
  predAway: number,
  realHome: number,
  realAway: number,
  scoring: Pick<
    MatchScoring,
    "scoring_exact" | "scoring_diff" | "scoring_winner"
  > = DEFAULT_MATCH_SCORING,
) {
  const scoreClass = classifyScore(predHome, predAway, realHome, realAway);
  if (scoreClass === "exact") return scoring.scoring_exact;
  if (scoreClass === "winnerPlusScore") return scoring.scoring_diff;
  if (scoreClass === "winnerOnly") return scoring.scoring_winner;
  return 0;
}

export function isMatchScorable(
  match:
    | {
        home_score: number | null;
        away_score: number | null;
        status: string | null;
      }
    | null
    | undefined,
): boolean {
  return (
    !!match &&
    (match.status === "finished" || match.status === "live") &&
    match.home_score != null &&
    match.away_score != null
  );
}

export function classifyPredictionScore(
  pick: { home_score: number | null; away_score: number | null },
  real: { home_score: number | null; away_score: number | null; status: string | null },
): ScoreClass | null {
  if (!isMatchScorable(real) || pick.home_score == null || pick.away_score == null) return null;
  return classifyScore(pick.home_score, pick.away_score, real.home_score!, real.away_score!);
}

export function scorePredictionPoints(
  pick: { home_score: number | null; away_score: number | null },
  real: { home_score: number | null; away_score: number | null; status: string | null },
  scoring: Pick<
    MatchScoring,
    "scoring_exact" | "scoring_diff" | "scoring_winner"
  > = DEFAULT_MATCH_SCORING,
): number {
  if (!isMatchScorable(real) || pick.home_score == null || pick.away_score == null) return 0;
  return scoreMatchPoints(
    pick.home_score,
    pick.away_score,
    real.home_score!,
    real.away_score!,
    scoring,
  );
}

export function bracketMatchNum(stage: string, slot: number): number | null {
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

export function pickStorageFor(matchNum: number): { stage: string; slot: number } | null {
  if (matchNum >= 73 && matchNum <= 88) return { stage: "round_of_16", slot: matchNum - 73 };
  if (matchNum >= 89 && matchNum <= 96) return { stage: "quarter", slot: matchNum - 89 };
  if (matchNum >= 97 && matchNum <= 100) return { stage: "semi", slot: matchNum - 97 };
  if (matchNum === 101) return { stage: "final", slot: 0 };
  if (matchNum === 102) return { stage: "final", slot: 1 };
  if (matchNum === 104) return { stage: "final", slot: 2 };
  return null;
}

export function sourceBonusForMatch(matchNum: number, scoring: MatchScoring): number {
  if (matchNum >= 73 && matchNum <= 88) return scoring.bonus_round_of_32;
  if (matchNum >= 89 && matchNum <= 96) return scoring.bonus_round_of_16;
  if (matchNum >= 97 && matchNum <= 100) return scoring.bonus_quarter;
  if (matchNum === 101 || matchNum === 102) return scoring.bonus_semi;
  if (matchNum === 103) return scoring.bonus_third_place;
  if (matchNum === 104) return scoring.bonus_final;
  return 0;
}

export function scoreInputForIdenticalMatch(
  pick: { home_score: number | null; away_score: number | null },
  real: {
    home_team_id: string | null;
    away_team_id: string | null;
    home_score: number | null;
    away_score: number | null;
  },
  predictedParticipants: [string | null, string | null] | null,
): { home_score: number; away_score: number } | null {
  if (pick.home_score == null || pick.away_score == null) return null;
  if (
    !real.home_team_id ||
    !real.away_team_id ||
    real.home_score == null ||
    real.away_score == null
  ) {
    return null;
  }
  if (!predictedParticipants?.[0] || !predictedParticipants?.[1]) return null;

  const [predHome, predAway] = predictedParticipants;
  if (predHome === real.home_team_id && predAway === real.away_team_id) {
    return { home_score: pick.home_score, away_score: pick.away_score };
  }
  if (predHome === real.away_team_id && predAway === real.home_team_id) {
    return { home_score: pick.away_score, away_score: pick.home_score };
  }
  return null;
}

export type BracketScorePick = {
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

export type BracketScoreReal = {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  status: string | null;
};

export type BracketScoreBreakdown = {
  sourcePoints: number;
  scorePoints: number;
  total: number;
  roundOf32Suppressed: boolean;
};

export function scoreBracketRowPoints({
  matchNum,
  pick,
  real,
  predictedParticipants,
  sourceHits,
  scoring,
}: {
  matchNum: number;
  pick: BracketScorePick;
  real: BracketScoreReal;
  predictedParticipants: [string | null, string | null] | null;
  sourceHits: number;
  scoring: MatchScoring;
}): BracketScoreBreakdown {
  const roundOf32Suppressed =
    matchNum >= R32_MATCH_NUM_MIN &&
    matchNum <= R32_MATCH_NUM_MAX &&
    !scoring.round_of_32_points_enabled;

  if (roundOf32Suppressed) {
    return { sourcePoints: 0, scorePoints: 0, total: 0, roundOf32Suppressed };
  }

  const sourcePoints = Math.max(0, sourceHits) * sourceBonusForMatch(matchNum, scoring);
  const scoreInput = isMatchScorable(real)
    ? scoreInputForIdenticalMatch(pick, real, predictedParticipants)
    : null;
  const scorePoints =
    pick.team_id && real.winner_team_id && pick.team_id === real.winner_team_id && scoreInput
      ? scoreMatchPoints(
          scoreInput.home_score,
          scoreInput.away_score,
          real.home_score!,
          real.away_score!,
          scoring,
        )
      : 0;

  return {
    sourcePoints,
    scorePoints,
    total: sourcePoints + scorePoints,
    roundOf32Suppressed,
  };
}
