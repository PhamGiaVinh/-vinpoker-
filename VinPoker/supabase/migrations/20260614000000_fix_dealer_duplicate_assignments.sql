-- =============================================================================
-- Migration: Fix duplicate dealer assignments across different attendance records
-- 
-- Problem: A dealer can have multiple attendance records (different check-ins).
-- The unique index idx_unique_active_attendance only prevents duplicate
-- assignments on the SAME attendance_id, not across different ones.
-- 
-- Fix: Add a DB-level function + partial unique index that prevents a dealer
-- from having more than one active ('assigned') assignment regardless of
-- which attendance record they use.
-- =============================================================================

-- Function to resolve dealer_id from attendance_id (IMMUTABLE — the FK
-- relationship is set once on INSERT and never changes, so this is stable
-- enough for an index expression).
CREATE OR REPLACE FUNCTION public.dealer_id_from_attendance(p_attendance_id UUID)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT dealer_id FROM public.dealer_attendance WHERE id = p_attendance_id;
$$;

-- Partial unique index: a dealer can have at most 1 active assignment
-- Uses the function above to resolve dealer_id from attendance_id
DROP INDEX IF EXISTS idx_unique_active_dealer;
CREATE UNIQUE INDEX idx_unique_active_dealer
  ON public.dealer_assignments (public.dealer_id_from_attendance(attendance_id))
  WHERE status = 'assigned';

-- Fix the assign_dealer_to_table RPC to also check for cross-attendance duplicates
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
  -- Get dealer_id for this attendance
  SELECT dealer_id INTO v_dealer_id FROM dealer_attendance WHERE id = p_attendance_id;

  -- Lock the attendance row; SKIP LOCKED = return 'conflict' immediately if locked
  PERFORM id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN 'conflict';
  END IF;

  -- Check if dealer already has any active assignment (cross-attendance check)
  IF EXISTS (
    SELECT 1 FROM dealer_assignments da
    JOIN dealer_attendance datt ON datt.id = da.attendance_id
    WHERE datt.dealer_id = v_dealer_id
      AND da.status = 'assigned'
  ) THEN
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
