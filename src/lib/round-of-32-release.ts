export const ROUND_OF_32_RELEASE_FALLBACK_ENABLED = 1;
export const ROUND_OF_32_RELEASE_FALLBACK_DISABLED = 15;

type RoundOf32ReleaseSource = {
  round_of_32_points_enabled?: boolean | null;
  bonus_round_of_32_wrong?: number | null;
};

export function isRoundOf32PointsReleased(source: RoundOf32ReleaseSource | null | undefined) {
  if (typeof source?.round_of_32_points_enabled === "boolean") {
    return source.round_of_32_points_enabled;
  }
  return source?.bonus_round_of_32_wrong === ROUND_OF_32_RELEASE_FALLBACK_ENABLED;
}
