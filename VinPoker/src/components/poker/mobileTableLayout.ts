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

// Heads-up: the lone opponent sits across the table (top-centre), not adjacent.
export const MOBILE_OPP_SLOTS_2MAX: SeatSlot[] = [
  { x: 50, y: 14, anchor: 'center' },
];

// 6-max (3–6 players): up to 5 opponents hugging the contained oval, clockwise from the
// bottom-left hero — up the left, across the top, down the right, to the bottom-right. Side x
// values sit on the GREEN felt edge (≈6/94), not the dark rail; bottom-right kept off the dock.
export const MOBILE_OPP_SLOTS_6MAX: SeatSlot[] = [
  { x: 6, y: 48, anchor: 'left' }, // left-mid
  { x: 26, y: 14, anchor: 'center' }, // top-left
  { x: 74, y: 14, anchor: 'center' }, // top-right
  { x: 94, y: 48, anchor: 'right' }, // right-mid
  { x: 50, y: 72, anchor: 'center' }, // bottom-centre (between hero HUD + dock, below the board)
];

// 9-max compact (7–9 players): 8 opponents in a tighter ring; for 7–8 players the first m are
// used. Tuned for readability at 360px (opponents may degrade to avatar+stack — see SeatRing).
export const MOBILE_OPP_SLOTS_9MAX: SeatSlot[] = [
  { x: 6, y: 53, anchor: 'left' }, // left-lower (above the hero HUD)
  { x: 7, y: 31, anchor: 'left' }, // left-upper
  { x: 27, y: 10, anchor: 'center' }, // top-left
  { x: 50, y: 7, anchor: 'center' }, // top-center
  { x: 73, y: 10, anchor: 'center' }, // top-right
  { x: 93, y: 31, anchor: 'right' }, // right-upper
  { x: 94, y: 53, anchor: 'right' }, // right-lower (above the action dock)
  { x: 50, y: 70, anchor: 'center' }, // bottom-centre (between hero HUD + dock, below the board)
];

// Hero HUD anchor — bottom-left; kept only as the emanation point for the hero's committed-bet
// chip + deal target (the hero plate itself is the off-ring <HeroHud>).
export const MOBILE_HERO_ANCHOR: SeatSlot = { x: 16, y: 86, anchor: 'center' };

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
