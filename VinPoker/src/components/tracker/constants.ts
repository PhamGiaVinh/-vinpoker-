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

/**
 * Portrait (narrow-screen) seat anchors — a taller oval with the SAME seat
 * identities (seat 1 dealer-left → seat 9 dealer-right). Used only by the rich
 * felt on narrow viewports; the default landscape map stays SEAT_LAYOUT_9MAX.
 */
export const TRACKER_PORTRAIT_SEATS: Record<number, { left: number; top: number }> = {
  1: { left: 30, top: 90 },
  2: { left: 11, top: 70 },
  3: { left: 8, top: 44 },
  4: { left: 22, top: 19 },
  5: { left: 50, top: 11 },
  6: { left: 78, top: 19 },
  7: { left: 92, top: 44 },
  8: { left: 89, top: 70 },
  9: { left: 70, top: 90 },
};

/** Felt geometry presets (mirrors LiveFelt's GEO). Landscape = the original racetrack. */
export const TRACKER_GEO = {
  landscape: { aspect: '13 / 6', seats: SEAT_LAYOUT_9MAX, centerTop: 40 },
  portrait: { aspect: '5 / 6', seats: TRACKER_PORTRAIT_SEATS, centerTop: 44 },
} as const;

/**
 * Portrait rich-felt DE-CROWDED anchors — used ONLY by the rich felt on narrow
 * viewports when `trackerFeltDealerFix` is ON. The base TRACKER_PORTRAIT_SEATS + the
 * old ±7 nudges left the 9 rich pods overlapping at 390px portrait (5 pod-pod overlaps
 * for seats 1×2/2×3/3×4/6×7/8×9, and seats 1/9 intersecting the dealer block — measured
 * on /__dev/tracker). A rich pod is ~84×125px (incl. the hole-card backs shown at
 * showdown reveal), so 4 pods per side cannot stack on the 5/6 oval. This map spreads
 * each side into an inner→outer→inner→outer arc and pulls seats 1/9 clear of the dealer,
 * and pairs with the taller PORTRAIT_FIX_ASPECT oval so every pod gets a clear box
 * (≥14px pairwise clearance at 390px). Base TRACKER_PORTRAIT_SEATS is the flag-OFF
 * kill-switch path and stays byte-identical. Pinned by TrackerRacetrack.geometry.test.
 */
export const TRACKER_PORTRAIT_SEATS_FIX: Record<number, { left: number; top: number }> = {
  1: { left: 14, top: 86 },
  2: { left: 24, top: 62 },
  3: { left: 11, top: 38 },
  4: { left: 22, top: 13 },
  5: { left: 50, top: 11 },
  6: { left: 78, top: 13 },
  7: { left: 89, top: 38 },
  8: { left: 76, top: 62 },
  9: { left: 86, top: 86 },
};

/** Taller portrait oval that pairs with TRACKER_PORTRAIT_SEATS_FIX (flag-ON only) so the
 *  9 rich pods get the vertical room to sit without overlap. Flag-OFF keeps '5 / 6'. */
export const PORTRAIT_FIX_ASPECT = '5 / 8';

/**
 * Height floor (px) for the fixed portrait oval. Pods are a fixed pixel height but the
 * aspect-driven oval shrinks with viewport width, so on narrow phones (≤ ~385px) the
 * vertical gaps close up. This floor keeps the oval tall enough to preserve the gaps.
 * Inert at 390px (aspect already gives ~562px), only binds below it. Flag-ON only.
 */
export const PORTRAIT_FIX_MIN_H = 560;

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
 * Rich poker-felt skin — black broadcast table, aligned with LiveFelt viewerLayout.
 * Used only when the rich flag is on.
 */
export const RICH_FELT = {
  background:
    'radial-gradient(80% 72% at 50% 40%, #16181d 0%, #090b0f 58%, #020304 100%)',
  border: '1.5px solid hsl(var(--primary) / 0.24)',
  boxShadow:
    'inset 0 0 0 6px rgba(255,255,255,0.018), inset 0 0 82px rgba(0,0,0,0.74), 0 18px 48px rgba(0,0,0,0.56), 0 0 28px hsl(var(--primary) / 0.07)',
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
