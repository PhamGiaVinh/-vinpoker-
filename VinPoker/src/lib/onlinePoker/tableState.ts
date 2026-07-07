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

// ── action fast-path (Mức C) — snapshot ordering + legal-menu keying ──────────

/** A hand snapshot's position in server time. `handNo` may arrive as a string (bigint over
 *  the wire) — it is normalized via BigInt, NEVER compared lexicographically ("10" < "2"). */
export interface HandSnapId {
  handNo: number | string;
  stateVersion: number | string;
}

/**
 * HIGH-WATER guard for ingesting hand snapshots. Accept iff the incoming snapshot is
 * strictly newer than the newest EVER SEEN:
 *   handNo > cur.handNo  ||  (handNo === cur.handNo && stateVersion > cur.stateVersion)
 * `cur` is the high-water mark, NOT "the currently visible hand" — a poll returning no hand
 * must NOT lower it (a late response from an older hand would otherwise resurrect it). It
 * resets only when the tableId truly changes (hook re-mount).
 * Returns false on malformed input (fail-closed: never let a garbage snapshot in).
 */
export function isNewerHandSnap(cur: HandSnapId | null, next: HandSnapId): boolean {
  let nextHand: bigint, curHand: bigint | null = null;
  try {
    nextHand = BigInt(next.handNo);
    if (cur != null) curHand = BigInt(cur.handNo);
  } catch {
    return false; // malformed handNo — drop
  }
  const nextVer = Number(next.stateVersion);
  if (!Number.isFinite(nextVer)) return false;
  if (curHand == null) return true;
  if (nextHand > curHand) return true; // new hand (its stateVersion restarts at 0)
  if (nextHand < curHand) return false; // older hand can NEVER come back
  const curVer = Number(cur!.stateVersion);
  return nextVer > curVer;
}

/**
 * Legal-menu fetch key — ONE fetch per (hand, state) while it is genuinely my turn, instead
 * of every poll tick. `op_submit_action` bumps state_version on EVERY action (incl. checks/
 * folds and timeout force-folds), so a raise that re-opens action always produces a NEW key
 * → refetch with the new toCall/minRaiseTo. Off-turn / non-betting / spectator → null
 * (null ⇒ clear the menu immediately).
 */
export function legalFetchKey(
  view: { handId: string; status: string; toActSeat: number | null } | null,
  mySeat: number | null,
  stateVersion: number | string | null,
): string | null {
  if (!view || mySeat == null || stateVersion == null) return null;
  if (view.status !== 'betting' || view.toActSeat !== mySeat) return null;
  return `${view.handId}:${stateVersion}`;
}

/**
 * Classify a submit_action response for the client's follow-up:
 *   'rejected' → server said no (show the code, no refetch needed);
 *   'fastpath' → ok AND the engine's post-action view is present → render it now;
 *   'refetch'  → ok but no view (older deployed edge / unexpected shape) → the OLD
 *                refresh path. Fail-open to 'refetch' so the UI never dead-ends.
 */
export function classifySubmitResult(res: unknown): 'rejected' | 'fastpath' | 'refetch' {
  if (!res || typeof res !== 'object') return 'refetch';
  const r = res as { ok?: unknown; view?: unknown; stateVersion?: unknown };
  if (r.ok === false) return 'rejected';
  if (r.ok === true && r.view && typeof r.view === 'object' && r.stateVersion !== undefined) return 'fastpath';
  return 'refetch';
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
