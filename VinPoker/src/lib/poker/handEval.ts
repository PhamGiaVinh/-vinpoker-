// src/lib/poker/handEval.ts
// Pure, framework-free poker hand evaluator + exact heads-up equity. DISPLAY-ONLY:
// the server engine remains the sole authority for the winner / payout / stacks. The
// client uses this purely to show the cinematic all-in runout's equity %, never to
// decide an outcome.
//
// The evaluate5/evaluate7 core is ported from the proven GTO EquityCalculator
// (src/components/gto/EquityCalculator.tsx) so the logic is shared/identical; kept here
// as a small standalone module so the online-poker cinematic can import it without
// pulling in that component. Cards are strings "Rs" (rank char + suit char), e.g. "Ah",
// "Td", "6s" — exactly the server's card format.

export const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

const norm = (c: string): string => `${(c[0] ?? '').toUpperCase()}${(c[1] ?? '').toLowerCase()}`;

/** All k-index combinations of [0..n). */
export function kCombinations(n: number, k: number): number[][] {
  const res: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) { res.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  };
  rec(0);
  return res;
}

/** Score a 5-card hand; higher is better. Category-encoded with tiebreaks. */
export function evaluate5(cards: string[]): number {
  const ranks = cards.map((c) => RANK_VAL[norm(c)[0]]).sort((a, b) => b - a);
  const suits = cards.map((c) => norm(c)[1]);
  const counts: Record<number, number> = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, c]) => ({ r: +r, c }))
    .sort((a, b) => (b.c - a.c) || (b.r - a.r));
  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = Array.from(new Set(ranks));
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { isStraight = true; straightHigh = uniq[0]; }
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      isStraight = true; straightHigh = 5; // wheel A-2-3-4-5
    }
  }
  const tiebreak = (arr: number[]) => arr.reduce((acc, v) => acc * 15 + v, 0);
  if (isStraight && isFlush) return 8e10 + straightHigh;
  if (groups[0].c === 4) return 7e10 + groups[0].r * 15 + groups[1].r;
  if (groups[0].c === 3 && groups[1].c === 2) return 6e10 + groups[0].r * 15 + groups[1].r;
  if (isFlush) return 5e10 + tiebreak(ranks);
  if (isStraight) return 4e10 + straightHigh;
  if (groups[0].c === 3) return 3e10 + groups[0].r * 225 + tiebreak(groups.slice(1).map((g) => g.r));
  if (groups[0].c === 2 && groups[1].c === 2) {
    const high = Math.max(groups[0].r, groups[1].r);
    const low = Math.min(groups[0].r, groups[1].r);
    return 2e10 + high * 225 + low * 15 + groups[2].r;
  }
  if (groups[0].c === 2) return 1e10 + groups[0].r * 3375 + tiebreak(groups.slice(1).map((g) => g.r));
  return tiebreak(ranks);
}

/** Best 5-card score out of 5–7 cards. */
export function evaluate7(cards: string[]): number {
  if (cards.length <= 5) return evaluate5(cards);
  let best = 0;
  for (const combo of kCombinations(cards.length, 5)) {
    const v = evaluate5(combo.map((i) => cards[i]));
    if (v > best) best = v;
  }
  return best;
}

/** Hard ceiling on board completions to enumerate — keeps equity off the heavy preflop
 *  path (C(48,5)≈1.7M) and on the main thread only for cheap cases (flop 990, turn 44,
 *  river 1). Anything heavier returns null → caller hides equity. */
export const EQUITY_MAX_COMPLETIONS = 2000;

export interface HeadsUpEquity { a: number; b: number; tie: number }

/**
 * Exact heads-up equity for two known hole hands on a (partial) board, by enumerating
 * every completion of the board. Returns null when the input is invalid (wrong card
 * counts or any duplicate card) OR when the enumeration would exceed
 * EQUITY_MAX_COMPLETIONS (i.e. preflop) — the caller then hides equity. Real or hidden;
 * never sampled. Percentages are integers summing to ~100.
 */
export function headsUpEquity(holeA: string[], holeB: string[], board: string[]): HeadsUpEquity | null {
  if (!Array.isArray(holeA) || !Array.isArray(holeB)) return null;
  if (holeA.length !== 2 || holeB.length !== 2) return null;
  if (board.length > 5) return null;

  const used = [...holeA, ...holeB, ...board].map(norm);
  if (new Set(used).size !== used.length) return null; // duplicate card → invalid

  const usedSet = new Set(used);
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) { const c = `${r}${s}`; if (!usedSet.has(c)) deck.push(c); }

  const need = 5 - board.length;
  const combos = kCombinations(deck.length, need);
  if (combos.length > EQUITY_MAX_COMPLETIONS) return null; // too heavy (preflop) → hide

  let winsA = 0, winsB = 0, ties = 0;
  const hA = holeA.map(norm); const hB = holeB.map(norm); const base = board.map(norm);
  for (const combo of combos) {
    const full = [...base, ...combo.map((i) => deck[i])];
    const sa = evaluate7([...hA, ...full]);
    const sb = evaluate7([...hB, ...full]);
    if (sa > sb) winsA++; else if (sb > sa) winsB++; else ties++;
  }
  const total = winsA + winsB + ties || 1;
  const a = Math.round((winsA / total) * 100);
  const b = Math.round((winsB / total) * 100);
  return { a, b, tie: Math.max(0, 100 - a - b) };
}
