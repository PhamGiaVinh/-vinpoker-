// src/components/poker/mobileTableLayout.ts
// N8 mobile table geometry — the SINGLE source of truth for the portrait seat map + felt
// extent, so the layout can be dialed in from one place. Percent coords are relative to the
// SeatRing felt box. The viewer is ALWAYS the bottom-left hero HUD (drawn by <HeroHud>, not on
// the ring); these slots are the OPPONENT seats only, listed clockwise from the hero.
//
// Side seats anchor by their OUTER edge (`anchor`) so a wide name-plate hugs the felt rim
// without clipping off-screen — never nudge x inward (that un-hugs the felt and brings back the
// "lạc ra khỏi bàn" / falling-out feeling). 'left' → pod's left edge sits at x; 'right' → pod's
// right edge sits at x; 'center' → pod centred on x.

export type SeatAnchor = 'left' | 'right' | 'center';
export interface SeatSlot {
  x: number;
  y: number;
  anchor: SeatAnchor;
}

// N8-ratio map (owner mockup v3): the opponents cluster in the UPPER ~55% of the stadium felt
// (board/pot lift to ~31% with them); the lower felt belongs to the hero's own cards + the
// action dock, which overlay the green like N8 — so NO slot sits below y≈48.

// Heads-up: the lone opponent sits across the table (top-centre), not adjacent.
export const MOBILE_OPP_SLOTS_2MAX: SeatSlot[] = [
  { x: 50, y: 10, anchor: 'center' },
];

// 6-max (3–6 players): up to 5 opponents, clockwise from the bottom-left hero — up the left
// column, across the top, down the right. Side x values sit on the GREEN felt edge (≈6/94),
// not the dark rail.
export const MOBILE_OPP_SLOTS_6MAX: SeatSlot[] = [
  { x: 6, y: 38, anchor: 'left' }, // left-lower (below the 5-card board band at ~31%)
  { x: 6, y: 16, anchor: 'left' }, // left-upper
  { x: 50, y: 9, anchor: 'center' }, // top-centre (below the floating header)
  { x: 94, y: 16, anchor: 'right' }, // right-upper
  { x: 94, y: 38, anchor: 'right' }, // right-lower
];

// 9-max compact (7–9 players): 8 opponents in three left / two top / three right, clockwise
// from the bottom-left hero; for 7–8 players the first m are used. Tuned for readability at
// 360px (opponents may degrade to avatar+stack — see SeatRing).
export const MOBILE_OPP_SLOTS_9MAX: SeatSlot[] = [
  { x: 6, y: 48, anchor: 'left' }, // left-lower (above the hero's cards)
  { x: 6, y: 31, anchor: 'left' }, // left-mid
  { x: 6, y: 15, anchor: 'left' }, // left-upper
  { x: 27, y: 9, anchor: 'center' }, // top-left (below the floating header)
  { x: 73, y: 9, anchor: 'center' }, // top-right
  { x: 94, y: 15, anchor: 'right' }, // right-upper
  { x: 94, y: 31, anchor: 'right' }, // right-mid
  { x: 94, y: 48, anchor: 'right' }, // right-lower (above the action dock)
];

// Hero HUD anchor — bottom-left ON the felt; kept only as the emanation point for the hero's
// committed-bet chip + deal target (the hero plate itself is the off-ring <HeroHud>).
export const MOBILE_HERO_ANCHOR: SeatSlot = { x: 18, y: 80, anchor: 'center' };

// Where mobile bets gather: the pot/board block lifts to ~31% on the N8 stadium felt, so
// committed-bet chips aim here instead of the geometric centre (desktop keeps {50,50}).
export const MOBILE_POT_CENTER = { x: 50, y: 38 } as const;

/** Opponent slot list for a given total seat count (hero included in `n`). */
export function oppSlots(n: number): SeatSlot[] {
  if (n <= 2) return MOBILE_OPP_SLOTS_2MAX;
  return n <= 6 ? MOBILE_OPP_SLOTS_6MAX : MOBILE_OPP_SLOTS_9MAX;
}

// FULL-FILL felt (owner-confirmed): the felt covers the whole screen — seats + hero sit ON the
// green, no dark side margins (a contained oval read as "lệch khỏi bàn" / off the table). Mobile
// fills the (relative) felt-area wrapper edge-to-edge; desktop (sm:) keeps the landscape oval.
// ONE constant for felt extent.
export const MOBILE_FELT_CLASS =
  'absolute inset-0 sm:relative sm:inset-auto sm:mx-auto sm:aspect-[16/10] sm:h-auto sm:w-full sm:max-w-3xl';
