-- SOURCE ONLY. Shared operational inventory and exact-session initial assignment.
-- No attendance/history repair, rest/payroll policy or flag changes.
-- Rollback: restore captured get_club_table_inventory definition and Edge artifact;
-- retain assignment receipts. Never rewrite assignment history.
BEGIN;
CREATE OR REPLACE FUNCTION floor_private.club_operational_inventory(p_club_id uuid)
RETURNS TABLE(game_table_id uuid,table_number integer,table_name text,operational_status text,
  availability_status text,table_session_id uuid,session_type text,control_mode text,
  control_epoch bigint,revision bigint,tournament_id uuid,tournament_table_id uuid,
  tournament_table_status text,active_dealer_assignment_id uuid)
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT g.id,g.table_number,g.table_name,g.operational_status,
    CASE
      WHEN g.operational_status IS NULL THEN 'preflight_required'
      WHEN g.operational_status<>'available' THEN g.operational_status
      WHEN sessions.n=0 AND assignments.n>0 THEN 'repair_required'
      WHEN sessions.n=0 THEN 'available'
      WHEN sessions.n<>1 OR s.club_id IS DISTINCT FROM g.club_id THEN 'repair_required'
      WHEN s.session_type='tournament' AND (links.n<>1 OR tt.game_table_id IS DISTINCT FROM g.id
        OR tt.table_id IS DISTINCT FROM g.id OR tt.tournament_id IS DISTINCT FROM s.tournament_id
        OR t.club_id IS DISTINCT FROM g.club_id OR t.deleted_at IS NOT NULL
        OR t.status IN ('completed','cancelled')) THEN 'repair_required'
      WHEN assignments.n>1 OR assignments.invalid THEN 'repair_required'
      ELSE 'in_use'
    END,s.id,s.session_type,s.control_mode,s.control_epoch,s.revision,s.tournament_id,
    tt.id,tt.status,assignment.id
  FROM public.game_tables g
  LEFT JOIN LATERAL (SELECT count(*) n FROM public.table_sessions x
    WHERE x.game_table_id=g.id AND x.closed_at IS NULL) sessions ON true
  LEFT JOIN LATERAL (SELECT x.* FROM public.table_sessions x
    WHERE x.game_table_id=g.id AND x.closed_at IS NULL ORDER BY x.opened_at DESC,x.id LIMIT 1) s ON true
  LEFT JOIN LATERAL (SELECT count(*) n FROM public.tournament_tables x
    WHERE x.table_session_id=s.id AND x.status='active') links ON true
  LEFT JOIN LATERAL (SELECT x.* FROM public.tournament_tables x
    WHERE x.table_session_id=s.id AND x.status='active' ORDER BY x.created_at DESC,x.id LIMIT 1) tt ON true
  LEFT JOIN public.tournaments t ON t.id=s.tournament_id
  LEFT JOIN LATERAL (
    SELECT count(*) n,COALESCE(bool_or(a.table_session_id IS DISTINCT FROM s.id OR a.club_id IS DISTINCT FROM g.club_id
      OR a.dealer_id IS DISTINCT FROM dat.dealer_id
      OR d.club_id IS DISTINCT FROM g.club_id OR d.status IS DISTINCT FROM 'active' OR d.deleted_at IS NOT NULL
      OR dat.status IS DISTINCT FROM 'checked_in' OR dat.check_out_time IS NOT NULL
      OR (a.status IN ('assigned','on_break') AND dat.current_state NOT IN ('assigned','on_break'))),false) invalid
    FROM public.dealer_assignments a LEFT JOIN public.dealer_attendance dat ON dat.id=a.attendance_id
    LEFT JOIN public.dealers d ON d.id=dat.dealer_id
    WHERE a.table_id=g.id AND a.released_at IS NULL AND a.status IN ('assigned','on_break','pre_assigned','reserved')
  ) assignments ON true
  LEFT JOIN LATERAL (SELECT a.id FROM public.dealer_assignments a
    WHERE a.table_id=g.id AND a.table_session_id=s.id AND a.released_at IS NULL
      AND a.status IN ('assigned','on_break','pre_assigned','reserved') ORDER BY a.assigned_at DESC,a.id LIMIT 1) assignment ON true
  WHERE g.club_id=p_club_id ORDER BY g.table_number NULLS LAST,g.table_name,g.id;
$$;
REVOKE ALL ON FUNCTION floor_private.club_operational_inventory(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_club_table_inventory(p_club_id uuid)
RETURNS TABLE(game_table_id uuid,table_number integer,table_name text,operational_status text,
  availability_status text,table_session_id uuid,session_type text,control_mode text,
  control_epoch bigint,revision bigint,tournament_id uuid,tournament_table_id uuid,
  tournament_table_status text,active_dealer_assignment_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT (floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),p_club_id)
    OR floor_private.floor_table_v3_actor_is_dealer_operator(auth.uid(),p_club_id)) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM floor_private.club_operational_inventory(p_club_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_club_table_inventory(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_club_table_inventory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_dealer_operational_tables_v1(p_club_id uuid)
RETURNS TABLE(id uuid,table_session_id uuid,tournament_id uuid,table_name text,table_type text,
  shift_id uuid,current_blind_level integer,opened_at timestamptz,dealer_open_operation_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  RETURN QUERY SELECT i.game_table_id,i.table_session_id,i.tournament_id,i.table_name,i.session_type,
    g.shift_id,g.current_blind_level,s.opened_at,g.dealer_open_operation_id
    FROM floor_private.club_operational_inventory(p_club_id) i
    JOIN public.game_tables g ON g.id=i.game_table_id
    JOIN public.table_sessions s ON s.id=i.table_session_id
    WHERE i.availability_status='in_use';
END;
$$;
REVOKE ALL ON FUNCTION public.get_dealer_operational_tables_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dealer_operational_tables_v1(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS floor_private.dealer_initial_assign_receipts(
  request_key text PRIMARY KEY,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE floor_private.dealer_initial_assign_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.dealer_initial_assign_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.worker_assign_dealer_to_session_v1(p_club_id uuid,p_table_id uuid,
  p_table_session_id uuid,p_attendance_id uuid,p_swing_due_at timestamptz,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
    -- Older assignment rows never captured the exact due-time payload.
    RETURN jsonb_build_object('outcome','legacy_receipt_review_required'); END IF;
  -- Preserve Floor lock order. Validate after locks; a closed/reopened table is not the previewed session.
  PERFORM 1 FROM public.game_tables g WHERE g.id=p_table_id AND g.club_id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','table_club_mismatch'); END IF;
  PERFORM 1 FROM public.table_sessions s WHERE s.id=p_table_session_id AND s.game_table_id=p_table_id
    AND s.club_id=p_club_id AND s.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','table_session_changed'); END IF;
  -- Recheck reservations under the same physical/session locks as assignment writers.
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
  -- Never heal/release another active assignment merely because attendance says available.
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
$$;
REVOKE ALL ON FUNCTION public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text) TO service_role;
COMMIT;
