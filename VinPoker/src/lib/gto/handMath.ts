// Poker hand grid utilities (13x13)
export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export type Rank = (typeof RANKS)[number];
export type HandClass = "pair" | "suited" | "offsuit";
export type HandGroup = "pair" | "broadway" | "suitedConnector" | "Ax" | "other";

/** Returns notation for cell at row r, col c.
 *  Diagonal = pair (e.g. "AA"), upper triangle = suited ("AKs"), lower = offsuit ("AKo"). */
export function handAt(r: number, c: number): string {
  const a = RANKS[r];
  const b = RANKS[c];
  if (r === c) return `${a}${a}`;
  if (r < c) return `${a}${b}s`;
  return `${b}${a}o`;
}

export function classify(hand: string): HandClass {
  if (hand.length === 2) return "pair";
  return hand.endsWith("s") ? "suited" : "offsuit";
}

export function combosOf(hand: string): number {
  const k = classify(hand);
  return k === "pair" ? 6 : k === "suited" ? 4 : 12;
}

export const TOTAL_COMBOS = 1326;

export function totalCombos(selected: Iterable<string>): number {
  let n = 0;
  for (const h of selected) n += combosOf(h);
  return n;
}

export function percentRange(selected: Iterable<string>): number {
  return (totalCombos(selected) / TOTAL_COMBOS) * 100;
}

function groupOf(hand: string): HandGroup {
  const k = classify(hand);
  if (k === "pair") return "pair";
  const a = hand[0];
  const b = hand[1];
  const broadway = ["A", "K", "Q", "J", "T"];
  if (broadway.includes(a) && broadway.includes(b)) return "broadway";
  if (a === "A") return "Ax";
  if (k === "suited") {
    const ai = RANKS.indexOf(a as Rank);
    const bi = RANKS.indexOf(b as Rank);
    if (Math.abs(ai - bi) === 1) return "suitedConnector";
  }
  return "other";
}

export function distributionByClass(selected: Set<string>) {
  const out: Record<HandClass, number> = { pair: 0, suited: 0, offsuit: 0 };
  for (const h of selected) out[classify(h)] += combosOf(h);
  return out;
}

export function distributionByGroup(selected: Set<string>) {
  const out: Record<HandGroup, number> = {
    pair: 0,
    broadway: 0,
    suitedConnector: 0,
    Ax: 0,
    other: 0,
  };
  for (const h of selected) out[groupOf(h)] += combosOf(h);
  return out;
}
