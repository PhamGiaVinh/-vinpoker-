// PR-A — Tracker Racetrack Hand-Input UI: layout + visual constants (presentational only).
import { formatChips } from '@/lib/tv/format';

// Reuse the app's vi chip formatter (29800 -> "29.800"); do not write a new one.
export { formatChips };

/** Big blinds with one decimal, e.g. toBB(29800, 400) -> "74.5". Empty when bb unusable. */
export function toBB(chips: number, bb: number): string {
  if (!bb || bb <= 0) return '';
  return (chips / bb).toFixed(1);
}

/**
 * Physical-seat anchor map (percent of the felt frame). Seats are placed by
 * `seatNumber`, NEVER by array index. Each seat is translate(-50%,-50%).
 * Bottom-center is the human dealer; seat 1 sits to the dealer's left, going
 * clockwise around to seat 9 on the dealer's right.
 */
export const SEAT_LAYOUT_9MAX: Record<number, { left: number; top: number }> = {
  1: { left: 37, top: 86 },
  2: { left: 10, top: 62 },
  3: { left: 15, top: 27 },
  4: { left: 34, top: 12 },
  5: { left: 50, top: 9 },
  6: { left: 66, top: 12 },
  7: { left: 85, top: 27 },
  8: { left: 90, top: 62 },
  9: { left: 63, top: 86 },
};

/** Human dealer station — fixed bottom-center. */
export const DEALER_ANCHOR = { left: 50, top: 92 };

/** Felt center, and how far a committed-chip puck sits from its seat toward the center. */
export const FELT_CENTER = { left: 50, top: 44 };
export const BET_LERP = 0.34;

/** Committed-chip puck position for a seat (percent of the felt frame). */
export function betPuckPosition(seat: { left: number; top: number }) {
  return {
    left: seat.left + (FELT_CENTER.left - seat.left) * BET_LERP,
    top: seat.top + (FELT_CENTER.top - seat.top) * BET_LERP,
  };
}

/**
 * Poker-felt surface — FIXED dark, theme-independent (poker-table visual exception).
 * Must NOT follow the warm/light theme, or the felt turns into a light slab. Applied
 * via inline style on the felt frame; never added to global CSS.
 */
export const FELT = {
  background: 'radial-gradient(120% 130% at 50% 40%, #191c21 0%, #101216 78%)',
  border: '1.5px solid rgba(255,255,255,0.10)',
  boxShadow:
    'inset 0 0 0 6px rgba(255,255,255,0.02), inset 0 0 60px -10px #000, 0 0 0 1px #000',
} as const;

/**
 * Community-card face — FIXED white, theme-independent (poker-card visual exception).
 * Applied via inline style; never added to global CSS.
 */
export const CARD_FACE = {
  bg: '#f4f4f2',
  text: '#111',
  red: '#d63b3b',
  emptyBorder: '1.5px dashed rgba(255,255,255,0.14)',
  emptyText: 'rgba(255,255,255,0.22)',
} as const;

/**
 * GTO action colors — LOCAL only, applied via inline style on the dock action
 * buttons. Never added to global CSS. Distinct from the brand green (--primary).
 */
export const GTO_COLORS = {
  fold: '#3B82F6',
  call: '#22C55E',
  raise: '#EF4444',
  all_in: '#991B1B',
} as const;

/** Card display strings whose suit renders red on the white face. */
export function isRedCard(card: string): boolean {
  return card.includes('♦') || card.includes('♥');
}
