-- Restore delayed handoff pre-assign semantics.
--
-- Pass 2 may reserve a dealer before they are fully ready, but the actual
-- table handoff must wait until both clocks are satisfied:
--   1. the table's nominal swing time, and
--   2. the incoming dealer's rest completion time.
--
-- The notification layer still speaks in terms of the nominal swing time.

BEGIN;

DROP FUNCTION IF EXISTS public.pre_assign_next_dealer_for_table(
  p_assignment_id UUID, p_club_id UUID, p_next_attendance_id UUID, p_version INT
);

CREATE OR REPLACE FUNCTION public.pre_assign_next_dealer_for_table(
  p_assignment_id      UUID,
  p_club_id            UUID,
  p_next_attendance_id UUID,
  p_version            INT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_version INT;
  v_table_id UUID;
  v_original_due_at TIMESTAMPTZ;
  v_current_rest_min INT := 999;
  v_needed_delay_min INT := 0;
  v_effective_due_at TIMESTAMPTZ;
  v_min_rest_min INT := 10;
BEGIN
  SELECT version, table_id, swing_due_at
  INTO v_assignment_version, v_table_id, v_original_due_at
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND status = 'assigned'
    AND released_at IS NULL
    AND swing_processed_at IS NULL
    AND pre_assigned_attendance_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', 'Assignment no longer active or already pre-assigned'
    );
  END IF;

  IF v_assignment_version != p_version THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', format('Version mismatch: expected %s, got %s', p_version, v_assignment_version)
    );
  END IF;

  PERFORM id
  FROM dealer_attendance
  WHERE id = p_next_attendance_id
    AND current_state = 'available'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', 'Dealer not in available state'
    );
  END IF;

  SELECT COALESCE(
    EXTRACT(EPOCH FROM (NOW() - lr.last_released_at))::INT / 60,
    999
  )
  INTO v_current_rest_min
  FROM (
    SELECT MAX(released_at) AS last_released_at
    FROM dealer_assignments
    WHERE attendance_id = p_next_attendance_id
      AND released_at IS NOT NULL
  ) lr;

  SELECT COALESCE(min_inter_swing_rest_minutes, 10)
  INTO v_min_rest_min
  FROM swing_config
  WHERE club_id = p_club_id
    AND table_type = 'tournament'
  LIMIT 1;

  v_needed_delay_min := GREATEST(0, v_min_rest_min - v_current_rest_min);
  v_effective_due_at := GREATEST(
    v_original_due_at,
    NOW() + (v_needed_delay_min || ' minutes')::interval
  );

  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = p_next_attendance_id,
    pre_assigned_at = NOW(),
    swing_due_at = v_effective_due_at,
    version = version + 1,
    updated_at = NOW()
  WHERE id = p_assignment_id
    AND version = p_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', 'CAS update failed on assignment'
    );
  END IF;

  UPDATE dealer_attendance
  SET
    current_state = 'pre_assigned',
    pre_assigned_table_id = v_table_id,
    pre_assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_next_attendance_id
    AND current_state = 'available';

  IF NOT FOUND THEN
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at = NULL,
      swing_due_at = v_original_due_at,
      version = p_version,
      updated_at = NOW()
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', 'Dealer state changed between lock and update'
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'pre_assigned',
    'original_swing_due_at', v_original_due_at,
    'effective_swing_due_at', v_effective_due_at,
    'rest_deficit_min', v_needed_delay_min,
    'current_rest_min', v_current_rest_min
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'detail', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pre_assign_next_dealer_for_table(UUID, UUID, UUID, INT) TO service_role;

COMMIT;
