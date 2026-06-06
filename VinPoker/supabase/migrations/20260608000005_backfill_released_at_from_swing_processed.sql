-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260608000005_backfill_released_at_from_swing_processed.sql
--
-- BUG FIX (part 1 of 2): Bàn 10 fix is not enforcing 10-min rest in production.
--
-- Root cause: migration 20260801000003_rpc_pre_assign_cleanup.sql rewrote
--   execute_pre_assigned_swing [6] UPDATE without setting `released_at`.
--   Both pre_assign_next_dealer_for_table (RPC) and dealer_shift_metrics (view)
--   query dealer_assignments.released_at to compute rest time. With that
--   column permanently NULL for pre-assigned swings, rest time falls back to
--   check_in_time (days ago), so the 10-min guard never fires.
--
-- Symptom: dl 10 was assigned to Bàn 14 at 09:35 — only 5 min after swing
--   ended at 09:30 on Bàn 11.
--
-- This migration backfills historical rows:
--   released_at := swing_processed_at for all 'completed' or 'on_break'
--   assignments where released_at IS NULL but swing_processed_at IS set.
--
-- Part 2 (separate migration 20260608000006) patches execute_pre_assigned_swing
-- so future rows are populated correctly.
--
-- IDEMPOTENT: re-running on already-fixed rows is a no-op (WHERE released_at IS NULL).
-- ════════════════════════════════════════════════════════════════════════════

UPDATE dealer_assignments
SET
  released_at = swing_processed_at,
  version     = COALESCE(version, 1)
WHERE released_at IS NULL
  AND swing_processed_at IS NOT NULL
  AND status IN ('completed', 'on_break');

-- ════════════════════════════════════════════════════════════════════
-- Sanity check
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_total   BIGINT;
  v_fixed   BIGINT;
  v_remaining BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM dealer_assignments
  WHERE status IN ('completed', 'on_break')
    AND swing_processed_at IS NOT NULL;

  SELECT COUNT(*) INTO v_fixed
  FROM dealer_assignments
  WHERE status IN ('completed', 'on_break')
    AND released_at IS NOT NULL
    AND swing_processed_at IS NOT NULL;

  SELECT COUNT(*) INTO v_remaining
  FROM dealer_assignments
  WHERE status IN ('completed', 'on_break')
    AND released_at IS NULL
    AND swing_processed_at IS NOT NULL;

  RAISE NOTICE 'Backfill report: total=%, fixed=%, remaining=%', v_total, v_fixed, v_remaining;
END $$;
