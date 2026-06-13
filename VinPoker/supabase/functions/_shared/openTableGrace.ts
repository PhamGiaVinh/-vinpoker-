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
