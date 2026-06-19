// B2.1 — scaled club-lock lease timeout.
// Pure, side-effect-free so it is unit-testable without importing process-swing
// (which has Deno.serve side effects). The process-swing run passes its existing
// SWING_THRESHOLDS constants in — this module is NOT the source of truth for them.
//
// Rationale: the per-club lock lease was hardcoded 120s, but a worst-case run is
// 80–200s and the cron fires every 60s → if a run overruns the lease, the next tick
// reclaims and two runners mutate the same club ("two-brains", FM-1). Scaling the
// lease by active-table count shrinks that overrun window.
//
// ⚠️ This is a MITIGATION only. It does NOT fix FM-2 (unconditional release_club_lock)
// or add fencing/tokens — that is B2.2. See docs/dealer-swing/B2_LOCK_LEASE_HARDENING_DESIGN.md.

export interface LockTimeoutConstants {
  /** Floor lease (today's hardcoded value), e.g. 120. */
  baseSeconds: number;
  /** Added per active table, e.g. 10. */
  perTableSeconds: number;
  /** Hard cap, e.g. 300. */
  maxSeconds: number;
}

/**
 * timeoutSec = min(maxSeconds, baseSeconds + perTableSeconds * max(0, activeTableCount))
 *
 * A non-finite / negative count is treated as 0 → returns baseSeconds (today's behavior),
 * so a bad count can never shorten the lease below the floor.
 */
export function scaleLockTimeoutSeconds(
  activeTableCount: number,
  c: LockTimeoutConstants,
): number {
  const n = Number.isFinite(activeTableCount) && activeTableCount > 0
    ? Math.floor(activeTableCount)
    : 0;
  return Math.min(c.maxSeconds, c.baseSeconds + c.perTableSeconds * n);
}
