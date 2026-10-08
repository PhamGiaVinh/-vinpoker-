-- SOURCE ONLY: canonical sessions for dealer mass-open; no automatic legacy repair.
-- Requires migration17. ROLLBACK: restore reviewed prior RPC definition; retain session/operation history.
BEGIN;
CREATE OR REPLACE FUNCTION public.operator_open_dealer_tables(
  p_request_id uuid,
  p_expected_club_id uuid,
  p_shift_id uuid,
  p_table_ids uuid[],
  p_table_type text DEFAULT 'tournament'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_table_ids      uuid[];
  v_count          integer;
  v_scope_count    integer;
  v_fingerprint    text;
  v_existing       public.dealer_open_operations%ROWTYPE;
  v_claimed        uuid;
  v_missing_tables uuid[];
  v_open_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_request_id IS NULL
     OR p_expected_club_id IS NULL
     OR p_table_ids IS NULL
     OR array_length(p_table_ids, 1) IS NULL
     OR p_table_type NOT IN ('cash', 'tournament', 'vip') THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  IF NOT public._dealer_mass_open_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'actor_not_allowed');
  END IF;

  IF NOT public._dealer_mass_open_runtime_allowed(p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'rollout_disabled');
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_table_ids) id WHERE id IS NULL) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'null_table_id');
  END IF;

  SELECT array_agg(DISTINCT id ORDER BY id), count(DISTINCT id)
    INTO v_table_ids, v_count
  FROM unnest(p_table_ids) id;

  IF cardinality(p_table_ids) > 50 THEN
    RETURN jsonb_build_object('outcome', 'batch_too_large', 'limit', 50);
  END IF;

  IF v_count <> cardinality(p_table_ids) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'duplicate_table');
  END IF;

  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.dealer_shifts shift
    WHERE shift.id = p_shift_id
      AND shift.club_id = p_expected_club_id
      AND shift.closed_at IS NULL
      AND shift.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'shift_not_active');
  END IF;

  -- Shared receipt is locked before physical tables, matching canonical Floor order.
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'operator_open_club_tables_v2', p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(280018, pg_catalog.hashtext(p_request_id::text));

  v_fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'club_id', p_expected_club_id,
        'shift_id', p_shift_id,
        'table_ids', to_jsonb(v_table_ids),
        'table_type', p_table_type
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  SELECT * INTO v_existing
  FROM public.dealer_open_operations
  WHERE id = p_request_id;

  IF FOUND THEN
    IF v_existing.requested_by <> v_actor
       OR v_existing.club_id <> p_expected_club_id
       OR v_existing.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;
    PERFORM public._refresh_dealer_open_operation(p_request_id);
    RETURN public._dealer_open_operation_result(p_request_id, true);
  END IF;

  -- Lock every requested table in canonical UUID order before validating or
  -- mutating any table. Input ordering therefore cannot create a lock cycle.
  PERFORM 1
  FROM public.game_tables table_row
  WHERE table_row.id = ANY(v_table_ids)
    AND table_row.club_id = p_expected_club_id
  ORDER BY table_row.id
  FOR UPDATE;
  GET DIAGNOSTICS v_scope_count = ROW_COUNT;

  IF v_scope_count <> v_count THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'table_scope_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.game_tables table_row
    WHERE table_row.id = ANY(v_table_ids)
      AND table_row.status = 'maintenance'
  ) THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'table_in_maintenance');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.game_tables table_row
    JOIN public.dealer_open_operations old_operation
      ON old_operation.id = table_row.dealer_open_operation_id
    WHERE table_row.id = ANY(v_table_ids)
      AND old_operation.id <> p_request_id
      AND old_operation.status IN ('pending', 'running', 'waiting_for_dealer')
      AND old_operation.expires_at > now()
      AND table_row.opened_at >= now() - interval '24 hours'
  ) THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'table_in_open_operation');
  END IF;

  -- Do not silently turn an orphan or a different incarnation into an open table.
  IF EXISTS(SELECT 1 FROM floor_private.club_operational_inventory(p_expected_club_id) i
    WHERE i.game_table_id=ANY(v_table_ids) AND
      (i.availability_status NOT IN ('available','in_use')
       OR (i.availability_status='in_use' AND i.session_type<>p_table_type))) THEN
    RETURN jsonb_build_object('outcome','conflict','reason','table_session_requires_review');
  END IF;
  SELECT array_agg(i.game_table_id ORDER BY i.game_table_id) INTO v_missing_tables
    FROM floor_private.club_operational_inventory(p_expected_club_id) i
    WHERE i.game_table_id=ANY(v_table_ids) AND i.availability_status='available';
  IF v_missing_tables IS NOT NULL THEN
    IF p_table_type='tournament' THEN
      RETURN jsonb_build_object('outcome','invalid_request','reason','open_tournament_in_floor');
    END IF;
    v_open_result:=public.operator_open_club_tables_v2(v_missing_tables,p_table_type,p_request_id);
    IF v_open_result->>'ok' IS DISTINCT FROM 'true' THEN
      RETURN jsonb_build_object('outcome','conflict','reason',v_open_result->>'error');
    END IF;
  END IF;

  INSERT INTO public.dealer_open_operations (
    id, club_id, shift_id, requested_by, table_type, request_fingerprint,
    requested_count, remaining_count
  ) VALUES (
    p_request_id, p_expected_club_id, p_shift_id, v_actor, p_table_type,
    v_fingerprint, v_count, v_count
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_claimed;

  IF v_claimed IS NULL THEN
    SELECT * INTO v_existing
    FROM public.dealer_open_operations
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_existing.requested_by <> v_actor
       OR v_existing.club_id <> p_expected_club_id
       OR v_existing.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;

    PERFORM public._refresh_dealer_open_operation(p_request_id);
    RETURN public._dealer_open_operation_result(p_request_id, true);
  END IF;

  INSERT INTO public.dealer_open_operation_targets (
    operation_id, table_id, initial_status, target_state, assignment_id,
    outcome_code, assigned_at
  )
  SELECT
    p_request_id,
    table_row.id,
    table_row.status,
    CASE WHEN active_assignment.id IS NULL THEN 'pending' ELSE 'already_staffed' END,
    active_assignment.id,
    CASE WHEN active_assignment.id IS NULL THEN 'waiting_for_dealer' ELSE 'already_staffed' END,
    active_assignment.assigned_at
  FROM public.game_tables table_row
  LEFT JOIN LATERAL (
    SELECT assignment.id, assignment.assigned_at
    FROM public.dealer_assignments assignment
    WHERE assignment.table_id = table_row.id
      AND assignment.status = 'assigned'
      AND assignment.released_at IS NULL
    ORDER BY assignment.assigned_at DESC, assignment.id
    LIMIT 1
  ) active_assignment ON true
  WHERE table_row.id = ANY(v_table_ids)
  ORDER BY table_row.id;

  UPDATE public.game_tables AS table_row
  SET status = CASE WHEN target.target_state = 'already_staffed' THEN table_row.status ELSE 'active' END,
      shift_id = CASE WHEN target.target_state = 'already_staffed' THEN table_row.shift_id ELSE p_shift_id END,
      table_type = CASE WHEN target.target_state = 'already_staffed' THEN table_row.table_type ELSE p_table_type END,
      opened_at = now(),
      dealer_open_operation_id = p_request_id
  FROM public.dealer_open_operation_targets target
  WHERE target.operation_id = p_request_id
    AND target.table_id = table_row.id;

  INSERT INTO public.swing_audit_logs (
    club_id, shift_id, action, details, triggered_by
  ) VALUES (
    p_expected_club_id,
    p_shift_id,
    'dealer_tables_open_operation',
    jsonb_build_object(
      'operation_id', p_request_id,
      'table_ids', to_jsonb(v_table_ids),
      'requested', v_count,
      'table_type', p_table_type
    ),
    v_actor::text
  );

  RETURN public._refresh_dealer_open_operation(p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text) TO authenticated;
COMMIT;

