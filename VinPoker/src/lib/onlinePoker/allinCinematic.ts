// src/lib/onlinePoker/allinCinematic.ts
// PURE cinematic state machine for the all-in runout replay. It decides ONLY what the
// UI shows at each phase (which board cards, which hole cards, which equity) — it never
// decides the winner/payout/stacks; those come from the server `result`. The component
// (AllInRunout.tsx) drives these phases with timers and renders them.

import type { PublicHandView, PublicSeatView } from './types';

export type CinematicPhaseKey =
  | 'allin_banner' | 'reveal_first' | 'reveal_second'
  | 'flop' | 'flop_equity' | 'turn' | 'turn_equity' | 'river' | 'final_result';

export interface CinematicPhase {
  key: CinematicPhaseKey;
  /** community cards visible at this phase (0 / 3 / 4 / 5). */
  boardVisible: number;
  /** how many of the ordered reveal-seats are face-up (0 / 1 / 2). */
  revealCount: number;
  /** board length whose equity to display, or 0 = no equity shown yet (preflop). */
  equityBoardLen: number;
  durationMs: number;
}

/** The staged runout timeline. board: 0 → 3 → 4 → 5; reveals: 0 → 1 → 2; equity from flop. */
export const ALLIN_CINEMATIC_PHASES: readonly CinematicPhase[] = [
  { key: 'allin_banner',  boardVisible: 0, revealCount: 0, equityBoardLen: 0, durationMs: 1000 },
  { key: 'reveal_first',  boardVisible: 0, revealCount: 1, equityBoardLen: 0, durationMs: 900 },
  { key: 'reveal_second', boardVisible: 0, revealCount: 2, equityBoardLen: 0, durationMs: 1000 },
  { key: 'flop',          boardVisible: 3, revealCount: 2, equityBoardLen: 3, durationMs: 1100 },
  { key: 'flop_equity',   boardVisible: 3, revealCount: 2, equityBoardLen: 3, durationMs: 1400 },
  { key: 'turn',          boardVisible: 4, revealCount: 2, equityBoardLen: 4, durationMs: 1000 },
  { key: 'turn_equity',   boardVisible: 4, revealCount: 2, equityBoardLen: 4, durationMs: 1300 },
  { key: 'river',         boardVisible: 5, revealCount: 2, equityBoardLen: 5, durationMs: 1100 },
  { key: 'final_result',  boardVisible: 5, revealCount: 2, equityBoardLen: 5, durationMs: 8000 },
] as const;

/** Total replay length — used to hold the dwell snapshot for the whole cinematic. */
export const ALLIN_CINEMATIC_TOTAL_MS = ALLIN_CINEMATIC_PHASES.reduce((a, p) => a + p.durationMs, 0);

export interface AllInPlan {
  isAllInShowdown: boolean;
  /** seats that revealed cards (showdown participants), reveal order. */
  revealOrder: number[];
  /** exactly two eligible → heads-up equity may be computed; else hide equity. */
  headsUp: boolean;
}

function eligibleSeats(hand: PublicHandView): PublicSeatView[] {
  return hand.seats.filter((s) => Array.isArray(s.revealedCards) && s.revealedCards!.length === 2);
}

/**
 * An all-in showdown worth the cinematic: a completed hand that ended at showdown with a
 * full 5-card board, at least two revealed hands, and at least one seat that finished
 * all-in (which distinguishes it from a checked-down showdown whose board was already
 * dealt street-by-street during play).
 */
export function isAllInShowdown(hand: PublicHandView | null | undefined): boolean {
  if (!hand) return false;
  if (hand.status !== 'complete') return false;
  if (hand.result?.endedBy !== 'showdown') return false;
  if ((hand.board?.length ?? 0) !== 5) return false;
  if (eligibleSeats(hand).length < 2) return false;
  return hand.seats.some((s) => s.status === 'allin');
}

/**
 * Plan the reveal. Reveal order is by seat number (a safe, honest fallback — the public
 * snapshot carries no action log, so we do NOT assert who jammed first; banners say
 * "Ghế X lật bài", not "Ghế X jam"). `headsUp` gates equity to the exact 2-player case.
 */
export function planAllInCinematic(hand: PublicHandView): AllInPlan {
  const elig = eligibleSeats(hand).map((s) => s.seat).sort((a, b) => a - b);
  return { isAllInShowdown: isAllInShowdown(hand), revealOrder: elig, headsUp: elig.length === 2 };
}
