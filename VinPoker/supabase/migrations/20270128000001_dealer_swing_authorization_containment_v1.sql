-- VP-AUDIT-001: Dealer Swing authorization containment.
-- Keep canonical mutation cores private and expose exact-context boundaries for
-- authenticated Dealer-control operators and trusted service workers.
-- Rollback: ship a reviewed forward migration restoring grants and dropping the
-- wrappers only after all callers have moved back; never replay older migrations.

BEGIN;

DO $guard$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)',
    'public.perform_swing(uuid,uuid,boolean,integer,text)',
    'public.perform_swing(uuid,integer,uuid,boolean,integer,integer,timestamp with time zone,integer)',
    'public.execute_pre_assigned_swing(uuid,uuid,timestamp with time zone,integer,boolean,integer)',
    'public.execute_pre_assigned_swing_rpc(uuid,uuid,timestamp with time zone,integer,boolean,integer)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'DEALER_SWING_CORE_SIGNATURE_MISSING:%', v_signature;
    END IF;
  END LOOP;
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.dealer_swing_operator_requests (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  request_id uuid NOT NULL,
  assignment_id uuid NOT NULL REFERENCES public.dealer_assignments(id),
  table_id uuid NOT NULL REFERENCES public.game_tables(id),
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id),
  expected_version integer NOT NULL,
  actor_user_id uuid NOT NULL,
  response jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  PRIMARY KEY (club_id, request_id)
);

ALTER TABLE public.dealer_swing_operator_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_swing_operator_requests
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._dealer_swing_bind_result_session(
  p_result jsonb,
  p_club_id uuid,
  p_table_id uuid,
  p_table_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_new_assignment_id uuid;
  v_incoming_valid boolean;
BEGIN
  IF COALESCE(p_result->>'outcome', p_result->>'status') NOT IN ('swung', 'success') THEN
    RETURN p_result;
  END IF;

  BEGIN
    v_new_assignment_id := (p_result->>'new_assignment_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'SWING_RESULT_ASSIGNMENT_MISSING';
  END;

  IF v_new_assignment_id IS NULL THEN
    RAISE EXCEPTION 'SWING_RESULT_ASSIGNMENT_MISSING';
  END IF;

  UPDATE public.dealer_assignments da
  SET table_session_id = p_table_session_id
  WHERE da.id = v_new_assignment_id
    AND da.club_id = p_club_id
    AND da.table_id = p_table_id
    AND da.status = 'assigned'
    AND da.released_at IS NULL
    AND (da.table_session_id IS NULL OR da.table_session_id = p_table_session_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SWING_RESULT_CONTEXT_MISMATCH';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.dealer_assignments da
    JOIN public.dealer_attendance dat ON dat.id = da.attendance_id
    JOIN public.dealers d ON d.id = dat.dealer_id
    WHERE da.id = v_new_assignment_id
      AND da.club_id = p_club_id
      AND da.table_id = p_table_id
      AND da.table_session_id = p_table_session_id
      AND dat.status = 'checked_in'
      AND dat.check_out_time IS NULL
      AND dat.current_state = 'assigned'
      AND d.club_id = p_club_id
      AND d.status = 'active'
      AND d.deleted_at IS NULL
  ) INTO v_incoming_valid;

  IF NOT v_incoming_valid THEN
    RAISE EXCEPTION 'SWING_INCOMING_ATTENDANCE_INVALID';
  END IF;

  RETURN p_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._dealer_swing_assert_exact_context(
  p_table_id uuid,
  p_table_session_id uuid,
  p_assignment_id uuid,
  p_expected_version integer,
  p_next_attendance_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_club_id uuid;
  v_assignment_version integer;
  v_assignment_session uuid;
  v_incoming_club_id uuid;
BEGIN
  IF p_table_session_id IS NULL THEN
    RAISE EXCEPTION 'TABLE_SESSION_BINDING_REQUIRED';
  END IF;

  SELECT gt.club_id
  INTO v_club_id
  FROM public.game_tables gt
  WHERE gt.id = p_table_id
  FOR UPDATE;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'SWING_TABLE_NOT_FOUND';
  END IF;

  SELECT da.version, da.table_session_id
  INTO v_assignment_version, v_assignment_session
  FROM public.dealer_assignments da
  WHERE da.id = p_assignment_id
    AND da.table_id = p_table_id
    AND da.club_id = v_club_id
    AND da.status = 'assigned'
    AND da.released_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SWING_ASSIGNMENT_CONTEXT_MISMATCH';
  END IF;
  IF v_assignment_session IS NULL THEN
    RAISE EXCEPTION 'TABLE_SESSION_BINDING_REQUIRED';
  END IF;
  IF v_assignment_session IS DISTINCT FROM p_table_session_id THEN
    RAISE EXCEPTION 'TABLE_SESSION_STALE';
  END IF;
  IF v_assignment_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'SWING_VERSION_CONFLICT';
  END IF;

  PERFORM 1
  FROM public.table_sessions ts
  WHERE ts.id = p_table_session_id
    AND ts.game_table_id = p_table_id
    AND ts.club_id = v_club_id
    AND ts.closed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_SESSION_STALE';
  END IF;

  IF p_next_attendance_id IS NOT NULL THEN
    SELECT d.club_id
    INTO v_incoming_club_id
    FROM public.dealer_attendance dat
    JOIN public.dealers d ON d.id = dat.dealer_id
    WHERE dat.id = p_next_attendance_id
      AND dat.status = 'checked_in'
      AND dat.check_out_time IS NULL
      AND dat.current_state IN ('available', 'on_break', 'pre_assigned')
      AND d.status = 'active'
      AND d.deleted_at IS NULL;

    IF v_incoming_club_id IS NULL THEN
      RAISE EXCEPTION 'SWING_INCOMING_ATTENDANCE_INVALID';
    END IF;
    IF v_incoming_club_id IS DISTINCT FROM v_club_id THEN
      RAISE EXCEPTION 'SWING_INCOMING_CLUB_MISMATCH';
    END IF;
  END IF;

  RETURN v_club_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operator_perform_swing(
  p_table_id uuid,
  p_table_session_id uuid,
  p_assignment_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_club_id uuid;
  v_pre_assigned_attendance_id uuid;
  v_existing public.dealer_swing_operator_requests%ROWTYPE;
  v_created boolean := false;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SWING_OPERATOR_UNAUTHENTICATED';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'SWING_REQUEST_ID_REQUIRED';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'SWING_EXPECTED_VERSION_REQUIRED';
  END IF;

  SELECT gt.club_id INTO v_club_id
  FROM public.game_tables gt
  WHERE gt.id = p_table_id;

  IF v_club_id IS NULL
     OR NOT public.is_club_dealer_control(auth.uid(), v_club_id) THEN
    RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN';
  END IF;

  INSERT INTO public.dealer_swing_operator_requests (
    club_id, request_id, assignment_id, table_id, table_session_id, expected_version, actor_user_id
  ) VALUES (
    v_club_id, p_request_id, p_assignment_id, p_table_id, p_table_session_id, p_expected_version, auth.uid()
  )
  ON CONFLICT (club_id, request_id) DO NOTHING
  RETURNING true INTO v_created;

  IF NOT COALESCE(v_created, false) THEN
    SELECT * INTO v_existing
    FROM public.dealer_swing_operator_requests r
    WHERE r.club_id = v_club_id AND r.request_id = p_request_id
    FOR UPDATE;

    IF v_existing.assignment_id IS DISTINCT FROM p_assignment_id
       OR v_existing.table_id IS DISTINCT FROM p_table_id
       OR v_existing.table_session_id IS DISTINCT FROM p_table_session_id
       OR v_existing.expected_version IS DISTINCT FROM p_expected_version
       OR v_existing.actor_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'SWING_IDEMPOTENCY_CONFLICT';
    END IF;
    IF v_existing.response IS NULL THEN
      RAISE EXCEPTION 'SWING_REQUEST_IN_PROGRESS';
    END IF;
    RETURN v_existing.response || jsonb_build_object('idempotent', true);
  END IF;

  v_club_id := public._dealer_swing_assert_exact_context(
    p_table_id,
    p_table_session_id,
    p_assignment_id,
    p_expected_version,
    NULL
  );

  SELECT da.pre_assigned_attendance_id
  INTO v_pre_assigned_attendance_id
  FROM public.dealer_assignments da
  WHERE da.id = p_assignment_id;

  IF v_pre_assigned_attendance_id IS NOT NULL THEN
    PERFORM public._dealer_swing_assert_exact_context(
      p_table_id,
      p_table_session_id,
      p_assignment_id,
      p_expected_version,
      v_pre_assigned_attendance_id
    );
  END IF;

  v_result := public.perform_swing(
    p_assignment_id := p_assignment_id,
    p_expected_version := p_expected_version
  );
  v_result := public._dealer_swing_bind_result_session(
    v_result, v_club_id, p_table_id, p_table_session_id
  );

  UPDATE public.dealer_swing_operator_requests
  SET response = v_result, completed_at = now()
  WHERE club_id = v_club_id AND request_id = p_request_id;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.worker_perform_swing(
  p_table_id uuid,
  p_table_session_id uuid,
  p_assignment_id uuid,
  p_duration_minutes integer DEFAULT 30,
  p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT 15,
  p_max_break_minutes integer DEFAULT 60,
  p_expected_version integer DEFAULT NULL,
  p_next_attendance_id uuid DEFAULT NULL,
  p_rest_deficit_minutes integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_club_id uuid;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'SWING_EXPECTED_VERSION_REQUIRED';
  END IF;

  v_club_id := public._dealer_swing_assert_exact_context(
    p_table_id,
    p_table_session_id,
    p_assignment_id,
    p_expected_version,
    p_next_attendance_id
  );

  v_result := public.perform_swing(
    p_assignment_id := p_assignment_id,
    p_duration_minutes := p_duration_minutes,
    p_send_to_break := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_max_break_minutes := p_max_break_minutes,
    p_expected_version := p_expected_version,
    p_next_attendance_id := p_next_attendance_id,
    p_rest_deficit_minutes := p_rest_deficit_minutes
  );

  RETURN public._dealer_swing_bind_result_session(
    v_result, v_club_id, p_table_id, p_table_session_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.worker_execute_pre_assigned_swing(
  p_table_id uuid,
  p_table_session_id uuid,
  p_old_assignment_id uuid,
  p_expected_version integer,
  p_next_attendance_id uuid,
  p_swing_due_at timestamp with time zone,
  p_duration_minutes integer,
  p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_club_id uuid;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN';
  END IF;

  v_club_id := public._dealer_swing_assert_exact_context(
    p_table_id,
    p_table_session_id,
    p_old_assignment_id,
    p_expected_version,
    p_next_attendance_id
  );

  v_result := public.execute_pre_assigned_swing(
    p_old_assignment_id,
    p_next_attendance_id,
    p_swing_due_at,
    p_duration_minutes,
    p_send_to_break,
    p_break_duration_minutes
  );

  RETURN public._dealer_swing_bind_result_session(
    v_result, v_club_id, p_table_id, p_table_session_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._dealer_swing_bind_result_session(jsonb,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._dealer_swing_assert_exact_context(uuid,uuid,uuid,integer,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perform_swing(uuid,uuid,boolean,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perform_swing(uuid,integer,uuid,boolean,integer,integer,timestamp with time zone,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_pre_assigned_swing(uuid,uuid,timestamp with time zone,integer,boolean,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_pre_assigned_swing_rpc(uuid,uuid,timestamp with time zone,integer,boolean,integer)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.worker_execute_pre_assigned_swing(uuid,uuid,uuid,integer,uuid,timestamp with time zone,integer,boolean,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_execute_pre_assigned_swing(uuid,uuid,uuid,integer,uuid,timestamp with time zone,integer,boolean,integer)
  TO service_role;

COMMENT ON FUNCTION public.operator_perform_swing(uuid,uuid,uuid,integer,uuid) IS
  'Authenticated same-club Dealer-control boundary for one exact table session and assignment version.';
COMMENT ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer) IS
  'Service-role-only exact-context boundary for automatic Dealer Swing selection.';
COMMENT ON FUNCTION public.worker_execute_pre_assigned_swing(uuid,uuid,uuid,integer,uuid,timestamp with time zone,integer,boolean,integer) IS
  'Service-role-only exact-context boundary for executing an announced pre-assigned swing.';

COMMIT;
