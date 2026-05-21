// Estrutura oficial do mata-mata da Copa do Mundo 2026 (FIFA).
// Fonte: regulamento FIFA / Wikipedia 2026 FIFA World Cup knockout stage.

export type SlotSpec =
  | { kind: "winner"; group: string }
  | { kind: "runnerUp"; group: string }
  | { kind: "third"; groups: string[] }
  | { kind: "matchWinner"; match: number };

export type BracketMatch = {
  match: number;
  stage: "round_of_32" | "round_of_16" | "quarter" | "semi" | "third_place" | "final";
  a: SlotSpec;
  b: SlotSpec;
};

const w = (group: string): SlotSpec => ({ kind: "winner", group });
const r = (group: string): SlotSpec => ({ kind: "runnerUp", group });
const t3 = (...groups: string[]): SlotSpec => ({ kind: "third", groups });
const wm = (match: number): SlotSpec => ({ kind: "matchWinner", match });

// Rodada de 32 (16 jogos)
export const R32: BracketMatch[] = [
  { match: 73, stage: "round_of_32", a: r("A"), b: r("B") },
  { match: 74, stage: "round_of_32", a: w("E"), b: t3("A", "B", "C", "D", "F") },
  { match: 75, stage: "round_of_32", a: w("F"), b: r("C") },
  { match: 76, stage: "round_of_32", a: w("C"), b: r("F") },
  { match: 77, stage: "round_of_32", a: w("I"), b: t3("C", "D", "F", "G", "H") },
  { match: 78, stage: "round_of_32", a: r("E"), b: r("I") },
  { match: 79, stage: "round_of_32", a: w("A"), b: t3("C", "E", "F", "H", "I") },
  { match: 80, stage: "round_of_32", a: w("L"), b: t3("E", "H", "I", "J", "K") },
  { match: 81, stage: "round_of_32", a: w("D"), b: t3("B", "E", "F", "I", "J") },
  { match: 82, stage: "round_of_32", a: w("G"), b: t3("A", "E", "H", "I", "J") },
  { match: 83, stage: "round_of_32", a: r("K"), b: r("L") },
  { match: 84, stage: "round_of_32", a: w("H"), b: r("J") },
  { match: 85, stage: "round_of_32", a: w("B"), b: t3("E", "F", "G", "I", "J") },
  { match: 86, stage: "round_of_32", a: w("J"), b: r("H") },
  { match: 87, stage: "round_of_32", a: w("K"), b: t3("D", "E", "I", "J", "L") },
  { match: 88, stage: "round_of_32", a: r("D"), b: r("G") },
];

// Oitavas (8 jogos)
export const R16: BracketMatch[] = [
  { match: 89, stage: "round_of_16", a: wm(74), b: wm(77) },
  { match: 90, stage: "round_of_16", a: wm(73), b: wm(75) },
  { match: 91, stage: "round_of_16", a: wm(76), b: wm(78) },
  { match: 92, stage: "round_of_16", a: wm(79), b: wm(80) },
  { match: 93, stage: "round_of_16", a: wm(83), b: wm(84) },
  { match: 94, stage: "round_of_16", a: wm(81), b: wm(82) },
  { match: 95, stage: "round_of_16", a: wm(86), b: wm(88) },
  { match: 96, stage: "round_of_16", a: wm(85), b: wm(87) },
];

// Quartas (4 jogos)
export const QF: BracketMatch[] = [
  { match: 97, stage: "quarter", a: wm(89), b: wm(90) },
  { match: 98, stage: "quarter", a: wm(93), b: wm(94) },
  { match: 99, stage: "quarter", a: wm(91), b: wm(92) },
  { match: 100, stage: "quarter", a: wm(95), b: wm(96) },
];

// Semifinais (2 jogos)
export const SF: BracketMatch[] = [
  { match: 101, stage: "semi", a: wm(97), b: wm(98) },
  { match: 102, stage: "semi", a: wm(99), b: wm(100) },
];

// Disputa de 3º lugar — perdedores das semis
export const THIRD_PLACE_MATCH = 103;

// Final
export const FINAL: BracketMatch = { match: 104, stage: "final", a: wm(101), b: wm(102) };

export const ALL_MATCHES: BracketMatch[] = [...R32, ...R16, ...QF, ...SF, FINAL];

// Mapa: número do jogo -> (stage usado em bracket_predictions, slot)
// Usamos stages do enum existente: round_of_16, quarter, semi, final, third_place.
// "Vencedor de Mxx" é armazenado na fase QUE ELE AVANÇOU PARA.
export function storageFor(
  matchNum: number,
): { stage: "round_of_16" | "quarter" | "semi" | "final"; slot: number } | null {
  if (matchNum >= 73 && matchNum <= 88) return { stage: "round_of_16", slot: matchNum - 73 };
  if (matchNum >= 89 && matchNum <= 96) return { stage: "quarter", slot: matchNum - 89 };
  if (matchNum >= 97 && matchNum <= 100) return { stage: "semi", slot: matchNum - 97 };
  if (matchNum === 101 || matchNum === 102) return { stage: "final", slot: matchNum - 101 };
  if (matchNum === 104) return { stage: "final", slot: 2 }; // Final (M104) — score; winner also goes to champion_predictions
  return null;
}
