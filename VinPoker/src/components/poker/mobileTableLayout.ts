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
  { x: 6, y: 50, anchor: 'left' }, // left-mid
  { x: 24, y: 13, anchor: 'center' }, // top-left
  { x: 76, y: 13, anchor: 'center' }, // top-right
  { x: 94, y: 50, anchor: 'right' }, // right-mid
  { x: 80, y: 79, anchor: 'right' }, // bottom-right
];

// 9-max compact (7–9 players): 8 opponents in a tighter ring; for 7–8 players the first m are
// used. Tuned for readability at 360px (opponents may degrade to avatar+stack — see SeatRing).
export const MOBILE_OPP_SLOTS_9MAX: SeatSlot[] = [
  { x: 6, y: 60, anchor: 'left' }, // left-lower
  { x: 7, y: 32, anchor: 'left' }, // left-upper
  { x: 26, y: 10, anchor: 'center' }, // top-left
  { x: 50, y: 7, anchor: 'center' }, // top-center
  { x: 74, y: 10, anchor: 'center' }, // top-right
  { x: 93, y: 32, anchor: 'right' }, // right-upper
  { x: 94, y: 60, anchor: 'right' }, // right-lower
  { x: 80, y: 80, anchor: 'right' }, // bottom-right
];

// Hero HUD anchor — bottom-left; kept only as the emanation point for the hero's committed-bet
// chip + deal target (the hero plate itself is the off-ring <HeroHud>).
export const MOBILE_HERO_ANCHOR: SeatSlot = { x: 16, y: 86, anchor: 'center' };

/** Opponent slot list for a given total seat count (hero included in `n`). */
export function oppSlots(n: number): SeatSlot[] {
  if (n <= 2) return MOBILE_OPP_SLOTS_2MAX;
  return n <= 6 ? MOBILE_OPP_SLOTS_6MAX : MOBILE_OPP_SLOTS_9MAX;
}

// Contained wide oval (the felt no longer fills the whole screen — seats hug a centred oval like
// N8). ONE constant: widen/heighten here if the owner wants a larger table. ~92% wide, tall-oval
// aspect (≈ owner's 1:1.36); desktop keeps its landscape oval.
export const MOBILE_FELT_CLASS =
  'relative mx-auto w-[92%] max-w-md aspect-[7/10] max-h-full sm:aspect-[16/10] sm:w-full sm:max-w-3xl';
