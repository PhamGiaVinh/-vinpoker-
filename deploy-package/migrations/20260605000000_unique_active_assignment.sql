-- =============================================================================
-- Migration: Prevent duplicate active dealer assignments
-- Layer 1: Partial unique index — DB-level safety net
-- Layer 2: Atomic assign RPC — insert + state update in one transaction
-- =============================================================================

-- Layer 1: Partial unique index covering active ('assigned') assignments
-- Prevents a dealer from having two active assignments at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_attendance
  ON dealer_assignments(attendance_id) WHERE status = 'assigned';

-- Layer 2: Atomic assign RPC
-- Locks the attendance row (SKIP LOCKED), inserts assignment, updates state.
-- Returns 'ok', 'conflict' (dealer locked / no longer available), or 'not_available'
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

GRANT EXECUTE ON FUNCTION assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
