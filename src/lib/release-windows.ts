export const MATCHES_RELEASE_UTC = Date.UTC(2026, 5, 11, 3, 0, 0);

export function isBeforeMatchesRelease(now = Date.now()) {
  return now < MATCHES_RELEASE_UTC;
}
