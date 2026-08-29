-- Dealer Swing phone close-table CAS.
--
-- Adds a guarded overload while preserving the existing desktop RPC:
--   close_dealer_tables(uuid, uuid, uuid[])
--
-- Phone flow:
--   1. dry-run returns a server snapshot with per-table and batch SHA-256 hashes;
--   2. apply locks tables, assignments and attendance rows in UUID order;
--   3. the snapshot is recomputed under lock and the whole batch conflicts if stale;
--   4. the legacy close implementation executes only after CAS succeeds;
--   5. request_id makes apply replay-safe and prevents duplicate audit rows.
--
-- SOURCE ONLY. Runtime rollout remains disabled by default. No production apply.

CREATE TABLE IF NOT EXISTS public.dealer_phone_close_requests (
  request_id    uuid PRIMARY KEY,
  actor_id      uuid NOT NULL,
  club_id       uuid NOT NULL,
  payload_hash  text NOT NULL,
  status        text NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress', 'completed')),
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE public.dealer_phone_close_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_phone_close_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dealer_phone_close_state(
  p_club_id uuid,
  p_table_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  WITH table_state AS (
    SELECT
      gt.id,
      jsonb_build_object(
        'table_id', gt.id,
        'table_name', gt.table_name,
        'status', gt.status,
        'shift_id', gt.shift_id,
        'assignments', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'assignment_id', da.id,
              'attendance_id', da.attendance_id,
              'status', da.status,
              'version', da.version,
              'released_at', da.released_at
            ) ORDER BY da.id
          )
          FROM public.dealer_assignments da
          WHERE da.table_id = gt.id
            AND da.status IN ('assigned', 'on_break', 'reserved')
            AND da.released_at IS NULL
        ), '[]'::jsonb),
        'preassignments', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'attendance_id', att.id,
              'dealer_id', att.dealer_id,
              'attendance_status', att.status,
              'current_state', att.current_state,
              'pre_assigned_table_id', att.pre_assigned_table_id,
              'pre_assigned_at', att.pre_assigned_at
            ) ORDER BY att.id
          )
          FROM public.dealer_attendance att
          WHERE att.pre_assigned_table_id = gt.id
        ), '[]'::jsonb)
      ) AS raw_state
    FROM public.game_tables gt
    WHERE gt.club_id = p_club_id
      AND gt.id = ANY(COALESCE(p_table_ids, '{}'::uuid[]))
  ), hashed AS (
    SELECT
      id,
      raw_state || jsonb_build_object(
        'state_hash', encode(
          extensions.digest(convert_to(raw_state::text, 'UTF8'), 'sha256'),
          'hex'
        )
      ) AS state
    FROM table_state
  ), batch AS (
    SELECT COALESCE(jsonb_agg(state ORDER BY id), '[]'::jsonb) AS tables
    FROM hashed
  )
  SELECT jsonb_build_object(
    'state_hash', encode(
      extensions.digest(convert_to(tables::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    'tables', tables
  )
  FROM batch;
$$;

CREATE OR REPLACE FUNCTION public.close_dealer_tables(
  p_request_id uuid,
  p_expected_club_id uuid,
  p_shift_id uuid,
  p_table_ids uuid[],
  p_expected_state jsonb DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_actor            uuid := auth.uid();
  v_rollout          public.dealer_swing_phone_rollout%ROWTYPE;
  v_distinct_ids     uuid[];
  v_count            integer;
  v_scope_count      integer;
  v_state            jsonb;
  v_expected_tables  jsonb;
  v_conflicts        jsonb;
  v_response         jsonb;
  v_payload_hash     text;
  v_claimed          uuid;
  v_existing         public.dealer_phone_close_requests%ROWTYPE;
  v_legacy           jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_request_id IS NULL
     OR p_expected_club_id IS NULL
     OR p_table_ids IS NULL
     OR array_length(p_table_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  IF NOT public._dealer_swing_phone_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'actor_not_allowed');
  END IF;

  SELECT * INTO v_rollout
  FROM public.dealer_swing_phone_rollout
  WHERE id;

  IF NOT COALESCE(v_rollout.enabled, false)
     OR NOT (
       p_expected_club_id = ANY(COALESCE(v_rollout.allowed_club_ids, '{}'::uuid[]))
       OR COALESCE(v_rollout.all_clubs_enabled, false)
     ) THEN
    RETURN jsonb_build_object('outcome', 'rollout_disabled');
  END IF;

  SELECT array_agg(id ORDER BY id), count(*)
    INTO v_distinct_ids, v_count
  FROM (SELECT DISTINCT unnest(p_table_ids) AS id) ids;

  IF v_count <> cardinality(p_table_ids) OR v_count > 50 THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_count > 50 THEN 'batch_too_large' ELSE 'invalid_request' END,
      'limit', 50
    );
  END IF;

  SELECT count(*) INTO v_scope_count
  FROM public.game_tables gt
  WHERE gt.id = ANY(v_distinct_ids)
    AND gt.club_id = p_expected_club_id;

  IF v_scope_count <> v_count THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'table_scope_mismatch');
  END IF;

  IF p_dry_run THEN
    SELECT count(*) INTO v_scope_count
    FROM public.game_tables gt
    WHERE gt.id = ANY(v_distinct_ids)
      AND gt.club_id = p_expected_club_id
      AND gt.status = 'active'
      AND (p_shift_id IS NULL OR gt.shift_id = p_shift_id);

    IF v_scope_count <> v_count THEN
      RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'table_not_active_or_shift_changed');
    END IF;

    v_state := public._dealer_phone_close_state(p_expected_club_id, v_distinct_ids);
    RETURN jsonb_build_object(
      'outcome', 'dry_run',
      'operation_id', p_request_id,
      'club_id', p_expected_club_id,
      'state_hash', v_state->>'state_hash',
      'tables', v_state->'tables'
    );
  END IF;

  IF p_expected_state IS NULL
     OR jsonb_typeof(p_expected_state) <> 'object'
     OR jsonb_typeof(p_expected_state->'state_hash') <> 'string'
     OR jsonb_typeof(p_expected_state->'tables') <> 'array' THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'expected_state_required');
  END IF;

  v_payload_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'club_id', p_expected_club_id,
        'shift_id', p_shift_id,
        'table_ids', to_jsonb(v_distinct_ids),
        'expected_state', p_expected_state
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.dealer_phone_close_requests (
    request_id, actor_id, club_id, payload_hash
  ) VALUES (
    p_request_id, v_actor, p_expected_club_id, v_payload_hash
  )
  ON CONFLICT (request_id) DO NOTHING
  RETURNING request_id INTO v_claimed;

  IF v_claimed IS NULL THEN
    SELECT * INTO v_existing
    FROM public.dealer_phone_close_requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF v_existing.actor_id <> v_actor
       OR v_existing.club_id <> p_expected_club_id
       OR v_existing.payload_hash <> v_payload_hash THEN
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;

    IF v_existing.status = 'completed' AND v_existing.response IS NOT NULL THEN
      RETURN v_existing.response || jsonb_build_object('idempotent_replay', true);
    END IF;

    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'request_in_progress');
  END IF;

  -- Deterministic lock order: tables, then assignment rows, then all affected
  -- attendance rows. UUID ordering is independent of client input order.
  PERFORM 1
  FROM public.game_tables gt
  WHERE gt.id = ANY(v_distinct_ids)
    AND gt.club_id = p_expected_club_id
  ORDER BY gt.id
  FOR UPDATE;

  PERFORM 1
  FROM public.dealer_assignments da
  WHERE da.table_id = ANY(v_distinct_ids)
    AND da.status IN ('assigned', 'on_break', 'reserved')
    AND da.released_at IS NULL
  ORDER BY da.id
  FOR UPDATE;

  PERFORM 1
  FROM public.dealer_attendance att
  WHERE att.pre_assigned_table_id = ANY(v_distinct_ids)
     OR att.id IN (
       SELECT da.attendance_id
       FROM public.dealer_assignments da
       WHERE da.table_id = ANY(v_distinct_ids)
         AND da.status IN ('assigned', 'on_break')
         AND da.released_at IS NULL
     )
  ORDER BY att.id
  FOR UPDATE;

  v_state := public._dealer_phone_close_state(p_expected_club_id, v_distinct_ids);
  v_expected_tables := p_expected_state->'tables';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'table_id', current_table->>'table_id',
      'code', CASE
        WHEN expected_table->>'state_hash' IS DISTINCT FROM current_table->>'state_hash'
          THEN 'conflict'
        ELSE 'ready'
      END
    ) ORDER BY current_table->>'table_id'
  ), '[]'::jsonb)
  INTO v_conflicts
  FROM jsonb_array_elements(v_state->'tables') current_table
  LEFT JOIN LATERAL (
    SELECT candidate AS expected_table
    FROM jsonb_array_elements(v_expected_tables) candidate
    WHERE candidate->>'table_id' = current_table->>'table_id'
    LIMIT 1
  ) expected ON true;

  IF p_expected_state->>'state_hash' IS DISTINCT FROM v_state->>'state_hash'
     OR jsonb_array_length(v_expected_tables) <> v_count
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_conflicts) item
       WHERE item->>'code' = 'conflict'
     ) THEN
    v_response := jsonb_build_object(
      'outcome', 'conflict',
      'operation_id', p_request_id,
      'results', v_conflicts
    );

    UPDATE public.dealer_phone_close_requests
    SET status = 'completed', response = v_response, completed_at = now()
    WHERE request_id = p_request_id;

    RETURN v_response;
  END IF;

  v_legacy := public.close_dealer_tables(
    p_expected_club_id,
    p_shift_id,
    v_distinct_ids
  );

  IF COALESCE((v_legacy->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_legacy->>'tables_closed')::integer, 0) <> v_count THEN
    RAISE EXCEPTION 'guarded close did not close the complete batch';
  END IF;

  SELECT jsonb_build_object(
    'outcome', 'completed',
    'operation_id', p_request_id,
    'club_id', p_expected_club_id,
    'tables_closed', v_legacy->'tables_closed',
    'dealers_released', v_legacy->'dealers_released',
    'closed_tables', v_legacy->'closed_tables',
    'results', COALESCE(jsonb_agg(
      jsonb_build_object('table_id', id, 'code', 'closed') ORDER BY id
    ), '[]'::jsonb)
  ) INTO v_response
  FROM unnest(v_distinct_ids) id;

  UPDATE public.dealer_phone_close_requests
  SET status = 'completed', response = v_response, completed_at = now()
  WHERE request_id = p_request_id;

  RETURN v_response;
END;
$$;

-- Phone-only reconcile entry point. The canonical seven-argument RPC remains
-- untouched for desktop fallback; this wrapper adds the same instant runtime
-- kill switch used by phone check-in and guarded close.
CREATE OR REPLACE FUNCTION public.dealer_phone_reconcile_room_state(
  p_expected_club_id uuid,
  p_corrections jsonb,
  p_effective_at timestamptz,
  p_reason text,
  p_displaced jsonb DEFAULT '[]'::jsonb,
  p_dry_run boolean DEFAULT true,
  p_admin_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_rollout public.dealer_swing_phone_rollout%ROWTYPE;
BEGIN
  IF NOT public._dealer_swing_phone_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  SELECT * INTO v_rollout
  FROM public.dealer_swing_phone_rollout
  WHERE id;

  IF NOT COALESCE(v_rollout.enabled, false)
     OR NOT (
       p_expected_club_id = ANY(COALESCE(v_rollout.allowed_club_ids, '{}'::uuid[]))
       OR COALESCE(v_rollout.all_clubs_enabled, false)
     ) THEN
    RETURN jsonb_build_object('outcome', 'rollout_disabled');
  END IF;

  RETURN public.reconcile_dealer_room_state(
    p_expected_club_id,
    p_corrections,
    p_effective_at,
    p_reason,
    p_displaced,
    p_dry_run,
    p_admin_override
  );
END;
$$;

REVOKE ALL ON FUNCTION public._dealer_phone_close_state(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dealer_phone_reconcile_room_state(uuid, jsonb, timestamptz, text, jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_phone_reconcile_room_state(uuid, jsonb, timestamptz, text, jsonb, boolean, boolean) TO authenticated;

COMMENT ON TABLE public.dealer_phone_close_requests IS
  'Internal idempotency store for guarded Dealer Swing phone close-table operations.';
COMMENT ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean) IS
  'Phone-only close overload: dry-run snapshot, deterministic locks, batch CAS, all-or-nothing apply and replay-safe audit.';
COMMENT ON FUNCTION public.dealer_phone_reconcile_room_state(uuid, jsonb, timestamptz, text, jsonb, boolean, boolean) IS
  'Phone-only runtime-gated wrapper around canonical reconcile_dealer_room_state; desktop consumer remains unchanged.';

NOTIFY pgrst, 'reload schema';

-- Owner-controlled rollback:
-- REVOKE ALL ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.dealer_phone_reconcile_room_state(uuid, jsonb, timestamptz, text, jsonb, boolean, boolean) FROM authenticated;
-- DROP FUNCTION IF EXISTS public.dealer_phone_reconcile_room_state(uuid, jsonb, timestamptz, text, jsonb, boolean, boolean);
-- DROP FUNCTION IF EXISTS public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean);
-- DROP FUNCTION IF EXISTS public._dealer_phone_close_state(uuid, uuid[]);
-- DROP TABLE IF EXISTS public.dealer_phone_close_requests;
