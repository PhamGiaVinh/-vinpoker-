-- =============================================================================
-- Migration: assign_dealer_to_table — Denormalize club_id
--
-- Context:
--   After Phase 1 added club_id NOT NULL to dealer_assignments, this RPC
--   must resolve club_id from game_tables and include it in the INSERT.
--
-- Signature stays the same (4-param). club_id is resolved internally via
-- a SELECT from game_tables, so callers do NOT need to pass it.
--
-- Companion code: see 20260719000000_dealer_assignments_denormalize_club_id.sql
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_dealer_to_table(
  p_table_id       UUID,
  p_attendance_id  UUID,
  p_swing_due_at   TIMESTAMPTZ,
  p_assigned_at    TIMESTAMPTZ DEFAULT now()
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted_id UUID;
  v_club_id     UUID;
BEGIN
  -- Lock attendance
  PERFORM id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN 'conflict';
  END IF;

  -- Lock table
  PERFORM id FROM dealer_assignments
  WHERE table_id = p_table_id
    AND status = 'assigned'
    AND released_at IS NULL
  FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    RETURN 'table_occupied';
  END IF;

  -- Resolve club_id from game_tables (required after Phase 1)
  SELECT gt.club_id INTO v_club_id
  FROM game_tables gt
  WHERE gt.id = p_table_id;

  IF v_club_id IS NULL THEN
    RETURN 'table_not_found';
  END IF;

  UPDATE dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, swing_due_at
  ) VALUES (
    p_attendance_id, p_table_id, v_club_id, 'assigned', p_assigned_at, p_swing_due_at
  );

  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION public.assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Assigns an available dealer to a table. Resolves club_id from game_tables (Phase 1: required for NOT NULL constraint).';

COMMIT;
