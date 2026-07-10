import { describe, it, expect } from 'vitest';
import {
  TRACKER_PORTRAIT_SEATS_FIX,
  TRACKER_PORTRAIT_SEATS,
  DEALER_ANCHOR,
} from './constants';

/**
 * Geometry pin for the RICH operator tracker felt in PORTRAIT with `trackerFeltDealerFix` ON.
 *
 * The rich pods are large (~84×125px, including the hole-card backs shown at showdown reveal).
 * On the old 5/6 oval the base `TRACKER_PORTRAIT_SEATS` map left the 9 pods crowded at 390px
 * portrait — 5 pod-pod overlaps (seats 1×2, 2×3, 3×4, 6×7, 8×9) and seats 1/9 intersecting the
 * dealer block — measured on /__dev/tracker. `TRACKER_PORTRAIT_SEATS_FIX`, on the taller
 * `PORTRAIT_FIX_ASPECT` (5/8) oval, spaces every pod out. This test pins that layout: a future
 * anchor edit that re-introduces crowding fails HERE instead of shipping to the operator.
 *
 * Boxes are modelled at the measured 390px reference (felt 351×562px). Each pod is a fixed
 * 84×128px box centred on its anchor (pods render translate(-50%,-50%)); the dealer station is
 * a 128×64px box at DEALER_ANCHOR. Pod height and dealer size are padded above the measured
 * maxima (~125 / ~122×62) so the pin carries built-in margin.
 */

// Measured reference at a 390px viewport (rich ON, dealerFix ON).
const FELT_W = 351;
const FIX_FELT_H = 562; // taller PORTRAIT_FIX_ASPECT (5/8) oval
const BASE_FELT_H = 421; // old 5/6 oval — used only by the detector-sanity case
const POD_W = 84;
const POD_H = 128; // measured max ~125, padded
const DEALER_W = 128; // measured ~122, padded
const DEALER_H = 64; // measured ~62, padded

type Box = { x: number; y: number; w: number; h: number };
type Anchor = { left: number; top: number };

/** Centre-anchored box (percent of felt) → absolute px rect (pods are translate(-50%,-50%)). */
function box(a: Anchor, w: number, h: number, feltW: number, feltH: number): Box {
  return { x: (a.left / 100) * feltW - w / 2, y: (a.top / 100) * feltH - h / 2, w, h };
}

/** Positive overlap area between two boxes, else 0. */
function overlapArea(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

/** Separation between two boxes on their nearest axis (negative ⇒ overlapping). */
function clearance(a: Box, b: Box): number {
  const gx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
  const gy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.max(gx, gy);
}

const SEATS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function podBoxes(map: Record<number, Anchor>, feltH: number): Record<number, Box> {
  const out: Record<number, Box> = {};
  for (const n of SEATS) out[n] = box(map[n], POD_W, POD_H, FELT_W, feltH);
  return out;
}

describe('TrackerRacetrack portrait de-crowding (trackerFeltDealerFix ON)', () => {
  const fix = podBoxes(TRACKER_PORTRAIT_SEATS_FIX, FIX_FELT_H);
  const dealer = box(DEALER_ANCHOR, DEALER_W, DEALER_H, FELT_W, FIX_FELT_H);

  it('has no two rich pods overlapping at the 390px reference', () => {
    const hits: string[] = [];
    for (let i = 0; i < SEATS.length; i++) {
      for (let j = i + 1; j < SEATS.length; j++) {
        const a = SEATS[i];
        const b = SEATS[j];
        if (overlapArea(fix[a], fix[b]) > 0) hits.push(`${a}x${b}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('has no rich pod intersecting the dealer station', () => {
    const hits = SEATS.filter((n) => overlapArea(fix[n], dealer) > 0);
    expect(hits).toEqual([]);
  });

  it('keeps a safety margin (min pairwise clearance ≥ 4px)', () => {
    const boxes = [...SEATS.map((n) => fix[n]), dealer];
    let min = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        min = Math.min(min, clearance(boxes[i], boxes[j]));
      }
    }
    expect(min).toBeGreaterThanOrEqual(4);
  });

  it('detector sanity: the un-fixed base map on the old 5/6 oval is crowded', () => {
    // Guards the model itself: proves a green "fix" result is meaningful, and documents the bug.
    const base = podBoxes(TRACKER_PORTRAIT_SEATS, BASE_FELT_H);
    let overlaps = 0;
    for (let i = 0; i < SEATS.length; i++) {
      for (let j = i + 1; j < SEATS.length; j++) {
        if (overlapArea(base[SEATS[i]], base[SEATS[j]]) > 0) overlaps++;
      }
    }
    expect(overlaps).toBeGreaterThanOrEqual(5);
  });
});
