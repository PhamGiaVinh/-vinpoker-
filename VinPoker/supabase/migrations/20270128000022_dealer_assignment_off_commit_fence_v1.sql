-- Forward-only OFF-at-commit fence, including direct automatic PostgREST writes.
-- Manual intent requires an authenticated actor and server-derived club permission.
-- Release/cancellation remains possible while OFF. Rest/payroll policy is unchanged.
-- ROLLBACK: disable automatic workers first, then remove only the three triggers added here.
-- Keep operational rows, receipts and historical migrations intact.
BEGIN;
CREATE OR REPLACE FUNCTION floor_private.assert_dealer_acquisition_intent(p_club_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_headers jsonb; v_actor uuid; v_enabled boolean;
BEGIN
  IF p_club_id IS NULL THEN RAISE EXCEPTION 'DEALER_ACQUISITION_CLUB_REQUIRED'; END IF;
  IF auth.role()='authenticated' THEN
    v_actor:=auth.uid();
    IF v_actor IS NOT NULL AND public.is_club_dealer_control(v_actor,p_club_id) IS TRUE THEN RETURN; END IF;
    RAISE EXCEPTION 'DEALER_MANUAL_ACQUISITION_FORBIDDEN';
  END IF;
  v_headers:=COALESCE(NULLIF(pg_catalog.current_setting('request.headers',true),''),'{}')::jsonb;
  IF v_headers->>'x-vinpoker-dealer-intent'='manual' THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DEALER_MANUAL_ACQUISITION_FORBIDDEN'; END IF;
    BEGIN v_actor:=(v_headers->>'x-vinpoker-dealer-actor')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'DEALER_MANUAL_ACQUISITION_FORBIDDEN'; END;
    IF v_actor IS NULL OR public.is_club_dealer_control(v_actor,p_club_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'DEALER_MANUAL_ACQUISITION_FORBIDDEN'; END IF;
    RETURN;
  END IF;
  -- Compatible across workers; conflicts with the owner's OFF UPDATE until commit.
  SELECT s.auto_swing_enabled INTO v_enabled FROM public.club_settings s
    WHERE s.club_id=p_club_id FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'AUTO_SWING_OFF'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.assert_dealer_acquisition_intent(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION floor_private.guard_dealer_assignment_acquisition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_acquiring boolean:=false; v_club_id uuid;
BEGIN
  IF NEW.released_at IS NULL THEN
    IF TG_OP='INSERT' THEN
      v_acquiring:=NEW.status IN ('assigned','reserved','pre_assigned','in_transition')
        OR NEW.pre_assigned_attendance_id IS NOT NULL;
    ELSE
      v_acquiring:=(NEW.status IN ('assigned','reserved','pre_assigned','in_transition') AND (
        NEW.status IS DISTINCT FROM OLD.status OR OLD.released_at IS NOT NULL
        OR ROW(NEW.attendance_id,NEW.dealer_id,NEW.table_id,NEW.table_session_id,NEW.club_id)
          IS DISTINCT FROM ROW(OLD.attendance_id,OLD.dealer_id,OLD.table_id,OLD.table_session_id,OLD.club_id)))
        OR (NEW.pre_assigned_attendance_id IS NOT NULL
          AND NEW.pre_assigned_attendance_id IS DISTINCT FROM OLD.pre_assigned_attendance_id)
        OR (NEW.planned_relief_at IS NOT NULL AND NEW.planned_relief_at IS DISTINCT FROM OLD.planned_relief_at);
    END IF;
  END IF;
  IF v_acquiring THEN
    SELECT g.club_id INTO v_club_id FROM public.game_tables g WHERE g.id=NEW.table_id;
    IF v_club_id IS NULL OR NEW.club_id IS DISTINCT FROM v_club_id THEN
      RAISE EXCEPTION 'DEALER_ACQUISITION_CLUB_MISMATCH'; END IF;
    PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.guard_dealer_assignment_acquisition() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION floor_private.guard_dealer_attendance_acquisition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_acquiring boolean:=false; v_club_id uuid;
BEGIN
  IF NEW.current_state IN ('assigned','pre_assigned','in_transition') THEN
    IF TG_OP='INSERT' THEN v_acquiring:=true;
    ELSE v_acquiring:=NEW.current_state IS DISTINCT FROM OLD.current_state
      OR NEW.dealer_id IS DISTINCT FROM OLD.dealer_id
      OR (NEW.pre_assigned_table_id IS NOT NULL AND NEW.pre_assigned_table_id IS DISTINCT FROM OLD.pre_assigned_table_id);
    END IF;
  END IF;
  IF v_acquiring THEN
    SELECT d.club_id INTO v_club_id FROM public.dealers d WHERE d.id=NEW.dealer_id;
    PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.guard_dealer_attendance_acquisition() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION floor_private.guard_dealer_rotation_acquisition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_acquiring boolean:=false; v_club_id uuid;
BEGIN
  IF NEW.status IN ('predicted','announced','executing') THEN
    IF TG_OP='INSERT' THEN v_acquiring:=true;
    ELSE v_acquiring:=NEW.status IS DISTINCT FROM OLD.status
      OR ROW(NEW.club_id,NEW.table_id,NEW.in_attendance_id,NEW.planned_relief_at)
        IS DISTINCT FROM ROW(OLD.club_id,OLD.table_id,OLD.in_attendance_id,OLD.planned_relief_at);
    END IF;
  END IF;
  IF v_acquiring THEN
    SELECT g.club_id INTO v_club_id FROM public.game_tables g WHERE g.id=NEW.table_id;
    IF v_club_id IS NULL OR NEW.club_id IS DISTINCT FROM v_club_id THEN
      RAISE EXCEPTION 'DEALER_ACQUISITION_CLUB_MISMATCH'; END IF;
    PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.guard_dealer_rotation_acquisition() FROM PUBLIC,anon,authenticated,service_role;

-- Canonical acquisition entrypoints take the settings lock before physical/session/attendance locks.
CREATE OR REPLACE FUNCTION public.worker_perform_swing(
  p_table_id uuid,p_table_session_id uuid,p_assignment_id uuid,
  p_duration_minutes integer DEFAULT 30,p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT 15,p_max_break_minutes integer DEFAULT 60,
  p_expected_version integer DEFAULT NULL,p_next_attendance_id uuid DEFAULT NULL,
  p_rest_deficit_minutes integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_club_id uuid; v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  IF p_expected_version IS NULL THEN RAISE EXCEPTION 'SWING_EXPECTED_VERSION_REQUIRED'; END IF;
  SELECT g.club_id INTO v_club_id FROM public.game_tables g WHERE g.id=p_table_id;
  PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);
  v_club_id:=public._dealer_swing_assert_exact_context(p_table_id,p_table_session_id,
    p_assignment_id,p_expected_version,p_next_attendance_id);
  v_result:=public.perform_swing(p_assignment_id:=p_assignment_id,p_duration_minutes:=p_duration_minutes,
    p_send_to_break:=p_send_to_break,p_break_duration_minutes:=p_break_duration_minutes,
    p_max_break_minutes:=p_max_break_minutes,p_expected_version:=p_expected_version,
    p_next_attendance_id:=p_next_attendance_id,p_rest_deficit_minutes:=p_rest_deficit_minutes);
  RETURN public._dealer_swing_bind_result_session(v_result,v_club_id,p_table_id,p_table_session_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.worker_execute_pre_assigned_swing(
  p_table_id uuid,p_table_session_id uuid,p_old_assignment_id uuid,p_expected_version integer,
  p_next_attendance_id uuid,p_swing_due_at timestamptz,p_duration_minutes integer,
  p_send_to_break boolean DEFAULT false,p_break_duration_minutes integer DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_club_id uuid; v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  SELECT g.club_id INTO v_club_id FROM public.game_tables g WHERE g.id=p_table_id;
  PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);
  v_club_id:=public._dealer_swing_assert_exact_context(p_table_id,p_table_session_id,
    p_old_assignment_id,p_expected_version,p_next_attendance_id);
  v_result:=public.execute_pre_assigned_swing(p_old_assignment_id,p_next_attendance_id,
    p_swing_due_at,p_duration_minutes,p_send_to_break,p_break_duration_minutes);
  RETURN public._dealer_swing_bind_result_session(v_result,v_club_id,p_table_id,p_table_session_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.worker_execute_pre_assigned_swing(uuid,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_execute_pre_assigned_swing(uuid,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.worker_assign_dealer_to_session_v1(p_club_id uuid,p_table_id uuid,
  p_table_session_id uuid,p_attendance_id uuid,p_swing_due_at timestamptz,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE payload jsonb; receipt floor_private.dealer_initial_assign_receipts%ROWTYPE; result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  IF p_club_id IS NULL OR p_table_id IS NULL OR p_table_session_id IS NULL OR p_attendance_id IS NULL
    OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key))=0 OR length(p_idempotency_key)>256 THEN
    RETURN jsonb_build_object('outcome','invalid_request'); END IF;
  payload:=jsonb_build_object('club',p_club_id,'table',p_table_id,'session',p_table_session_id,
    'attendance',p_attendance_id,'swing_due_at',p_swing_due_at);
  PERFORM pg_catalog.pg_advisory_xact_lock(280017,pg_catalog.hashtext(p_idempotency_key));
  SELECT * INTO receipt FROM floor_private.dealer_initial_assign_receipts r WHERE r.request_key=p_idempotency_key;
  IF FOUND THEN
    IF receipt.payload<>payload THEN RETURN jsonb_build_object('outcome','idempotency_mismatch'); END IF;
    RETURN receipt.result;
  END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.idempotency_key=p_idempotency_key) THEN
    RETURN jsonb_build_object('outcome','legacy_receipt_review_required'); END IF;
  PERFORM floor_private.assert_dealer_acquisition_intent(p_club_id);
  PERFORM 1 FROM public.game_tables g WHERE g.id=p_table_id AND g.club_id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','table_club_mismatch'); END IF;
  PERFORM 1 FROM public.table_sessions s WHERE s.id=p_table_session_id AND s.game_table_id=p_table_id
    AND s.club_id=p_club_id AND s.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','table_session_changed'); END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.table_id=p_table_id
    AND a.released_at IS NULL AND a.status IN ('assigned','on_break','pre_assigned','reserved')) THEN
    RETURN jsonb_build_object('outcome','table_occupied'); END IF;
  IF NOT EXISTS(SELECT 1 FROM floor_private.club_operational_inventory(p_club_id) i
    WHERE i.game_table_id=p_table_id AND i.table_session_id=p_table_session_id AND i.availability_status='in_use') THEN
    RETURN jsonb_build_object('outcome','table_repair_required'); END IF;
  PERFORM 1 FROM public.dealer_attendance dat JOIN public.dealers d ON d.id=dat.dealer_id
    WHERE dat.id=p_attendance_id AND d.club_id=p_club_id AND d.status='active' AND d.deleted_at IS NULL
      AND dat.status='checked_in' AND dat.check_out_time IS NULL AND dat.current_state='available' FOR UPDATE OF dat;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','attendance_not_available'); END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.attendance_id=p_attendance_id
    AND a.released_at IS NULL AND a.status IN ('assigned','on_break','pre_assigned','reserved')) THEN
    RETURN jsonb_build_object('outcome','attendance_assignment_conflict'); END IF;
  result:=public.assign_dealer_to_table(p_attendance_id:=p_attendance_id,p_table_id:=p_table_id,
    p_swing_due_at:=p_swing_due_at,p_club_id:=p_club_id,p_idempotency_key:=p_idempotency_key);
  IF result->>'outcome'='ok' THEN
    IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=(result->>'assignment_id')::uuid
      AND a.club_id=p_club_id AND a.table_id=p_table_id AND a.table_session_id=p_table_session_id) THEN
      RAISE EXCEPTION 'SWING_ASSIGNMENT_CONTEXT_MISMATCH'; END IF;
    INSERT INTO floor_private.dealer_initial_assign_receipts(request_key,payload,result) VALUES(p_idempotency_key,payload,result);
  END IF;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text) TO service_role;

DROP TRIGGER IF EXISTS guard_dealer_assignment_off_commit_v1 ON public.dealer_assignments;
CREATE TRIGGER guard_dealer_assignment_off_commit_v1 BEFORE INSERT OR UPDATE ON public.dealer_assignments
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_assignment_acquisition();
DROP TRIGGER IF EXISTS guard_dealer_attendance_off_commit_v1 ON public.dealer_attendance;
CREATE TRIGGER guard_dealer_attendance_off_commit_v1 BEFORE INSERT OR UPDATE ON public.dealer_attendance
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_attendance_acquisition();
DROP TRIGGER IF EXISTS guard_dealer_rotation_off_commit_v1 ON public.dealer_rotation_schedule;
CREATE TRIGGER guard_dealer_rotation_off_commit_v1 BEFORE INSERT OR UPDATE ON public.dealer_rotation_schedule
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_rotation_acquisition();
COMMIT;
