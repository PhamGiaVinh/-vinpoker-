// src/lib/onlinePoker/tableState.ts
// P0 repair — the pure decision functions behind the leave/rejoin, empty-table, and deal-
// animation fixes. Kept pure + standalone so they are unit-testable (the live hooks can't
// run under RUNTIME_LIVE=false). No network, no React.

import type { PublicHandView, PublicSeatView, LobbyTableSummary } from './types';

/**
 * My current seat — AUTHORITATIVE from the LIVE seats table, never a stale completed-hand
 * snapshot. The rejoin P0 bug was that a lingering `hand.mySeat` outranked the live seats,
 * so after leaving the client still thought I was seated. There is no hand parameter here
 * by design: "am I seated" is decided ONLY by whether the live seats hold my uid.
 */
export function deriveMySeatNo(
  seats: ReadonlyArray<{ userId: string | null; seatNo: number }>,
  uid: string | null,
): number | null {
  if (!uid) return null;
  return seats.find((s) => s.userId === uid)?.seatNo ?? null;
}

/** Seats currently contesting the live hand (i.e. that got cards). */
export function inHandSeats(seats: ReadonlyArray<PublicSeatView>): number[] {
  return seats.filter((s) => s.playerId && (s.status === 'active' || s.status === 'allin')).map((s) => s.seat);
}

/**
 * Whether a fresh deal just happened — drives the deal animation, decoupled from the result
 * dwell. Fires ONLY when a KNOWN previous hand transitions to a NEW hand whose board is
 * still empty, with ≥2 players in the hand. Returns fire=false on the first snapshot
 * (prevHandId null) and on a re-poll of the same hand.
 */
export function shouldDealSignal(
  prevHandId: string | null,
  view: { handId: string; board: string[]; seats: PublicSeatView[] },
): { fire: boolean; dealSeats: number[] } {
  const seatsInHand = inHandSeats(view.seats);
  const fire =
    !!prevHandId && !!view.handId && view.handId !== prevHandId &&
    (view.board?.length ?? 0) === 0 && seatsInHand.length >= 2;
  return { fire, dealSeats: fire ? seatsInHand : [] };
}

/** Lobby hides EMPTY tables (0 seated) — a stale leftover or a just-emptied table is never
 *  joinable; a freshly created table keeps its host seated (seatedCount ≥ 1). */
export function filterLobbyTables(tables: LobbyTableSummary[]): LobbyTableSummary[] {
  return tables.filter((t) => t.seatedCount > 0);
}

/** True ONLY when MY seat is genuinely contesting the live hand (active/allin) — the single
 *  case the server blocks a leave (chip conservation). Just being at the table while others
 *  play does NOT count. */
export function iAmInLiveHand(hand: PublicHandView | null, mySeatNo: number | null): boolean {
  if (!hand || mySeatNo == null) return false;
  if (hand.status !== 'dealing' && hand.status !== 'betting') return false;
  return hand.seats.some((s) => s.seat === mySeatNo && (s.status === 'active' || s.status === 'allin'));
}

/** The transient cards a deal flourish flies — two rounds, ONLY to occupied `seats` that
 *  have a known position. Never to empty chairs. */
export function dealFlyCards(
  seats: number[],
  pos: Record<number, { x: number; y: number }>,
): Array<{ x: number; y: number; delay: number }> {
  const ordered = [...new Set(seats)].sort((a, b) => a - b).filter((s) => pos[s]);
  const cards: Array<{ x: number; y: number; delay: number }> = [];
  let k = 0;
  for (let round = 0; round < 2; round++) {
    for (const s of ordered) { cards.push({ x: pos[s].x, y: pos[s].y, delay: k * 75 }); k++; }
  }
  return cards;
}
