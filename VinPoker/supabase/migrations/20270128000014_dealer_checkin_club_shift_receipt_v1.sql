-- Server-authoritative attendance intent. History and payroll policy stay unchanged.
-- Rollback: revoke the new RPC; retain attendance and receipts for audit.
BEGIN;
-- Existing overlap trigger must also work under the new RPC's empty search path.
CREATE OR REPLACE FUNCTION public.check_attendance_no_overlap()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE conflict_id uuid; conflict_in timestamptz; conflict_out timestamptz;
BEGIN
  IF NEW.status NOT IN ('checked_in','checked_out') THEN RETURN NEW; END IF;
  SELECT id,check_in_time,check_out_time INTO conflict_id,conflict_in,conflict_out
  FROM public.dealer_attendance WHERE dealer_id=NEW.dealer_id AND id<>NEW.id
    AND status IN ('checked_in','checked_out')
    AND pg_catalog.tstzrange(check_in_time,COALESCE(check_out_time,'infinity'::timestamptz))
      && pg_catalog.tstzrange(NEW.check_in_time,COALESCE(NEW.check_out_time,'infinity'::timestamptz)) LIMIT 1;
  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance overlap: dealer % has conflicting attendance % (%) overlapping with new record (%)',
      NEW.dealer_id,conflict_id,conflict_in||' - '||COALESCE(conflict_out::text,'open'),
      NEW.check_in_time||' - '||COALESCE(NEW.check_out_time::text,'open') USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.func_log_late_checkin()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE late_min integer; shift_start time; club uuid;
BEGIN
  IF NEW.status='checked_in' AND OLD.status IS DISTINCT FROM 'checked_in' THEN
    SELECT ds.start_time,d.club_id INTO shift_start,club FROM public.dealer_shifts ds
      JOIN public.dealers d ON d.id=NEW.dealer_id WHERE ds.id=NEW.shift_id;
    IF shift_start IS NOT NULL THEN
      late_min:=GREATEST(0,EXTRACT(EPOCH FROM (NEW.check_in_time-
        ((NEW.shift_date+shift_start) AT TIME ZONE 'Asia/Ho_Chi_Minh')))/60)::integer;
      IF late_min>15 THEN
        INSERT INTO public.swing_audit_logs(club_id,action,old_dealer_id,details,triggered_by)
          VALUES(club,'late_checkin',NEW.dealer_id,jsonb_build_object('late_minutes',late_min,
            'shift_start',shift_start::text,'shift_date',NEW.shift_date::text,'attendance_id',NEW.id),'system');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.log_dealer_state_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.current_state IS DISTINCT FROM NEW.current_state THEN
    INSERT INTO public.dealer_state_transitions(attendance_id,from_state,to_state,reason)
      VALUES(NEW.id,OLD.current_state,NEW.current_state,COALESCE(pg_catalog.current_setting('app.state_reason',true),'direct_update'));
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION public.operator_check_in_dealer_v1(
  p_dealer_id uuid,p_club_id uuid,p_shift_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); d public.dealers%ROWTYPE; s public.dealer_shifts%ROWTYPE;
  att public.dealer_attendance%ROWTYPE; prior record; fingerprint text; result jsonb;
  local_now timestamp:=pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh'; operating_date date; active_count integer;
BEGIN
  IF a IS NULL OR p_dealer_id IS NULL OR p_club_id IS NULL OR p_shift_id IS NULL OR p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  IF NOT floor_private.floor_table_v3_actor_is_dealer_operator(a,p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT * INTO d FROM public.dealers WHERE id=p_dealer_id FOR UPDATE;
  IF d.id IS NULL OR d.club_id IS DISTINCT FROM p_club_id OR d.deleted_at IS NOT NULL OR d.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok',false,'error','dealer_not_eligible'); END IF;
  fingerprint:=jsonb_build_object('dealer',p_dealer_id,'club',p_club_id,'shift',p_shift_id)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(a,'operator_check_in_dealer_v1',p_request_id);
  SELECT * INTO prior FROM floor_private.floor_table_v3_existing_receipt(a,'operator_check_in_dealer_v1',p_request_id);
  IF FOUND THEN
    IF prior.request_fingerprint IS DISTINCT FROM fingerprint THEN RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN prior.result;
  END IF;
  SELECT * INTO s FROM public.dealer_shifts WHERE id=p_shift_id FOR SHARE;
  IF s.id IS NULL OR s.club_id IS DISTINCT FROM p_club_id OR s.closed_at IS NOT NULL OR s.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'error','shift_not_eligible'); END IF;
  operating_date:=local_now::date;
  IF s.end_time<=s.start_time AND local_now::time<s.end_time THEN operating_date:=operating_date-1; END IF;
  -- Lock all active rows: legacy duplicates and prior-day shifts are not auto-repaired.
  PERFORM 1 FROM public.dealer_attendance WHERE dealer_id=d.id AND status='checked_in' FOR UPDATE;
  SELECT count(*) INTO active_count FROM public.dealer_attendance WHERE dealer_id=d.id AND status='checked_in';
  IF active_count>1 THEN RETURN jsonb_build_object('ok',false,'error','ambiguous_active_attendance'); END IF;
  IF active_count=1 THEN
    SELECT * INTO att FROM public.dealer_attendance WHERE dealer_id=d.id AND status='checked_in';
    IF att.shift_id IS DISTINCT FROM s.id OR att.shift_date IS DISTINCT FROM operating_date OR att.check_out_time IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'error','previous_shift_open'); END IF;
    result:=jsonb_build_object('ok',true,'outcome','already_checked_in','attendance_id',att.id,'shift_date',att.shift_date);
  ELSE
    IF EXISTS(SELECT 1 FROM public.dealer_assignments WHERE dealer_id=d.id AND status IN ('assigned','pre_assigned','in_transition') AND released_at IS NULL) THEN
      RETURN jsonb_build_object('ok',false,'error','assignment_needs_repair'); END IF;
    INSERT INTO public.dealer_attendance(dealer_id,shift_id,shift_date,status,current_state,check_in_time)
      VALUES(d.id,s.id,operating_date,'checked_in','available',pg_catalog.statement_timestamp()) RETURNING * INTO att;
    result:=jsonb_build_object('ok',true,'outcome','checked_in','attendance_id',att.id,'shift_date',att.shift_date);
  END IF;
  PERFORM floor_private.floor_table_v3_save_receipt(a,'operator_check_in_dealer_v1',p_request_id,fingerprint,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.operator_check_in_dealer_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_check_in_dealer_v1(uuid,uuid,uuid,uuid) TO authenticated;
COMMIT;
