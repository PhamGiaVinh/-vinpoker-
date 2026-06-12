-- Live snapshot before idle-dealer fix. OID 284577.
CREATE OR REPLACE FUNCTION public.lock_rotation_slot(p_schedule_id uuid, p_schedule_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row              public.dealer_rotation_schedule%ROWTYPE;
  v_assignment_version INT;
BEGIN
  SELECT * INTO v_row
  FROM dealer_rotation_schedule
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost','detail','Schedule row not found');
  END IF;

  IF v_row.status != 'predicted' THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail', format('Schedule row is %s, not predicted', v_row.status));
  END IF;

  IF v_row.version != p_schedule_version THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail', format('Schedule version mismatch: expected %s, got %s',
                       p_schedule_version, v_row.version));
  END IF;

  IF v_row.slot_index != 0 OR v_row.in_attendance_id IS NULL OR v_row.assignment_id IS NULL THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail','Only slot 0 with a concrete dealer and assignment can be locked');
  END IF;

  -- Lock the assignment being relieved.
  SELECT version INTO v_assignment_version
  FROM dealer_assignments
  WHERE id = v_row.assignment_id
    AND status = 'assigned'
    AND released_at IS NULL
    AND swing_processed_at IS NULL
    AND pre_assigned_attendance_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail','Assignment no longer active or already pre-assigned');
  END IF;

  -- Lock the incoming dealer.
  PERFORM id
  FROM dealer_attendance
  WHERE id = v_row.in_attendance_id
    AND current_state = 'available'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','dealer_unavailable',
      'detail','Dealer not in available state');
  END IF;

  -- CHá»T: same pre-assign representation, planned_relief_at instead of a due push.
  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = v_row.in_attendance_id,
    pre_assigned_at            = NOW(),
    planned_relief_at          = v_row.planned_relief_at,
    version                    = version + 1,
    updated_at                 = NOW()
  WHERE id = v_row.assignment_id
    AND version = v_assignment_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost','detail','CAS update failed on assignment');
  END IF;

  UPDATE dealer_attendance
  SET
    current_state         = 'pre_assigned',
    pre_assigned_table_id = v_row.table_id,
    pre_assigned_at       = NOW(),
    updated_at            = NOW()
  WHERE id = v_row.in_attendance_id
    AND current_state = 'available';

  IF NOT FOUND THEN
    -- Roll the assignment back; dealer state changed between lock and update.
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      planned_relief_at          = NULL,
      version                    = v_assignment_version,
      updated_at                 = NOW()
    WHERE id = v_row.assignment_id;

    RETURN jsonb_build_object('outcome','dealer_unavailable',
      'detail','Dealer state changed between lock and update');
  END IF;

  UPDATE dealer_rotation_schedule
  SET status = 'announced', version = version + 1, updated_at = NOW()
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object(
    'outcome','locked',
    'schedule_id', p_schedule_id,
    'assignment_id', v_row.assignment_id,
    'in_attendance_id', v_row.in_attendance_id,
    'planned_relief_at', v_row.planned_relief_at
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$function$

