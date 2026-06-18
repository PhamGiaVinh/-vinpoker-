// src/lib/onlinePoker/tableDisplay.ts
// Pure helpers for the online-poker TABLE VIEW staleness rules (PR C). Display-only —
// no server authority. Used by OnlinePokerTable to decide when a completed hand's
// board/result should NOT be shown (closed table, or no players seated) and to drive
// the "Bàn trống / chưa có hand đang chạy" empty state.

/** Number of seats currently held by a player. */
export function occupiedCount(seats: ReadonlyArray<{ userId: string | null }>): number {
  return seats.reduce((n, s) => (s.userId ? n + 1 : n), 0);
}

/**
 * A table is "live" — worth showing a hand / result for — only when it is NOT closed
 * AND at least one player is seated. A closed table or an empty table must never show a
 * stale final board: callers suppress the dwell/cinematic and render the empty state.
 */
export function isTableLive(status: string | null | undefined, occupied: number): boolean {
  return status !== 'closed' && occupied > 0;
}

/** The empty-state line under the felt when no hand is running. */
export function emptyStateLabel(status: string | null | undefined, occupied: number): string {
  if (status === 'closed') return 'Bàn đã đóng';
  if (occupied === 0) return 'Bàn trống · chưa có người chơi';
  return 'Chưa có hand đang chạy';
}
