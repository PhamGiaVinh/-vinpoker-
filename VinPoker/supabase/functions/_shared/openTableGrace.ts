import { SWING_POLICY } from "./swingPolicy.ts";

// Open-table warmup grace (owner policy 2026-06-14).
//
// When a dealer is assigned to OPEN/staff a table (manual "Gán dealer" or the
// mass-assign / fillEmptyTables open-empty-tables path), the swing clock must NOT
// start immediately. Instead the incoming dealer gets a OPEN_TABLE_GRACE_MINUTES
// warmup: swing_due_at is pushed out by this many minutes so the table is not
// counted overdue during setup. The frontend shows "Vào swing sau M:SS" for the
// grace window (mirrored constant in src/lib/breakPoolState.ts).
//
// This applies ONLY to opening/staffing a table — NOT to perform_swing rotation
// handoffs, which keep their existing timing. Set to 0 to disable the grace.
export const OPEN_TABLE_GRACE_MINUTES = 6;

/**
 * Centered stagger offset (ms) for table `index` of a MANUAL bulk-open of `count`
 * tables (F1, 2026-07-08). Spreads only the TARGET swing_due_at so a "Gán loạt"
 * of N tables doesn't come due as one wave; it NEVER force-releases anyone.
 *   offset = (index − (count−1)/2) * staggerStep, clamped to ±maxStagger
 * so a very large batch can't push a table's target due absurdly late. Symmetric
 * → the batch mean due is unchanged. count <= 1 (or non-finite) → 0. The caller
 * (fillEmptyTables) keeps this at 0 on the auto-staff path.
 */
export function bulkOpenStaggerMs(index: number, count: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 1) return 0;
  const stepMs = SWING_POLICY.bulkOpen.staggerStepMinutes * 60_000;
  const capMs = SWING_POLICY.bulkOpen.maxStaggerMinutes * 60_000;
  const rawMs = (index - (count - 1) / 2) * stepMs;
  return Math.round(Math.max(-capMs, Math.min(capMs, rawMs)));
}
