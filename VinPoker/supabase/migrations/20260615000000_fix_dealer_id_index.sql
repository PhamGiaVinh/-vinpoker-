-- =============================================================================
-- Migration: Replace IMMUTABLE functional index with proper dealer_id column
--
-- Problem: Old index used IMMUTABLE function dealer_id_from_attendance() that
-- reads from dealer_attendance table. IMMUTABLE on a table-reading function is
-- incorrect (should be STABLE). PostgreSQL query planner can cache/wrong-fold
-- results at plan time, causing index to return stale values.
--
-- Fix: Denormalize dealer_id directly onto dealer_assignments via a real FK column.
-- This is the correct pattern: a plain column with a plain unique index.
-- No function needed, no planner-caching risk.
-- =============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- Step 1: Drop the incorrect functional index and IMMUTABLE function
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_unique_active_dealer;
DROP FUNCTION IF EXISTS public.dealer_id_from_attendance(UUID);

-- ════════════════════════════════════════════════════════════════════════════
-- Step 2: Add dealer_id column — denormalized, FK to dealers
-- This is the correct pattern: a real column with a real index.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES dealers(id) ON DELETE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Step 3: Backfill dealer_id from attendance join for all existing rows
-- ════════════════════════════════════════════════════════════════════════════

UPDATE dealer_assignments da
SET dealer_id = datt.dealer_id
FROM dealer_attendance datt
WHERE datt.id = da.attendance_id
  AND da.dealer_id IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- Step 4: Create the clean unique index — no function involved
-- ════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX idx_unique_active_dealer
  ON dealer_assignments (dealer_id)
  WHERE status = 'assigned';

-- ════════════════════════════════════════════════════════════════════════════
-- Step 5: Update assign_dealer_to_table RPC to populate dealer_id on INSERT
-- Also uses dealer_id for the cross-attendance check (cleaner, no extra JOIN)
-- ════════════════════════════════════════════════════════════════════════════

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
  v_dealer_id UUID;
BEGIN
  -- Resolve dealer_id from attendance
  SELECT dealer_id INTO v_dealer_id
  FROM dealer_attendance WHERE id = p_attendance_id;

  IF v_dealer_id IS NULL THEN
    RETURN 'attendance_not_found';
  END IF;

  -- Lock the attendance row; SKIP LOCKED = return 'conflict' immediately if locked
  PERFORM id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN 'conflict';
  END IF;

  -- Cross-attendance check using dealer_id (no extra JOIN needed)
  IF EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE dealer_id = v_dealer_id
      AND status = 'assigned'
  ) THEN
    RETURN 'conflict';
  END IF;

  -- Insert with dealer_id fully populated
  INSERT INTO dealer_assignments (attendance_id, table_id, dealer_id, status, assigned_at, swing_due_at)
  VALUES (p_attendance_id, p_table_id, v_dealer_id, 'assigned', p_assigned_at, p_swing_due_at);

  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Step 6: Update perform_swing RPC to maintain dealer_id on new assignments
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION perform_swing(
  p_assignment_id       UUID,
  p_version             INTEGER,
  p_next_attendance_id  UUID DEFAULT NULL,
  p_send_to_break       BOOLEAN DEFAULT FALSE,
  p_break_duration_minutes INTEGER DEFAULT 15,
  p_swing_duration_minutes INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         TIMESTAMPTZ := now();
  v_retry_count INTEGER;
  v_assignment  dealer_assignments%ROWTYPE;
  v_next_dealer_id UUID;
BEGIN
  -- Lock + read current state (version check)
  SELECT * INTO v_assignment
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND version = p_version
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  v_retry_count := COALESCE(v_assignment.swing_retry_count, 0);

  -- No next dealer available path
  IF p_next_attendance_id IS NULL THEN
    IF v_retry_count >= 3 THEN
      RETURN jsonb_build_object(
        'outcome', 'swing_skipped',
        'retry_count', v_retry_count
      );
    END IF;

    UPDATE dealer_assignments
    SET
      swing_retry_count      = v_retry_count + 1,
      last_swing_attempted_at = v_now,
      swing_due_at           = v_now + INTERVAL '90 seconds',
      version                = version + 1
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'outcome', 'no_dealer',
      'retry_count', v_retry_count + 1
    );
  END IF;

  -- Resolve next dealer_id
  SELECT dealer_id INTO v_next_dealer_id
  FROM dealer_attendance WHERE id = p_next_attendance_id;

  IF v_next_dealer_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'failed', 'error', 'next_attendance_not_found');
  END IF;

  -- Complete current assignment
  UPDATE dealer_assignments
  SET
    status              = 'completed',
    swing_processed_at  = v_now,
    version             = version + 1
  WHERE id = p_assignment_id;

  -- If send_to_break, insert break record
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (attendance_id, assignment_id, break_start, expected_duration_minutes, reason)
    VALUES (v_assignment.attendance_id, p_assignment_id, v_now, p_break_duration_minutes, 'swing_completed');
  ELSE
    -- Set back to available if not going on break
    UPDATE dealer_attendance
    SET current_state = 'available'
    WHERE id = v_assignment.attendance_id;
  END IF;

  -- Create new assignment for incoming dealer (with dealer_id populated)
  INSERT INTO dealer_assignments (
    attendance_id, table_id, dealer_id, status, assigned_at, swing_due_at, version
  ) VALUES (
    p_next_attendance_id,
    v_assignment.table_id,
    v_next_dealer_id,
    'assigned',
    v_now,
    v_now + (p_swing_duration_minutes * INTERVAL '1 minute'),
    1
  );

  -- Update next dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_next_attendance_id;

  -- Return outcome with incoming name
  RETURN jsonb_build_object(
    'outcome', 'swung',
    'incoming_name', (SELECT full_name FROM dealers WHERE id = v_next_dealer_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION perform_swing(UUID, INTEGER, UUID, BOOLEAN, INTEGER, INTEGER)
  TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Step 7: Backup the old migration for audit trail
-- ════════════════════════════════════════════════════════════════════════════

-- Old migration 20260614000000_fix_dealer_duplicate_assignments.sql is now
-- fully superseded. The IMMUTABLE function and index from that migration
-- have been dropped above. The dealer_id column approach replaces both.

-- ════════════════════════════════════════════════════════════════════════════
-- Step 8: Verify everything
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_assignments' AND column_name = 'dealer_id'
  ), 'dealer_id column missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'dealer_assignments' AND indexname = 'idx_unique_active_dealer'
  ), 'idx_unique_active_dealer index missing';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'dealer_id_from_attendance'
  ), 'Old IMMUTABLE function still exists — should have been dropped';

  RAISE NOTICE '✓ Migration 20260615000000 passed — dealer_id column + index correct';
END;
$$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed):
--   ALTER TABLE dealer_assignments DROP COLUMN IF EXISTS dealer_id;
--   DROP INDEX IF EXISTS idx_unique_active_dealer;
--   Then re-apply old 20260614000000 migration to restore function + index.
-- ════════════════════════════════════════════════════════════════════════════
