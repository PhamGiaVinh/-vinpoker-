-- SOURCE ONLY. Predictive reservations bind to the exact operational session.
-- Preserve rest/payroll policy. Never infer a legacy NULL session from a physical table.
-- Rollback: disable predictive reservation worker, restore prior Edge artifact and captured RPC ACLs;
-- retain all reservation/assignment history. Apply only after migrations 17 and 22.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_empty_table_for_dealer_v2(
  p_table_id uuid,p_table_session_id uuid,p_attendance_id uuid,p_predicted_arrival timestamptz,p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_dealer uuid; v_state text; v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  PERFORM floor_private.assert_dealer_acquisition_intent(p_club_id);
  PERFORM 1 FROM public.game_tables g WHERE g.id=p_table_id AND g.club_id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'outcome','table_club_mismatch'); END IF;
  PERFORM 1 FROM public.table_sessions s WHERE s.id=p_table_session_id AND s.game_table_id=p_table_id
    AND s.club_id=p_club_id AND s.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'outcome','table_session_changed'); END IF;
  IF NOT EXISTS(SELECT 1 FROM floor_private.club_operational_inventory(p_club_id) i
    WHERE i.game_table_id=p_table_id AND i.table_session_id=p_table_session_id AND i.availability_status='in_use') THEN
    RETURN jsonb_build_object('ok',false,'outcome','table_repair_required'); END IF;
  SELECT a.dealer_id,a.current_state INTO v_dealer,v_state FROM public.dealer_attendance a
    JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id=p_attendance_id AND d.club_id=p_club_id
    AND d.status='active' AND d.deleted_at IS NULL AND a.status='checked_in' AND a.check_out_time IS NULL FOR UPDATE OF a;
  IF v_dealer IS NULL THEN RETURN jsonb_build_object('ok',false,'outcome','dealer_not_found'); END IF;
  SELECT id INTO v_id FROM public.dealer_assignments WHERE table_id=p_table_id AND table_session_id=p_table_session_id
    AND club_id=p_club_id AND attendance_id=p_attendance_id AND status='reserved' AND released_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'outcome','already_reserved','reservation_id',v_id); END IF;
  IF v_state IS DISTINCT FROM 'on_break' THEN RETURN jsonb_build_object('ok',false,'outcome','dealer_not_on_break'); END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=p_table_id AND released_at IS NULL
    AND status IN ('assigned','on_break','reserved','pre_assigned')) THEN
    RETURN jsonb_build_object('ok',false,'outcome','table_occupied'); END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id=p_attendance_id AND released_at IS NULL
    AND status IN ('assigned','reserved','pre_assigned')) THEN
    RETURN jsonb_build_object('ok',false,'outcome','dealer_busy'); END IF;
  INSERT INTO public.dealer_assignments(table_id,table_session_id,attendance_id,dealer_id,club_id,status,
    assigned_at,swing_due_at,pre_assigned_at,pre_announce_due_at)
    VALUES(p_table_id,p_table_session_id,p_attendance_id,v_dealer,p_club_id,'reserved',now(),
      COALESCE(p_predicted_arrival,now()+interval '5 minutes'),now(),now()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'outcome','ok','reservation_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'outcome','race_lost');
END;
$$;
CREATE OR REPLACE FUNCTION public.execute_empty_table_reservation_v2(
  p_reservation_id uuid,p_table_session_id uuid,p_swing_due_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.dealer_assignments%ROWTYPE; v_state text; v_release timestamptz; v_tx jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.dealer_assignments WHERE id=p_reservation_id AND status='reserved' AND released_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'outcome','reservation_not_found'); END IF;
  IF r.table_session_id IS NULL OR r.table_session_id IS DISTINCT FROM p_table_session_id THEN
    RETURN jsonb_build_object('ok',false,'outcome','table_session_changed'); END IF;
  PERFORM floor_private.assert_dealer_acquisition_intent(r.club_id);
  PERFORM 1 FROM public.game_tables g WHERE g.id=r.table_id AND g.club_id=r.club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'outcome','table_club_mismatch'); END IF;
  PERFORM 1 FROM public.table_sessions s WHERE s.id=p_table_session_id AND s.game_table_id=r.table_id
    AND s.club_id=r.club_id AND s.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'outcome','table_session_changed'); END IF;
  SELECT a.current_state,a.last_released_at INTO v_state,v_release FROM public.dealer_attendance a
    JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id=r.attendance_id AND a.dealer_id=r.dealer_id
    AND d.club_id=r.club_id AND d.status='active' AND d.deleted_at IS NULL
    AND a.status='checked_in' AND a.check_out_time IS NULL FOR UPDATE OF a;
  IF NOT FOUND OR v_state IS DISTINCT FROM 'available' THEN
    RETURN jsonb_build_object('ok',false,'outcome','dealer_not_ready'); END IF;
  -- Match existing execute-time rest floor; do not trust the browser/Edge clock.
  IF v_release IS NOT NULL AND v_release>now()-interval '15 minutes' THEN
    RETURN jsonb_build_object('ok',false,'outcome','dealer_rest_required'); END IF;
  SELECT * INTO r FROM public.dealer_assignments a WHERE a.id=p_reservation_id
    AND a.status='reserved' AND a.released_at IS NULL AND a.table_session_id=p_table_session_id
    AND a.club_id=r.club_id AND a.table_id=r.table_id AND a.attendance_id=r.attendance_id
    AND a.dealer_id=r.dealer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'outcome','reservation_identity_changed'); END IF;
  IF NOT EXISTS(SELECT 1 FROM floor_private.club_operational_inventory(r.club_id) i
    WHERE i.game_table_id=r.table_id AND i.table_session_id=p_table_session_id AND i.availability_status='in_use') THEN
    RETURN jsonb_build_object('ok',false,'outcome','table_repair_required'); END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id<>p_reservation_id AND a.released_at IS NULL
    AND ((a.table_id=r.table_id AND a.status IN ('assigned','on_break','reserved','pre_assigned'))
      OR (a.attendance_id=r.attendance_id AND a.status IN ('assigned','reserved','pre_assigned')))) THEN
    RETURN jsonb_build_object('ok',false,'outcome','conflict_active_assignment'); END IF;
  UPDATE public.dealer_assignments SET status='assigned',assigned_at=now(),
    swing_due_at=COALESCE(p_swing_due_at,now()+interval '45 minutes'),pre_assigned_at=NULL,pre_announce_due_at=NULL
    WHERE id=p_reservation_id;
  v_tx:=public.transition_dealer_state(r.attendance_id,'assigned','execute_empty_table_reservation_v2');
  IF (v_tx->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'DEALER_RESERVATION_TRANSITION_FAILED'; END IF;
  RETURN jsonb_build_object('ok',true,'outcome','ok','assignment_id',p_reservation_id,'table_session_id',p_table_session_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'outcome','conflict_active_assignment');
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_empty_table_for_dealer_v2(uuid,uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.execute_empty_table_reservation_v2(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_empty_table_for_dealer_v2(uuid,uuid,uuid,timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_empty_table_reservation_v2(uuid,uuid,timestamptz) TO service_role;
-- Old signatures cannot fence a previewed incarnation. Retire acquisition access, not history.
REVOKE ALL ON FUNCTION public.reserve_empty_table_for_dealer(uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.execute_empty_table_reservation(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
