BEGIN;

-- =============================================================================
-- Migration: Allow multiple attendance records per dealer per day
--
-- Why:
--   Previously 1 dealer could only have 1 attendance record per day (UNIQUE
--   constraint on dealer_id + shift_id + shift_date + partial index for NULL
--   shift_id). This meant re-check-in had to UPDATE the existing record,
--   DESTROYING the previous session's check_in_time/check_out_time and
--   breaking payroll (get_dealer_payroll computes hours from those columns).
--
-- Changes:
--   1. Drop UNIQUE constraint + partial unique index
--   2. Add non-unique performance indexes
--   3. Add partial UNIQUE index — only 1 active checked_in per dealer per day
--   4. Create dealer_latest_attendance VIEW (DISTINCT ON latest record)
--
-- Rollback:
--   DROP INDEX idx_attendance_dealer_date;
--   DROP INDEX idx_attendance_dealer_shift_date;
--   DROP INDEX idx_one_active_checkin_per_dealer;
--   DROP VIEW dealer_latest_attendance;
--   CREATE UNIQUE INDEX idx_attendance_no_shift ON dealer_attendance
--     (dealer_id, shift_date) WHERE shift_id IS NULL;
--   ALTER TABLE dealer_attendance ADD CONSTRAINT
--     dealer_attendance_dealer_id_shift_id_shift_date_key
--     UNIQUE (dealer_id, shift_id, shift_date);
-- =============================================================================

-- ==========================================
-- Step 1: Drop old unique constraints
-- ==========================================
ALTER TABLE dealer_attendance
DROP CONSTRAINT IF EXISTS
  dealer_attendance_dealer_id_shift_id_shift_date_key;

DROP INDEX IF EXISTS idx_attendance_no_shift;

-- ==========================================
-- Step 2: Performance indexes (non-unique)
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_attendance_dealer_date
ON dealer_attendance (dealer_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_attendance_dealer_shift_date
ON dealer_attendance (dealer_id, shift_id, shift_date);

-- ==========================================
-- Step 3: Partial unique — prevent double active check-in
-- Allows multiple 'checked_out' records per dealer per day
-- But ONLY one 'checked_in' record per dealer per day
-- ==========================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_checkin_per_dealer
ON dealer_attendance (dealer_id, shift_date)
WHERE status = 'checked_in';

-- ==========================================
-- Step 4: View — latest attendance per dealer per day
-- DISTINCT ON (dealer_id, shift_date) with ORDER BY check_in_time DESC
-- ensures the newest record is always returned.
-- JOIN with dealers to expose club_id (dealer_attendance doesn't have it).
-- ==========================================
CREATE OR REPLACE VIEW dealer_latest_attendance AS
SELECT DISTINCT ON (da.dealer_id, da.shift_date)
  da.id,
  da.dealer_id,
  da.shift_id,
  da.shift_date,
  da.status,
  da.current_state,
  da.check_in_time,
  da.check_out_time,
  da.overtime_minutes,
  da.worked_minutes_since_last_break,
  da.priority_break_flag,
  da.pre_assigned_table_id,
  da.pre_assigned_at,
  da.created_at,
  d.club_id
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
ORDER BY
  da.dealer_id,
  da.shift_date,
  da.check_in_time DESC;

COMMENT ON VIEW dealer_latest_attendance IS
  'Latest attendance record per dealer per shift_date. '
  'DISTINCT ON ensures only newest check-in is returned. '
  'Use for active state queries — never for payroll aggregation '
  '(use dealer_attendance table directly for payroll).';

-- ==========================================
-- Step 5: Verify
-- ==========================================
DO $$
BEGIN
  -- Verify unique constraint dropped
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dealer_attendance_dealer_id_shift_id_shift_date_key'
  ) THEN
    RAISE EXCEPTION 'UNIQUE constraint still exists — migration failed';
  END IF;

  -- Verify new partial index created
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_one_active_checkin_per_dealer'
  ) THEN
    RAISE EXCEPTION 'Partial unique index not created — migration failed';
  END IF;

  -- Verify view created
  IF NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE viewname = 'dealer_latest_attendance'
  ) THEN
    RAISE EXCEPTION 'View dealer_latest_attendance not created — migration failed';
  END IF;

  RAISE NOTICE '✅ Migration 20260630000000 verified successfully';
END $$;

COMMIT;
