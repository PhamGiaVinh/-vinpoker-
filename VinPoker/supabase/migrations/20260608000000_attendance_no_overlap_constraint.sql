-- =============================================================================
-- Migration: 20260608000000_attendance_no_overlap_constraint.sql
-- Day 2 constraint: Prevent overlapping check-in intervals in dealer_attendance
--
-- EXCLUDE constraints cannot be NOT VALID in PostgreSQL, so we use a
-- trigger-based check instead. The trigger fires on INSERT and UPDATE of
-- check_in_time, check_out_time, status, dealer_id.
--
-- Defense-in-depth beyond existing idx_one_active_checkin_per_dealer:
--   - idx_one_active_checkin_per_dealer: UNIQUE on (dealer_id, shift_date)
--     WHERE status='checked_in' (prevents ACTIVE duplicates only)
--   - trg_attendance_no_overlap: blocks ANY overlap in tstzrange between
--     active attendances of same dealer (forward-looking)
--
-- Existing data:
--   - 7 dealers have stale test data with overlapping intervals
--   - Trigger does NOT retroactively check existing rows
--   - Run cleanup task: DELETE FROM dealer_attendance WHERE dealer_id IN (...)
--     to remove test artifacts. After cleanup, no future overlaps can occur.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION check_attendance_no_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_conflict_id UUID;
  v_conflict_in TIMESTAMPTZ;
  v_conflict_out TIMESTAMPTZ;
BEGIN
  -- Only check for active attendances
  IF NEW.status NOT IN ('checked_in', 'checked_out') THEN
    RETURN NEW;
  END IF;

  -- Find any overlapping attendance for same dealer
  SELECT id, check_in_time, check_out_time
  INTO v_conflict_id, v_conflict_in, v_conflict_out
  FROM dealer_attendance
  WHERE dealer_id = NEW.dealer_id
    AND id != NEW.id
    AND status IN ('checked_in', 'checked_out')
    AND tstzrange(check_in_time, COALESCE(check_out_time, 'infinity'::timestamptz))
        && tstzrange(NEW.check_in_time, COALESCE(NEW.check_out_time, 'infinity'::timestamptz))
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance overlap: dealer % has conflicting attendance % (%) overlapping with new record (%)',
      NEW.dealer_id, v_conflict_id,
      v_conflict_in || ' - ' || COALESCE(v_conflict_out::TEXT, 'open'),
      NEW.check_in_time || ' - ' || COALESCE(NEW.check_out_time::TEXT, 'open')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_no_overlap ON dealer_attendance;

CREATE TRIGGER trg_attendance_no_overlap
  BEFORE INSERT OR UPDATE OF check_in_time, check_out_time, status, dealer_id
  ON dealer_attendance
  FOR EACH ROW
  EXECUTE FUNCTION check_attendance_no_overlap();

COMMENT ON TRIGGER trg_attendance_no_overlap ON dealer_attendance IS
  'Day 2 constraint: prevent overlapping attendance intervals for same dealer. Applied 2026-06-08. Existing 7 test-data overlaps are not retroactively checked (trigger is forward-looking only). Cleanup task: delete stale test records.';
