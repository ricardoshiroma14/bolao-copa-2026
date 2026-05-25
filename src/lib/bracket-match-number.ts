import { FINAL, QF, R16, R32, SF, THIRD_PLACE_MATCH } from "./wc2026-bracket.ts";
import { BRACKET_SCHEDULE } from "./wc2026-bracket-schedule.ts";

export type RealMatchForNumber = {
  external_id: string | null;
  stage: string;
  kickoff_at: string | null;
};

export const BRACKET_MATCHES_BY_STAGE: Record<string, number[]> = {
  round_of_32: R32.map((m) => m.match),
  round_of_16: R16.map((m) => m.match),
  quarter: QF.map((m) => m.match),
  semi: SF.map((m) => m.match),
  third_place: [THIRD_PLACE_MATCH],
  final: [FINAL.match],
};

export function matchNumberFromRealMatch(match: RealMatchForNumber): number | null {
  const fromExternalId = match.external_id?.match(/\b(?:M|match[-_ ]?)?(\d{2,3})\b/i);
  if (fromExternalId) {
    const num = Number(fromExternalId[1]);
    if (num >= 73 && num <= FINAL.match) return num;
  }

  const stageMatches = BRACKET_MATCHES_BY_STAGE[match.stage] ?? [];
  if (stageMatches.length === 1) return stageMatches[0];
  if (!match.kickoff_at) return null;

  const kickoffMs = new Date(match.kickoff_at).getTime();
  return (
    stageMatches.find((num) => {
      const scheduled = BRACKET_SCHEDULE[num];
      return scheduled && Math.abs(new Date(scheduled.kickoffISO).getTime() - kickoffMs) < 60_000;
    }) ?? null
  );
}
