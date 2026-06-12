-- ============================================================================
-- IDLE-DEALER FIX 2/2 — R1 rest guard inside lock_rotation_slot
--
-- Defense in depth for the R1 hard rule (>= 10 min rest between sessions).
-- The 20260814000000 migration fixed the bookkeeping that starved the
-- planner's supply of fresh release timestamps; this guard makes the lock
-- RPC itself reject any future attempt to CHOT a dealer who left a table
-- less than min_inter_swing_rest_minutes ago, regardless of what the
-- planner's snapshot believed. A new 'rest_guard' outcome is returned;
-- Pass R phase E already treats every non-'locked' outcome as
-- "skip + re-plan next tick" (passR-rotation-planner.ts:417-421), so no
-- edge-function change is required.
--
-- Pre-apply snapshot: docs/emergency_rollbacks/
--   IDLE_FIX_snapshot_lock_rotation_slot_oid284577.sql  (rollback = re-run it)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lock_rotation_slot(p_schedule_id uuid, p_schedule_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row                public.dealer_rotation_schedule%ROWTYPE;
  v_assignment_version INT;
  v_last_release       TIMESTAMPTZ;
  v_rest_minutes       INT;
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

  -- R1 REST GUARD (idle-dealer fix, defense in depth) ------------------------
  -- The most recent release event for this dealer, from either marker:
  -- released_at on their assignments (rotation-supply rest anchor) or
  -- last_released_at on attendance (legacy cooldown marker).
  SELECT GREATEST(
    COALESCE((SELECT MAX(a.released_at)
              FROM dealer_assignments a
              WHERE a.attendance_id = v_row.in_attendance_id), '-infinity'::timestamptz),
    COALESCE((SELECT att.last_released_at
              FROM dealer_attendance att
              WHERE att.id = v_row.in_attendance_id), '-infinity'::timestamptz)
  ) INTO v_last_release;

  SELECT COALESCE(sc.min_inter_swing_rest_minutes, 10)
  INTO   v_rest_minutes
  FROM   swing_config sc
  WHERE  sc.club_id = v_row.club_id
    AND  sc.table_type = 'tournament'
  LIMIT  1;
  v_rest_minutes := COALESCE(v_rest_minutes, 10);

  IF v_last_release > NOW() - (v_rest_minutes || ' minutes')::interval THEN
    RETURN jsonb_build_object('outcome','rest_guard',
      'detail', format('Dealer released at %s; %s min rest not yet complete',
                       v_last_release, v_rest_minutes),
      'released_at', v_last_release,
      'rest_minutes', v_rest_minutes);
  END IF;
  -- ---------------------------------------------------------------------------

  -- CHOT: same pre-assign representation, planned_relief_at instead of a due push.
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
$function$;
