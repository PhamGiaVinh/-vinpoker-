-- Migration: 20260611000000_null_safe_attendance_index.sql
-- Fixes Bug 3: duplicate dealer_attendance records when shift_id IS NULL
-- PostgreSQL NULL != NULL means the existing UNIQUE(dealer_id, shift_id, shift_date)
-- does NOT prevent duplicates when shift_id is null.
-- This partial index fills that gap.

BEGIN;

-- ─── Partial unique index for no-shift check-ins ─────────────────────────────
-- Enforces: at most 1 attendance record per (dealer, date) when shift_id is NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_no_shift
  ON dealer_attendance (dealer_id, shift_date)
  WHERE shift_id IS NULL;

-- ─── Clean up any existing duplicates before index takes effect ───────────────
-- Keep only the most recent record per (dealer_id, shift_date) where shift_id is null
DELETE FROM dealer_attendance
WHERE shift_id IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (dealer_id, shift_date) id
    FROM dealer_attendance
    WHERE shift_id IS NULL
    ORDER BY dealer_id, shift_date, check_in_time DESC NULLS LAST
  );

-- ─── Verify ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'dealer_attendance'
      AND indexname = 'idx_attendance_no_shift'
  ), 'Partial index idx_attendance_no_shift not created';

  -- Verify no duplicates remain
  ASSERT NOT EXISTS (
    SELECT dealer_id, shift_date
    FROM dealer_attendance
    WHERE shift_id IS NULL
    GROUP BY dealer_id, shift_date
    HAVING COUNT(*) > 1
  ), 'Duplicate attendance records still exist after cleanup';

  RAISE NOTICE '✓ Migration 20260611000000 passed - null-safe attendance index created';
END;
$$;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_attendance_no_shift;
