-- Dealer Swing phone completion: guarded operator batch check-in.
-- SOURCE ONLY. Production apply, rollout changes, and flag enable remain owner-gated.
--
-- Arrival and payroll remain separate:
--   dealer_shift_assignments.checked_in_at = actual arrival
--   dealer_attendance.check_in_time         = payroll/pool start
-- Scheduled entries always use _dealer_record_checkin so early arrivals wait for
-- bridge_shift_checkins_to_pool. This migration never writes a future check_in_time
-- and does not modify process-swing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dealer_swing_phone_rollout (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled           boolean NOT NULL DEFAULT false,
  all_clubs_enabled boolean NOT NULL DEFAULT false,
  allowed_club_ids  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.dealer_swing_phone_rollout (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dealer_swing_phone_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_swing_phone_rollout FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dealer_swing_phone_rollout TO service_role;

CREATE TABLE IF NOT EXISTS public.operator_dealer_checkin_requests (
  request_id   uuid PRIMARY KEY,
  actor_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  status       text NOT NULL DEFAULT 'in_progress'
               CHECK (status IN ('in_progress', 'completed')),
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_operator_dealer_checkin_requests_expires
  ON public.operator_dealer_checkin_requests (expires_at);

ALTER TABLE public.operator_dealer_checkin_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operator_dealer_checkin_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.operator_dealer_checkin_requests TO service_role;

CREATE OR REPLACE FUNCTION public._dealer_phone_parse_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public._dealer_swing_phone_actor_allowed(
  p_actor_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_actor_id IS NOT NULL
     AND p_club_id IS NOT NULL
     AND (
       public.is_club_dealer_control(p_actor_id, p_club_id)
       OR public.is_club_admin(p_actor_id, p_club_id)
       OR public.has_role(p_actor_id, 'super_admin'::public.app_role)
     );
$$;

CREATE OR REPLACE FUNCTION public.get_dealer_swing_phone_rollout(p_expected_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_enabled     boolean := false;
  v_all_clubs   boolean := false;
  v_allowlisted boolean := false;
BEGIN
  IF NOT public._dealer_swing_phone_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'master_enabled', false,
      'allowlisted', false,
      'all_clubs_enabled', false,
      'reason', 'actor_not_allowed'
    );
  END IF;

  SELECT r.enabled,
         r.all_clubs_enabled,
         p_expected_club_id = ANY(r.allowed_club_ids)
    INTO v_enabled, v_all_clubs, v_allowlisted
  FROM public.dealer_swing_phone_rollout r
  WHERE r.id;

  RETURN jsonb_build_object(
    'allowed', v_enabled AND (v_allowlisted OR v_all_clubs),
    'master_enabled', v_enabled,
    'allowlisted', v_allowlisted,
    'all_clubs_enabled', v_all_clubs,
    'reason', CASE
      WHEN NOT v_enabled THEN 'master_disabled'
      WHEN NOT (v_allowlisted OR v_all_clubs) THEN 'club_not_enabled'
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.operator_check_in_dealers(
  p_request_id uuid,
  p_expected_club_id uuid,
  p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_rollout        public.dealer_swing_phone_rollout%ROWTYPE;
  v_request_hash   text;
  v_claimed        uuid;
  v_existing       public.operator_dealer_checkin_requests%ROWTYPE;
  v_entry          jsonb;
  v_ord            integer;
  v_row            record;
  v_candidate      record;
  v_duplicate      record;
  v_core           jsonb;
  v_result         jsonb;
  v_results        jsonb := '[]'::jsonb;
  v_response       jsonb;
  v_total          integer;
  v_success        integer;
  v_code           text;
  v_arrival_at     timestamptz;
  v_payroll_at     timestamptz;
  v_entered        boolean;
BEGIN
  IF v_actor IS NULL
     OR p_request_id IS NULL
     OR p_expected_club_id IS NULL
     OR p_entries IS NULL
     OR jsonb_typeof(p_entries) <> 'array' THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  IF NOT public._dealer_swing_phone_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'actor_not_allowed');
  END IF;

  SELECT * INTO v_rollout
  FROM public.dealer_swing_phone_rollout
  WHERE id;

  IF NOT COALESCE(v_rollout.enabled, false)
     OR NOT (p_expected_club_id = ANY(COALESCE(v_rollout.allowed_club_ids, '{}'::uuid[]))
             OR COALESCE(v_rollout.all_clubs_enabled, false)) THEN
    RETURN jsonb_build_object('outcome', 'rollout_disabled');
  END IF;

  v_total := jsonb_array_length(p_entries);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;
  IF v_total > 50 THEN
    RETURN jsonb_build_object('outcome', 'batch_too_large', 'limit', 50);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.operator_checkin_batch (
    input_ord             integer PRIMARY KEY,
    entry_id              uuid NOT NULL,
    mode                  text NOT NULL,
    input_method          text NOT NULL,
    user_id_input         uuid,
    dealer_id_input       uuid,
    shift_assignment_id   uuid,
    reason                text,
    resolved_dealer_id    uuid,
    dealer_club_id        uuid,
    dealer_status         text,
    dealer_deleted_at     timestamptz,
    assignment_club_id    uuid,
    assignment_dealer_id  uuid,
    assignment_status     text
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.operator_checkin_batch;

  FOR v_entry, v_ord IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_entries) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR NOT (v_entry ?& ARRAY[
         'entry_id', 'mode', 'input_method', 'user_id', 'dealer_id',
         'shift_assignment_id', 'reason'
       ])
       OR jsonb_typeof(v_entry->'entry_id') <> 'string'
       OR jsonb_typeof(v_entry->'mode') <> 'string'
       OR jsonb_typeof(v_entry->'input_method') <> 'string'
       OR jsonb_typeof(v_entry->'user_id') NOT IN ('string', 'null')
       OR jsonb_typeof(v_entry->'dealer_id') NOT IN ('string', 'null')
       OR jsonb_typeof(v_entry->'shift_assignment_id') NOT IN ('string', 'null')
       OR jsonb_typeof(v_entry->'reason') NOT IN ('string', 'null') THEN
      RETURN jsonb_build_object('outcome', 'invalid_request', 'entry_index', v_ord);
    END IF;

    IF public._dealer_phone_parse_uuid(v_entry->>'entry_id') IS NULL
       OR v_entry->>'mode' NOT IN ('scheduled', 'unscheduled')
       OR v_entry->>'input_method' NOT IN ('camera', 'paste', 'manual_list') THEN
      RETURN jsonb_build_object('outcome', 'invalid_request', 'entry_index', v_ord);
    END IF;

    IF v_entry->>'input_method' IN ('camera', 'paste') THEN
      IF public._dealer_phone_parse_uuid(v_entry->>'user_id') IS NULL
         OR v_entry->'dealer_id' <> 'null'::jsonb THEN
        RETURN jsonb_build_object('outcome', 'invalid_request', 'entry_index', v_ord);
      END IF;
    ELSE
      IF public._dealer_phone_parse_uuid(v_entry->>'dealer_id') IS NULL
         OR v_entry->'user_id' <> 'null'::jsonb THEN
        RETURN jsonb_build_object('outcome', 'invalid_request', 'entry_index', v_ord);
      END IF;
    END IF;

    IF v_entry->>'mode' = 'scheduled' THEN
      IF jsonb_typeof(v_entry->'shift_assignment_id') = 'string'
         AND public._dealer_phone_parse_uuid(v_entry->>'shift_assignment_id') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_request', 'entry_index', v_ord);
      END IF;
    ELSE
      IF v_entry->'shift_assignment_id' <> 'null'::jsonb THEN
        RETURN jsonb_build_object('outcome', 'invalid_request', 'entry_index', v_ord);
      END IF;
    END IF;

    BEGIN
      INSERT INTO pg_temp.operator_checkin_batch (
        input_ord, entry_id, mode, input_method, user_id_input,
        dealer_id_input, shift_assignment_id, reason
      ) VALUES (
        v_ord,
        public._dealer_phone_parse_uuid(v_entry->>'entry_id'),
        v_entry->>'mode',
        v_entry->>'input_method',
        public._dealer_phone_parse_uuid(v_entry->>'user_id'),
        public._dealer_phone_parse_uuid(v_entry->>'dealer_id'),
        public._dealer_phone_parse_uuid(v_entry->>'shift_assignment_id'),
        CASE WHEN jsonb_typeof(v_entry->'reason') = 'string' THEN btrim(v_entry->>'reason') ELSE NULL END
      );
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'duplicate_entry_id');
    END;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_temp.operator_checkin_batch WHERE mode = 'scheduled')
     AND NOT public._dealer_scheduled_pool_enabled() THEN
    RETURN jsonb_build_object('outcome', 'rollout_disabled', 'reason', 'scheduled_pool_bridge_disabled');
  END IF;

  -- Resolve identity server-side. For user QR input, prefer the expected club;
  -- retaining a deterministic cross-club candidate lets us return club_mismatch.
  FOR v_row IN SELECT * FROM pg_temp.operator_checkin_batch ORDER BY input_ord
  LOOP
    IF v_row.input_method = 'manual_list' THEN
      SELECT d.id, d.club_id, d.status, d.deleted_at
        INTO v_candidate
      FROM public.dealers d
      WHERE d.id = v_row.dealer_id_input;
    ELSE
      SELECT d.id, d.club_id, d.status, d.deleted_at
        INTO v_candidate
      FROM public.dealers d
      WHERE d.user_id = v_row.user_id_input
      ORDER BY (d.club_id = p_expected_club_id) DESC,
               (d.status = 'active' AND d.deleted_at IS NULL) DESC,
               d.id
      LIMIT 1;
    END IF;

    IF v_candidate.id IS NOT NULL THEN
      UPDATE pg_temp.operator_checkin_batch
      SET resolved_dealer_id = v_candidate.id,
          dealer_club_id = v_candidate.club_id,
          dealer_status = v_candidate.status,
          dealer_deleted_at = v_candidate.deleted_at
      WHERE input_ord = v_row.input_ord;
    END IF;

    IF v_row.mode = 'scheduled' THEN
      UPDATE pg_temp.operator_checkin_batch b
      SET assignment_club_id = a.club_id,
          assignment_dealer_id = a.dealer_id,
          assignment_status = a.status
      FROM public.dealer_shift_assignments a
      WHERE b.input_ord = v_row.input_ord
        AND a.id = v_row.shift_assignment_id;
    END IF;
  END LOOP;

  SELECT resolved_dealer_id, array_agg(entry_id ORDER BY input_ord) AS entry_ids
    INTO v_duplicate
  FROM pg_temp.operator_checkin_batch
  WHERE resolved_dealer_id IS NOT NULL
  GROUP BY resolved_dealer_id
  HAVING count(*) > 1
  ORDER BY resolved_dealer_id
  LIMIT 1;

  IF v_duplicate.resolved_dealer_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'duplicate_dealer',
      'entry_ids', to_jsonb(v_duplicate.entry_ids)
    );
  END IF;

  v_request_hash := encode(
    extensions.digest(
      convert_to(p_expected_club_id::text || ':' || p_entries::text, 'utf8'),
      'sha256'
    ),
    'hex'
  );

  DELETE FROM public.operator_dealer_checkin_requests WHERE expires_at < now();
  INSERT INTO public.operator_dealer_checkin_requests (
    request_id, actor_id, club_id, request_hash, status, expires_at
  ) VALUES (
    p_request_id, v_actor, p_expected_club_id, v_request_hash,
    'in_progress', now() + interval '7 days'
  )
  ON CONFLICT (request_id) DO NOTHING
  RETURNING request_id INTO v_claimed;

  IF v_claimed IS NULL THEN
    SELECT * INTO v_existing
    FROM public.operator_dealer_checkin_requests
    WHERE request_id = p_request_id;

    IF v_existing.actor_id IS DISTINCT FROM v_actor
       OR v_existing.club_id IS DISTINCT FROM p_expected_club_id
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.status <> 'completed'
       OR v_existing.response IS NULL THEN
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;
    RETURN v_existing.response;
  END IF;

  -- Every batch uses the same lock order, independent of input order.
  PERFORM d.id
  FROM public.dealers d
  JOIN (
    SELECT DISTINCT resolved_dealer_id
    FROM pg_temp.operator_checkin_batch
    WHERE resolved_dealer_id IS NOT NULL
      AND dealer_club_id = p_expected_club_id
  ) b ON b.resolved_dealer_id = d.id
  ORDER BY d.id
  FOR UPDATE OF d;

  PERFORM a.id
  FROM public.dealer_shift_assignments a
  JOIN (
    SELECT DISTINCT shift_assignment_id
    FROM pg_temp.operator_checkin_batch
    WHERE shift_assignment_id IS NOT NULL
      AND assignment_club_id = p_expected_club_id
  ) b ON b.shift_assignment_id = a.id
  ORDER BY a.id
  FOR UPDATE OF a;

  -- Refresh all mutable validation fields after locks are held.
  UPDATE pg_temp.operator_checkin_batch b
  SET dealer_club_id = d.club_id,
      dealer_status = d.status,
      dealer_deleted_at = d.deleted_at
  FROM public.dealers d
  WHERE d.id = b.resolved_dealer_id
    AND b.dealer_club_id = p_expected_club_id;

  UPDATE pg_temp.operator_checkin_batch b
  SET assignment_club_id = a.club_id,
      assignment_dealer_id = a.dealer_id,
      assignment_status = a.status
  FROM public.dealer_shift_assignments a
  WHERE a.id = b.shift_assignment_id
    AND b.assignment_club_id = p_expected_club_id;

  FOR v_row IN SELECT * FROM pg_temp.operator_checkin_batch ORDER BY input_ord
  LOOP
    v_result := NULL;
    v_code := NULL;
    v_arrival_at := NULL;
    v_payroll_at := NULL;
    v_core := NULL;

    BEGIN
      IF v_row.mode = 'unscheduled' AND COALESCE(v_row.reason, '') = '' THEN
        v_code := 'reason_required';
      ELSIF v_row.resolved_dealer_id IS NULL THEN
        v_code := 'dealer_not_found';
      ELSIF v_row.dealer_club_id IS DISTINCT FROM p_expected_club_id THEN
        v_code := 'club_mismatch';
      ELSIF v_row.dealer_status IS DISTINCT FROM 'active' OR v_row.dealer_deleted_at IS NOT NULL THEN
        v_code := 'dealer_inactive';
      ELSIF v_row.mode = 'scheduled' THEN
        IF v_row.shift_assignment_id IS NULL OR v_row.assignment_club_id IS NULL THEN
          v_code := 'shift_not_found';
        ELSIF v_row.assignment_club_id IS DISTINCT FROM p_expected_club_id THEN
          v_code := 'club_mismatch';
        ELSIF v_row.assignment_dealer_id IS DISTINCT FROM v_row.resolved_dealer_id THEN
          v_code := 'shift_dealer_mismatch';
        ELSIF v_row.assignment_status = 'checked_in' THEN
          v_code := 'already_checked_in';
          SELECT a.checked_in_at INTO v_arrival_at
          FROM public.dealer_shift_assignments a
          WHERE a.id = v_row.shift_assignment_id;
          SELECT da.check_in_time INTO v_payroll_at
          FROM public.dealer_attendance da
          WHERE da.dealer_id = v_row.resolved_dealer_id
            AND da.status = 'checked_in'
          ORDER BY da.created_at DESC
          LIMIT 1;
        ELSIF v_row.assignment_status NOT IN ('published', 'confirmed') THEN
          v_code := 'invalid_shift_state';
        ELSE
          v_core := public._dealer_record_checkin(v_row.shift_assignment_id, 'phone_operator_checkin');
          IF v_core->>'outcome' = 'too_early' THEN
            v_code := 'too_early';
          ELSIF v_core->>'outcome' = 'not_found' THEN
            v_code := 'shift_not_found';
          ELSIF v_core->>'outcome' = 'invalid_state' THEN
            v_code := 'invalid_shift_state';
          ELSIF v_core->>'outcome' = 'checked_in' THEN
            v_arrival_at := NULLIF(v_core->>'checked_in_at', '')::timestamptz;
            IF COALESCE((v_core->>'entered_pool')::boolean, false) THEN
              v_code := 'checked_in_available';
              SELECT da.check_in_time INTO v_payroll_at
              FROM public.dealer_attendance da
              WHERE da.dealer_id = v_row.resolved_dealer_id
                AND da.status = 'checked_in'
              ORDER BY da.created_at DESC
              LIMIT 1;
            ELSIF COALESCE((v_core->>'pending_pool')::boolean, false) THEN
              v_code := 'checked_in_waiting';
            ELSIF v_core->>'pool_entry_reason' = 'already_in_pool' THEN
              v_code := 'already_checked_in';
              SELECT da.check_in_time INTO v_payroll_at
              FROM public.dealer_attendance da
              WHERE da.dealer_id = v_row.resolved_dealer_id
                AND da.status = 'checked_in'
              ORDER BY da.created_at DESC
              LIMIT 1;
            ELSE
              v_code := 'failed';
            END IF;
          ELSE
            v_code := 'failed';
          END IF;
        END IF;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.dealer_attendance da
          WHERE da.dealer_id = v_row.resolved_dealer_id
            AND da.status = 'checked_in'
        ) INTO v_entered;

        IF v_entered THEN
          v_code := 'already_checked_in';
          SELECT da.check_in_time INTO v_payroll_at
          FROM public.dealer_attendance da
          WHERE da.dealer_id = v_row.resolved_dealer_id
            AND da.status = 'checked_in'
          ORDER BY da.created_at DESC
          LIMIT 1;
          v_arrival_at := v_payroll_at;
        ELSE
          v_arrival_at := clock_timestamp();
          v_entered := public._enter_dealer_pool(
            v_row.resolved_dealer_id,
            p_expected_club_id,
            v_arrival_at
          );
          IF v_entered THEN
            v_code := 'checked_in_available';
            SELECT da.check_in_time INTO v_payroll_at
            FROM public.dealer_attendance da
            WHERE da.dealer_id = v_row.resolved_dealer_id
              AND da.status = 'checked_in'
            ORDER BY da.created_at DESC
            LIMIT 1;

            INSERT INTO public.audit_logs (
              club_id, actor_id, action, entity_type, entity_id, payload
            ) VALUES (
              p_expected_club_id,
              v_actor,
              'operator_dealer_unscheduled_checkin',
              'dealer',
              v_row.resolved_dealer_id,
              jsonb_build_object(
                'request_id', p_request_id,
                'entry_id', v_row.entry_id,
                'input_method', v_row.input_method,
                'reason', v_row.reason,
                'arrival_at', v_arrival_at,
                'payroll_start_at', v_payroll_at
              )
            );
          ELSE
            v_code := 'conflict';
          END IF;
        END IF;
      END IF;

      v_result := jsonb_build_object(
        'entry_id', v_row.entry_id,
        'dealer_id', v_row.resolved_dealer_id,
        'code', v_code,
        'arrival_at', v_arrival_at,
        'payroll_start_at', v_payroll_at,
        'window_opens_at', CASE WHEN v_code = 'too_early' THEN v_core->>'window_opens_at' ELSE NULL END
      );
    EXCEPTION
      WHEN unique_violation OR serialization_failure OR deadlock_detected THEN
        v_result := jsonb_build_object(
          'entry_id', v_row.entry_id,
          'dealer_id', v_row.resolved_dealer_id,
          'code', 'conflict'
        );
      WHEN OTHERS THEN
        v_result := jsonb_build_object(
          'entry_id', v_row.entry_id,
          'dealer_id', v_row.resolved_dealer_id,
          'code', 'failed'
        );
    END;

    v_results := v_results || jsonb_build_array(v_result);
  END LOOP;

  SELECT count(*) FILTER (
    WHERE value->>'code' IN (
      'checked_in_waiting', 'checked_in_available', 'already_checked_in'
    )
  )
  INTO v_success
  FROM jsonb_array_elements(v_results);

  v_response := jsonb_build_object(
    'outcome', CASE WHEN v_success = v_total THEN 'completed' ELSE 'partial' END,
    'request_id', p_request_id,
    'club_id', p_expected_club_id,
    'results', v_results
  );

  UPDATE public.operator_dealer_checkin_requests
  SET status = 'completed', response = v_response
  WHERE request_id = p_request_id
    AND actor_id = v_actor
    AND status = 'in_progress';

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public._dealer_phone_parse_uuid(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dealer_swing_phone_actor_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dealer_swing_phone_rollout(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operator_check_in_dealers(uuid, uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_dealer_swing_phone_rollout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_check_in_dealers(uuid, uuid, jsonb) TO authenticated;

COMMENT ON TABLE public.dealer_swing_phone_rollout IS
  'Emergency runtime gate for Dealer Swing phone completion. Default OFF; internal only.';
COMMENT ON TABLE public.operator_dealer_checkin_requests IS
  'Internal request-level idempotency store for operator dealer check-in batches.';
COMMENT ON FUNCTION public.operator_check_in_dealers(uuid, uuid, jsonb) IS
  'Server-resolved, club-scoped, idempotent operator check-in. Max 50 entries; partial per-entry outcomes.';

COMMIT;

-- Manual rollback (owner-controlled window only):
-- BEGIN;
-- REVOKE ALL ON FUNCTION public.operator_check_in_dealers(uuid, uuid, jsonb) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.get_dealer_swing_phone_rollout(uuid) FROM authenticated;
-- DROP FUNCTION IF EXISTS public.operator_check_in_dealers(uuid, uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.get_dealer_swing_phone_rollout(uuid);
-- DROP FUNCTION IF EXISTS public._dealer_swing_phone_actor_allowed(uuid, uuid);
-- DROP FUNCTION IF EXISTS public._dealer_phone_parse_uuid(text);
-- DROP TABLE IF EXISTS public.operator_dealer_checkin_requests;
-- DROP TABLE IF EXISTS public.dealer_swing_phone_rollout;
-- COMMIT;
