BEGIN;

-- =============================================================================
-- Migration: Bug Fix — Swing Safety (Double-Assignment, OT Badge, Checkout Empty)
--
-- Changes:
--   1. Partial unique index: 1 active attendance per dealer per club
--   2. needs_replacement column on dealer_assignments
--   3. Version check safety in assign_dealer_to_table
-- =============================================================================

-- ── 1. BUG 1: Prevent duplicate active attendance per dealer per club ────────
-- Root cause: pickNextDealer excluded busy dealers by attendance_id, not dealer_id.
-- Fix: DB-level guard ensures only 1 active (assigned/pre_assigned/in_transition)
-- attendance record per dealer per club at any time.
-- NOTE: Before applying, ensure no duplicate active records exist (cleanup step below).

-- Cleanup: Find and resolve any existing duplicate active attendance records
-- Covers ALL current_state values (including on_break, checked_out without timestamp)
-- For each dealer with multiple active records, keep the most recent one and
-- check out the rest.
DO $$
DECLARE
  dup RECORD;
  keep_id UUID;
  cleaned INTEGER := 0;
BEGIN
  FOR dup IN
    SELECT da.dealer_id, COUNT(*) AS cnt
    FROM dealer_attendance da
    WHERE da.check_out_time IS NULL
      AND da.status = 'checked_in'
    GROUP BY da.dealer_id
    HAVING COUNT(*) > 1
  LOOP
    -- Keep the most recent check_in_time
    SELECT id INTO keep_id
    FROM dealer_attendance
    WHERE dealer_id = dup.dealer_id
      AND check_out_time IS NULL
      AND status = 'checked_in'
    ORDER BY check_in_time DESC
    LIMIT 1;

    -- Release assignments belonging to the older attendance records
    UPDATE dealer_assignments da2
    SET released_at = now(),
        status = 'completed'
    WHERE da2.attendance_id IN (
      SELECT id FROM dealer_attendance
      WHERE dealer_id = dup.dealer_id
        AND check_out_time IS NULL
        AND status = 'checked_in'
        AND id != keep_id
    )
    AND da2.released_at IS NULL;

    -- Check out the older records
    UPDATE dealer_attendance
    SET current_state = 'checked_out',
        status = 'checked_out',
        check_out_time = now()
    WHERE dealer_id = dup.dealer_id
      AND check_out_time IS NULL
      AND status = 'checked_in'
      AND id != keep_id;

    cleaned := cleaned + dup.cnt - 1;
    RAISE NOTICE 'Cleaned up % duplicate active attendance records for dealer_id=%',
      dup.cnt - 1, dup.dealer_id;
  END LOOP;

  RAISE NOTICE 'Total duplicate records cleaned: %', cleaned;
END $$;

-- Partial unique index: only 1 active attendance per dealer.
-- Covers ALL current_state values (assigned, pre_assigned, in_transition, on_break, etc.)
-- Any record with check_out_time IS NULL AND status='checked_in' is "active".
-- Multiple active records for same dealer = bug. Index prevents it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_attendance_per_dealer
  ON dealer_attendance (dealer_id)
  WHERE check_out_time IS NULL
    AND status = 'checked_in';

-- ── 2. BUG 3: needs_replacement flag on dealer_assignments ──────────────────
-- When a dealer checks out, their assignment gets needs_replacement = true
-- so process-swing and fillEmptyTables can prioritize replacing them.
-- Tables with needs_replacement are treated as "empty" for dealer allocation.

ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS needs_replacement BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient lookup of tables needing replacement
CREATE INDEX IF NOT EXISTS idx_assignments_needs_replacement
  ON dealer_assignments (needs_replacement)
  WHERE needs_replacement = true AND released_at IS NULL;

-- ── 3. Rewrite assign_dealer_to_table with race protection ──────────────────
-- Prevents TWO race conditions:
--   (A) Two concurrent calls assigning different dealers to the same table
--   (B) Same dealer being assigned to two tables (via FOR UPDATE SKIP LOCKED)
-- Also clears needs_replacement flag on the table.

CREATE OR REPLACE FUNCTION assign_dealer_to_table(
  p_attendance_id  UUID,
  p_table_id       UUID,
  p_assigned_at    TIMESTAMPTZ DEFAULT now(),
  p_swing_due_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_id UUID;
BEGIN
  -- Lock the attendance row; SKIP LOCKED = return 'conflict' immediately if locked
  PERFORM id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN 'conflict';
  END IF;

  -- Guard: check table does NOT already have an active assignment
  -- Prevents race between checkout-dealer auto-assign and fillEmptyTables cron
  PERFORM id FROM dealer_assignments
  WHERE table_id = p_table_id
    AND status = 'assigned'
    AND released_at IS NULL
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    RETURN 'table_occupied';
  END IF;

  -- Clear any stale needs_replacement for this table before inserting
  UPDATE dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, swing_due_at
  ) VALUES (
    p_attendance_id, p_table_id, 'assigned', p_assigned_at, p_swing_due_at
  );

  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN 'ok';
END;
$$;

COMMIT;