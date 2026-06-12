// supabase/functions/_shared/pokerEngine/deck.ts
// Card constants + parsing. Pure, deterministic, zero external imports.
// Format is LOCKED to /^[AKQJT2-9][shdc]$/ — mirrors CardSlot.tsx (RANKS/SUITS,
// rank-first, lowercase suit) AND the server-side validate_cards() regex.

import type { Card, Rank, Suit } from './types.ts';

export const RANKS: readonly Rank[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

/** Canonical card-format regex. Single source of truth shared by engine + tests. */
export const CARD_RE = /^[AKQJT2-9][shdc]$/;

/** High-to-low rank value. Ace is 14 here; the wheel (A-5) is handled in evaluate.ts. */
export const RANK_VALUE: Record<Rank, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
};

export const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

export function isCard(s: string): s is Card {
  return CARD_RE.test(s);
}

export interface ParsedCard {
  rank: Rank;
  suit: Suit;
  value: number; // 2..14
}

export function parseCard(c: Card): ParsedCard {
  if (!CARD_RE.test(c)) throw new Error(`Invalid card: ${JSON.stringify(c)}`);
  const rank = c[0] as Rank;
  const suit = c[1] as Suit;
  return { rank, suit, value: RANK_VALUE[rank] };
}

/** Ordered 52-card deck (rank-major, suit-minor). Same order every call. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}` as Card);
  return deck;
}

/** Throws if cards are malformed or contain duplicates (used to validate injected decks). */
export function assertNoDuplicates(cards: Card[]): void {
  const seen = new Set<string>();
  for (const c of cards) {
    if (!CARD_RE.test(c)) throw new Error(`Invalid card in deck: ${JSON.stringify(c)}`);
    if (seen.has(c)) throw new Error(`Duplicate card in deck: ${c}`);
    seen.add(c);
  }
}
