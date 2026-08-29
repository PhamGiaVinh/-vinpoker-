-- ============================================================================
-- ROOM RECONCILE apply-timeout fix: partial indexes on ACTIVE dealer_assignments
--
-- Symptom (owner-reported 2026-07-07): "Sửa nhầm bàn" — the dry-run PREVIEW
-- returns fine, but pressing APPLY errors with
--   "canceling statement due to statement timeout".
--
-- Root cause: reconcile_dealer_room_state's APPLY path (skipped in dry-run) runs
-- phase P1 lock acquisition on dealer_assignments:
--     SELECT ... FROM dealer_assignments
--     WHERE released_at IS NULL AND status IN ('assigned','on_break')
--       AND (table_id = ANY($tables)
--            OR attendance_id = ANY($att)
--            OR pre_assigned_attendance_id = ANY($att))
--     ORDER BY id FOR UPDATE;
-- The existing partial indexes are WHERE status='assigned' ONLY (they don't cover
-- 'on_break'), and there is NO index on pre_assigned_attendance_id at all, so this
-- 3-way OR cannot use an index for the on_break / pre_assigned branches and falls
-- back to a sequential scan of the whole history-heavy dealer_assignments table
-- (every assignment ever) — under FOR UPDATE — which exceeds statement_timeout.
-- The dry-run works because it skips P1 (it takes NO locks). The live DB is also
-- known to have drifted from migrations, so some expected indexes may be absent.
--
-- Fix: four PARTIAL indexes whose predicate matches the RPC's exact "active" filter
-- (released_at IS NULL AND status IN ('assigned','on_break')). The planner can then
-- BitmapOr three tiny index scans (only the handful of live rows) instead of
-- scanning all history. No data change; safe and additive.
--
-- ⚠️ APPLY OUTSIDE A TRANSACTION. CREATE INDEX CONCURRENTLY cannot run inside a
--    transaction block, so this migration must NOT be wrapped in one (run each
--    statement standalone, e.g. Supabase SQL Editor line-by-line, or a
--    non-transactional apply). CONCURRENTLY avoids locking the live table during
--    the build. If your runner forces a transaction, drop CONCURRENTLY (brief
--    ACCESS EXCLUSIVE lock during the build — acceptable off-peak).
-- SOURCE-ONLY: do NOT apply live without owner approval (manual-gated).
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS <name>;  (all four).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_da_active_table
  ON public.dealer_assignments (table_id)
  WHERE released_at IS NULL AND status IN ('assigned', 'on_break');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_da_active_attendance
  ON public.dealer_assignments (attendance_id)
  WHERE released_at IS NULL AND status IN ('assigned', 'on_break');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_da_active_club
  ON public.dealer_assignments (club_id)
  WHERE released_at IS NULL AND status IN ('assigned', 'on_break');

-- The OR branch that has NO existing index at all — the likeliest single cause of
-- the sequential scan under FOR UPDATE.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_da_active_preassigned
  ON public.dealer_assignments (pre_assigned_attendance_id)
  WHERE released_at IS NULL AND status IN ('assigned', 'on_break')
        AND pre_assigned_attendance_id IS NOT NULL;
