-- =============================================================================
-- Migration: Add fill_dealer_id RPC for initial dealer assignment
--
-- Problem: An assignment can exist with status='assigned' but dealer_id=NULL.
-- The attendance_id column IS set (NOT NULL), but the dealer_id link is missing.
-- This happens when the initial assignment process sets attendance_id but the
-- subsequent swing (which sets dealer_id) never completes.
--
-- Fix: Atomic RPC that fills dealer_id from the existing attendance_id link,
-- with CAS (compare-and-swap) on version to prevent concurrent modifications.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fill_dealer_id(
  p_assignment_id UUID,
  p_expected_version INT,
  p_new_attendance_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id UUID;
  v_current_version INT;
  v_dealer_id UUID;
  v_table_id UUID;
  v_old_attendance_id UUID;
BEGIN
  -- ========================================
  -- Step 1: Lock assignment & verify state
  -- ========================================

  SELECT da.attendance_id, da.version, da.table_id
  INTO v_attendance_id, v_current_version, v_table_id
  FROM dealer_assignments da
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.dealer_id IS NULL
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Assignment not found, already has dealer, or not in assigned state'
    );
  END IF;

  -- CAS: version must match (detect concurrent modification)
  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', format('Version mismatch: expected %s, got %s', p_expected_version, v_current_version)
    );
  END IF;

  -- ========================================
  -- Step 2: Determine which attendance to use
  -- ========================================

  v_old_attendance_id := v_attendance_id;

  IF p_new_attendance_id IS NOT NULL THEN
    -- Caller provided a new dealer -> switch attendance
    v_attendance_id := p_new_attendance_id;
  END IF;

  -- ========================================
  -- Step 3: Verify target attendance has a dealer
  -- ========================================

  SELECT da.dealer_id
  INTO v_dealer_id
  FROM dealer_attendance da
  WHERE da.id = v_attendance_id
    AND da.dealer_id IS NOT NULL
  FOR UPDATE OF da NOWAIT;

  IF NOT FOUND OR v_dealer_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', format('Attendance %s has no valid dealer', v_attendance_id)
    );
  END IF;

  -- ========================================
  -- Step 4: If switching attendance, release old one
  -- ========================================

  IF p_new_attendance_id IS NOT NULL AND v_old_attendance_id != v_attendance_id THEN
    UPDATE dealer_attendance
    SET current_state = 'available'
    WHERE id = v_old_attendance_id
      AND current_state != 'checked_out';
  END IF;

  -- ========================================
  -- Step 5: Fill dealer_id on assignment
  -- ========================================

  UPDATE dealer_assignments
  SET dealer_id = v_dealer_id,
      attendance_id = v_attendance_id,
      version = version + 1,
      updated_at = NOW()
  WHERE id = p_assignment_id;

  -- ========================================
  -- Step 6: Update dealer state
  -- ========================================

  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = v_attendance_id
    AND current_state = 'available';

  -- ========================================
  -- Step 7: Return success
  -- ========================================

  RETURN jsonb_build_object(
    'ok', true,
    'dealer_id', v_dealer_id,
    'attendance_id', v_attendance_id,
    'table_id', v_table_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fill_dealer_id(UUID, INT, UUID)
  TO service_role;

-- Verify the function was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fill_dealer_id'
  ) THEN
    RAISE EXCEPTION 'fill_dealer_id function was not created';
  END IF;
END;
$$;
