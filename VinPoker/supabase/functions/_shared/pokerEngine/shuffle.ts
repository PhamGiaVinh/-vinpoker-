// supabase/functions/_shared/pokerEngine/shuffle.ts
// Unbiased shuffle for the SERVER deal boundary. The engine core never calls
// this — the deck is injected so the engine stays deterministic/testable. RNG is
// a PARAMETER so tests reproduce exact shuffles.
//
// `Math.floor(rng()/2^32 * n)` and `rng() % n` are BOTH biased — never use them.
// unbiasedIndex uses rejection sampling instead.

import type { Card } from './types.ts';
import { makeDeck } from './deck.ts';

export type Rng32 = () => number; // uniform 32-bit unsigned integer

/** Default CSPRNG. Full-entropy 32-bit word. Available in Deno, Node 18+, browsers. */
export const cryptoRng32: Rng32 = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
};

/** Uniform integer in [0, n) with NO modulo bias (rejection sampling). */
export function unbiasedIndex(n: number, rng: Rng32 = cryptoRng32): number {
  if (n <= 0) throw new Error('unbiasedIndex: n must be positive');
  if (n === 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n; // largest multiple of n <= 2^32
  let x: number;
  do { x = rng(); } while (x >= limit);
  return x % n;
}

/** In-place Fisher–Yates (inward). Returns the same array for chaining. */
export function shuffle<T>(arr: T[], rng: Rng32 = cryptoRng32): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = unbiasedIndex(i + 1, rng);
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

/** Fresh, fairly-shuffled 52-card deck. */
export function shuffledDeck(rng: Rng32 = cryptoRng32): Card[] {
  return shuffle(makeDeck(), rng);
}
