-- ROLLBACK for 20260609000001: recreate idx_unique_active_attendance
--
-- ROOT CAUSE: Migration 20260609000001 dropped idx_unique_active_attendance
-- assuming idx_one_active_per_dealer was a strict superset and would cover
-- all queries. However, PostgreSQL's ON CONFLICT inference requires the
-- partial unique index WHERE clause to be a logical consequence of the
-- ON CONFLICT WHERE clause.
--
-- 30 SQL functions use:
--   ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
--
-- idx_one_active_per_dealer has predicate:
--   WHERE (released_at IS NULL AND status = ANY (ARRAY['assigned', 'on_break']))
--
-- The function's WHERE (status = 'assigned') is logically a subset of
-- the index's status IN ('assigned', 'on_break'), but PostgreSQL's
-- inference algorithm does NOT consider it a match (it requires the
-- index WHERE to be IMPLIED by the ON CONFLICT WHERE, not the reverse).
--
-- SYMPTOM (2026-06-07 02:00-09:00): Every execute_pre_assigned_swing call
-- returned HTTP 200 but the INSERT failed with:
--   "ERROR: 42P10: there is no unique or exclusion constraint matching
--    the ON CONFLICT specification"
-- Result: 5 stuck tables (Bàn 10/100/266/6ab7/7630), all stuck for 13+ min,
-- pre-assigned dealers never executed. The pass3_query_issue diagnostic
-- fired every minute, but no pre-assigned swing_log entries were created.
--
-- FIX: Recreate the index to restore ON CONFLICT inference for all 30
-- functions. The two indexes together provide:
--   - idx_one_active_per_dealer: catches all active states (assigned + on_break)
--   - idx_unique_active_attendance: ON CONFLICT inference for INSERT statements
--
-- This is forward-only: no data loss, idempotent.
--
-- Affects: execute_pre_assigned_swing, perform_swing, perform_swing overloads,
-- short_notice_ot_bonus, drift_compensation, all the fix_* migrations.

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_attendance
  ON public.dealer_assignments (attendance_id)
  WHERE (status = 'assigned'::text);

COMMENT ON INDEX public.idx_unique_active_attendance IS
  'Partial unique index for ON CONFLICT inference in INSERT statements. '
  'Restored 2026-06-07 after rollback investigation showed 30 SQL functions '
  'depend on it. Companion to idx_one_active_per_dealer (which covers the '
  'broader assigned+on_break+released_at IS NULL case). DO NOT DROP without '
  'migrating all ON CONFLICT clauses first.';
