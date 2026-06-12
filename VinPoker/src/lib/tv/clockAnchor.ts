/**
 * Drift-proof countdown anchor. The server reports remaining_seconds at fetch
 * time; the TV derives the displayed value from a monotonic clock instead of
 * counting ticks, so throttled timers and OS clock jumps cannot drift it.
 */
export interface ClockAnchor {
  /** remaining_seconds reported by get_tournament_clock at fetch time */
  remainingAtFetch: number;
  /** performance.now() captured when the fetch resolved */
  anchorMs: number;
  isRunning: boolean;
}

export function displayedRemaining(anchor: ClockAnchor | null, nowMs: number): number {
  if (!anchor) return 0;
  if (!anchor.isRunning) return Math.max(0, Math.round(anchor.remainingAtFetch));
  const elapsed = (nowMs - anchor.anchorMs) / 1000;
  return Math.max(0, Math.round(anchor.remainingAtFetch - elapsed));
}
