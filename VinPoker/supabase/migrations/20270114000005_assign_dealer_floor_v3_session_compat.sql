BEGIN;

-- Bind canonical Dealer staffing to Floor V3 when an active session exists,
-- while preserving legacy staffing for physical tables without a session.
CREATE OR REPLACE FUNCTION public.assign_dealer_to_table(
  p_attendance_id    UUID,
  p_table_id         UUID,
  p_assigned_at      TIMESTAMPTZ DEFAULT NOW(),
  p_swing_due_at     TIMESTAMPTZ DEFAULT NULL,
  p_club_id          UUID DEFAULT NULL,
  p_idempotency_key  TEXT DEFAULT NULL,
  p_force_replace    BOOLEAN DEFAULT false,
  p_override         BOOLEAN DEFAULT false,
  p_override_reason  TEXT DEFAULT NULL,
  p_actor            UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assignment_id UUID;
  v_existing_attendance_id UUID;
  v_existing_table_id UUID;
  v_existing_club_id UUID;
  v_existing_table_session_id UUID;
  v_orphan_count INT := 0;
  v_now TIMESTAMPTZ := NOW();
  v_resolved_club_id UUID;
  v_dealer_id UUID;
  v_gt_club UUID;
  v_table_session_id UUID;
  v_active_session_count INT;
BEGIN
  -- Follow the Floor V3 lock order: physical table, active session, attendance.
  SELECT table_row.club_id
  INTO v_gt_club
  FROM public.game_tables table_row
  WHERE table_row.id = p_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'table_not_found', 'detail', 'Physical table not found');
  END IF;

  IF p_club_id IS NOT NULL AND p_club_id IS DISTINCT FROM v_gt_club THEN
    RETURN jsonb_build_object('outcome', 'table_club_mismatch', 'detail', 'Table does not belong to supplied club');
  END IF;
  v_resolved_club_id := v_gt_club;

  SELECT count(*)
  INTO v_active_session_count
  FROM public.table_sessions session_row
  WHERE session_row.game_table_id = p_table_id
    AND session_row.club_id = v_resolved_club_id
    AND session_row.closed_at IS NULL;

  IF v_active_session_count > 1 THEN
    RETURN jsonb_build_object('outcome', 'table_session_ambiguous', 'detail', 'Multiple active table sessions found');
  END IF;

  IF v_active_session_count = 1 THEN
    SELECT session_row.id
    INTO v_table_session_id
    FROM public.table_sessions session_row
    WHERE session_row.game_table_id = p_table_id
      AND session_row.club_id = v_resolved_club_id
      AND session_row.closed_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'table_session_changed', 'detail', 'Active table session changed during assignment');
    END IF;
  ELSE
    v_table_session_id := NULL;
  END IF;

  -- Replay is valid only for the same physical table, club, attendance and
  -- current session identity. Historical rows are never rewritten.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT assignment_row.id,
           assignment_row.attendance_id,
           assignment_row.table_id,
           assignment_row.club_id,
           assignment_row.table_session_id
    INTO v_assignment_id,
         v_existing_attendance_id,
         v_existing_table_id,
         v_existing_club_id,
         v_existing_table_session_id
    FROM public.dealer_assignments assignment_row
    WHERE assignment_row.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_assignment_id IS NOT NULL THEN
      IF v_existing_attendance_id IS DISTINCT FROM p_attendance_id
         OR v_existing_table_id IS DISTINCT FROM p_table_id
         OR v_existing_club_id IS DISTINCT FROM v_resolved_club_id
         OR v_existing_table_session_id IS DISTINCT FROM v_table_session_id THEN
        RETURN jsonb_build_object('outcome', 'idempotency_mismatch', 'detail', 'Idempotency key belongs to another assignment context');
      END IF;

      RETURN jsonb_build_object(
        'outcome', 'ok',
        'assignment_id', v_assignment_id,
        'orphan_count', 0,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT attendance_row.dealer_id
  INTO v_dealer_id
  FROM public.dealer_attendance attendance_row
  WHERE attendance_row.id = p_attendance_id
    AND attendance_row.current_state = 'available'
    AND attendance_row.status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'detail', 'Dealer not available or locked');
  END IF;

  IF NOT public._assert_dealer_allowed_for_table(p_table_id, v_dealer_id) THEN
    IF NOT p_override THEN
      RETURN jsonb_build_object('outcome', 'not_eligible', 'detail', 'Dealer not in pool for feature/final table', 'table_id', p_table_id);
    END IF;
    IF p_actor IS NULL OR btrim(coalesce(p_override_reason, '')) = '' THEN
      RETURN jsonb_build_object('outcome', 'override_invalid', 'detail', 'Override requires actor and non-empty reason');
    END IF;
    IF auth.uid() IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor mismatch');
    END IF;
    IF NOT public.is_club_dealer_control(p_actor, v_gt_club) THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor not authorized to override for this table');
    END IF;

    INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (
      v_gt_club,
      p_actor,
      'dealer_feature_override_assign',
      'dealer_table_profile',
      p_table_id,
      jsonb_build_object(
        'table_id', p_table_id,
        'dealer_id', v_dealer_id,
        'attendance_id', p_attendance_id,
        'override', true,
        'reason', p_override_reason,
        'forced_non_pool_dealer', true
      )
    );

    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES (p_table_id, v_dealer_id, p_attendance_id, pg_current_xact_id()::text::bigint);
  END IF;

  IF NOT p_force_replace AND EXISTS (
    SELECT 1
    FROM public.dealer_assignments assignment_row
    WHERE assignment_row.table_id = p_table_id
      AND assignment_row.status IN ('assigned', 'on_break')
      AND assignment_row.released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'table_occupied', 'detail', 'Table already has an active dealer');
  END IF;

  WITH released AS (
    UPDATE public.dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'displaced_by_new_assignment'
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
    RETURNING attendance_id
  )
  UPDATE public.dealer_attendance
  SET current_state = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id IN (SELECT attendance_id FROM released)
    AND current_state IN ('assigned', 'on_break');

  SELECT count(*)
  INTO v_orphan_count
  FROM public.dealer_assignments assignment_row
  WHERE assignment_row.attendance_id = p_attendance_id
    AND assignment_row.status IN ('assigned', 'on_break')
    AND assignment_row.table_id != p_table_id
    AND assignment_row.released_at IS NULL;

  IF v_orphan_count > 0 THEN
    UPDATE public.dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'force_release_before_reassign'
    WHERE attendance_id = p_attendance_id
      AND status IN ('assigned', 'on_break')
      AND table_id != p_table_id
      AND released_at IS NULL;

    RAISE NOTICE '[assign_dealer_to_table] Released % orphan assignment(s) for attendance %',
      v_orphan_count, p_attendance_id;
  END IF;

  UPDATE public.dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  INSERT INTO public.dealer_assignments (
    attendance_id,
    table_id,
    table_session_id,
    club_id,
    status,
    assigned_at,
    swing_due_at,
    idempotency_key
  ) VALUES (
    p_attendance_id,
    p_table_id,
    v_table_session_id,
    v_resolved_club_id,
    'assigned',
    p_assigned_at,
    p_swing_due_at,
    p_idempotency_key
  )
  RETURNING id INTO v_assignment_id;

  UPDATE public.dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'assignment_id', v_assignment_id,
    'orphan_count', v_orphan_count
  );
END;
$function$;

COMMENT ON FUNCTION public.assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) IS
  'v5: preserves v4 canonical Dealer assignment behavior and atomically binds a unique active Floor V3 table_session; zero sessions remains legacy NULL, multiple sessions fail closed, and idempotent replay requires the current session identity.';

COMMIT;
