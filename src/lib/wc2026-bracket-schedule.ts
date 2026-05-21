// Datas (UTC) e estádios oficiais dos jogos do mata-mata da Copa 2026.
// Fonte: FIFA / Wikipedia 2026 FIFA World Cup knockout stage.

export type KnockoutSchedule = {
  kickoffISO: string; // ISO 8601 com timezone (UTC)
  venue: string; // "Estádio, Cidade"
};

export const BRACKET_SCHEDULE: Record<number, KnockoutSchedule> = {
  // Rodada de 32
  73: { kickoffISO: "2026-06-28T19:00:00Z", venue: "SoFi Stadium, Inglewood" },
  74: { kickoffISO: "2026-06-29T20:30:00Z", venue: "Gillette Stadium, Foxborough" },
  75: { kickoffISO: "2026-06-30T01:00:00Z", venue: "Estádio BBVA, Guadalupe" },
  76: { kickoffISO: "2026-06-29T17:00:00Z", venue: "NRG Stadium, Houston" },
  77: { kickoffISO: "2026-06-30T21:00:00Z", venue: "MetLife Stadium, Nova York/Nova Jersey" },
  78: { kickoffISO: "2026-06-30T17:00:00Z", venue: "AT&T Stadium, Dallas" },
  79: { kickoffISO: "2026-07-01T01:00:00Z", venue: "Estádio Azteca, Cidade do México" },
  80: { kickoffISO: "2026-07-01T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta" },
  81: { kickoffISO: "2026-07-02T00:00:00Z", venue: "Levi's Stadium, São Francisco" },
  82: { kickoffISO: "2026-07-01T20:00:00Z", venue: "Lumen Field, Seattle" },
  83: { kickoffISO: "2026-07-02T23:00:00Z", venue: "BMO Field, Toronto" },
  84: { kickoffISO: "2026-07-02T19:00:00Z", venue: "SoFi Stadium, Inglewood" },
  85: { kickoffISO: "2026-07-03T03:00:00Z", venue: "BC Place, Vancouver" },
  86: { kickoffISO: "2026-07-03T22:00:00Z", venue: "Hard Rock Stadium, Miami" },
  87: { kickoffISO: "2026-07-04T01:30:00Z", venue: "Arrowhead Stadium, Kansas City" },
  88: { kickoffISO: "2026-07-03T18:00:00Z", venue: "AT&T Stadium, Dallas" },
  // Oitavas
  89: { kickoffISO: "2026-07-04T21:00:00Z", venue: "Lincoln Financial Field, Filadélfia" },
  90: { kickoffISO: "2026-07-04T17:00:00Z", venue: "NRG Stadium, Houston" },
  91: { kickoffISO: "2026-07-05T20:00:00Z", venue: "MetLife Stadium, Nova York/Nova Jersey" },
  92: { kickoffISO: "2026-07-06T00:00:00Z", venue: "Estádio Azteca, Cidade do México" },
  93: { kickoffISO: "2026-07-06T19:00:00Z", venue: "AT&T Stadium, Dallas" },
  94: { kickoffISO: "2026-07-07T00:00:00Z", venue: "Lumen Field, Seattle" },
  95: { kickoffISO: "2026-07-07T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta" },
  96: { kickoffISO: "2026-07-07T20:00:00Z", venue: "BC Place, Vancouver" },
  // Quartas
  97: { kickoffISO: "2026-07-09T20:00:00Z", venue: "Gillette Stadium, Foxborough" },
  98: { kickoffISO: "2026-07-10T19:00:00Z", venue: "SoFi Stadium, Inglewood" },
  99: { kickoffISO: "2026-07-11T21:00:00Z", venue: "Hard Rock Stadium, Miami" },
  100: { kickoffISO: "2026-07-12T01:00:00Z", venue: "Arrowhead Stadium, Kansas City" },
  // Semifinais
  101: { kickoffISO: "2026-07-14T19:00:00Z", venue: "AT&T Stadium, Dallas" },
  102: { kickoffISO: "2026-07-15T19:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta" },
  // 3º lugar
  103: { kickoffISO: "2026-07-18T21:00:00Z", venue: "Hard Rock Stadium, Miami" },
  // Final
  104: { kickoffISO: "2026-07-19T19:00:00Z", venue: "MetLife Stadium, Nova York/Nova Jersey" },
};

export function getBracketSchedule(matchNum: number): KnockoutSchedule | undefined {
  return BRACKET_SCHEDULE[matchNum];
}
