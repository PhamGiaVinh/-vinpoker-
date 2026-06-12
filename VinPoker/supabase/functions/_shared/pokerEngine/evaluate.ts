// supabase/functions/_shared/pokerEngine/evaluate.ts
// Pure 7→best-5 Texas Hold'em hand evaluator. Combinatorial (≤C(7,5)=21 combos),
// kicker-exact, deterministic. NOT a perf-optimized LUT — correctness first; a
// 2+2/perfect-hash port is a Phase-2 optimization, not needed for play-money alpha.
//
// A hand is encoded as a "rank vector": [category, ...tiebreakers], compared
// lexicographically. category: 8 straight-flush, 7 quads, 6 full-house, 5 flush,
// 4 straight, 3 trips, 2 two-pair, 1 pair, 0 high-card.

import type { Card } from './types.ts';
import { parseCard } from './deck.ts';

export const HAND_CATEGORY_NAME = [
  'high_card', 'pair', 'two_pair', 'trips', 'straight', 'flush', 'full_house', 'quads', 'straight_flush',
] as const;
export type HandCategoryName = (typeof HAND_CATEGORY_NAME)[number];

export interface EvaluatedHand {
  rankVec: number[];
  category: number; // 0..8
  categoryName: HandCategoryName;
}

/** Lexicographic compare of two rank vectors. >0 if a beats b, <0 if b beats a, 0 tie. */
export function compareRankVec(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return out;
  while (true) {
    out.push(idx.map((i) => arr[i]));
    let p = k - 1;
    while (p >= 0 && idx[p] === n - k + p) p--;
    if (p < 0) break;
    idx[p]++;
    for (let q = p + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
  }
  return out;
}

/** Evaluate EXACTLY 5 cards into a rank vector. */
export function evaluate5(cards: Card[]): number[] {
  if (cards.length !== 5) throw new Error(`evaluate5 needs 5 cards, got ${cards.length}`);
  const parsed = cards.map(parseCard);
  const values = parsed.map((p) => p.value).sort((a, b) => b - a); // desc
  const suits = parsed.map((p) => p.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // count by value
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // groups sorted by (count desc, value desc)
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));

  // straight detection (needs 5 distinct values)
  const distinctDesc = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (distinctDesc.length === 5) {
    if (distinctDesc[0] - distinctDesc[4] === 4) straightHigh = distinctDesc[0];
    // wheel: A-5-4-3-2
    else if (distinctDesc[0] === 14 && distinctDesc[1] === 5 && distinctDesc[4] === 2) straightHigh = 5;
  }
  const isStraight = straightHigh > 0;

  if (isStraight && isFlush) return [8, straightHigh];

  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return [7, quad, kicker];
  }
  if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) {
    return [6, groups[0][0], groups[1][0]];
  }
  if (isFlush) return [5, ...values];
  if (isStraight) return [4, straightHigh];
  if (groups[0][1] === 3) {
    const trip = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    return [3, trip, ...kickers];
  }
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    const hiPair = Math.max(groups[0][0], groups[1][0]);
    const loPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return [2, hiPair, loPair, kicker];
  }
  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    return [1, pair, ...kickers];
  }
  return [0, ...values];
}

const CAT_TO_NAME = (cat: number): HandCategoryName => HAND_CATEGORY_NAME[cat];

/** Evaluate the best 5-card hand out of 5..7 cards (Hold'em: 2 hole + up to 5 board). */
export function evaluateBest(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) throw new Error(`evaluateBest needs >=5 cards, got ${cards.length}`);
  const fives = cards.length === 5 ? [cards] : combinations(cards, 5);
  let best: number[] | null = null;
  for (const five of fives) {
    const ev = evaluate5(five);
    if (best === null || compareRankVec(ev, best) > 0) best = ev;
  }
  const rankVec = best!;
  return { rankVec, category: rankVec[0], categoryName: CAT_TO_NAME(rankVec[0]) };
}

/** Convenience: positive if handA beats handB given a shared board. */
export function compareHands(a: Card[], b: Card[]): number {
  return compareRankVec(evaluateBest(a).rankVec, evaluateBest(b).rankVec);
}
