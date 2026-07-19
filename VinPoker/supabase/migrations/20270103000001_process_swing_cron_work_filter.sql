-- ============================================================================
-- 20270103000001_process_swing_cron_work_filter.sql
--
-- Source-only performance hardening for the process-swing cron caller.
-- The cron keeps its one-minute schedule, but it calls Edge only for approved
-- clubs that explicitly enabled auto-swing and currently have real work.
-- Empty/canary clubs without assignments, checked-in dealers, or live rotation
-- rows produce no Vault read, no pg_net request, and no _http_response row.
--
-- APPLY ORDER: deploy the compatible process-swing Edge version that accepts
-- body.club_ids before applying this migration.
--
-- OWNER-GATED APPLY. Do not apply autonomously.
--
-- ROLLBACK (owner-gated): recreate run_process_swing_cron() from
-- 20260717000001_process_swing_cron_vault_caller.sql, then drop
-- public.get_process_swing_due_club_ids(). This restores all-club Edge calls.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_process_swing_due_club_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}'::uuid[])
  FROM public.clubs AS c
  JOIN public.club_settings AS cs
    ON cs.club_id = c.id
   AND cs.auto_swing_enabled = true
  WHERE c.status = 'approved'
    AND (
      EXISTS (
        SELECT 1
        FROM public.dealer_assignments AS a
        JOIN public.game_tables AS t ON t.id = a.table_id
        WHERE t.club_id = c.id
          AND t.status = 'active'
          AND a.status = 'assigned'
          AND a.released_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.dealer_attendance AS attendance
        JOIN public.dealers AS d ON d.id = attendance.dealer_id
        WHERE d.club_id = c.id
          AND attendance.status = 'checked_in'
          AND attendance.check_out_time IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.dealer_rotation_schedule AS rotation
        WHERE rotation.club_id = c.id
          AND rotation.status IN ('predicted', 'announced', 'executing')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_process_swing_due_club_ids()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_process_swing_due_club_ids()
  TO service_role;

CREATE OR REPLACE FUNCTION public.run_process_swing_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url          text;
  v_secret       text;
  v_request_id   bigint;
  v_club_ids     uuid[];
BEGIN
  -- Finalize prior asynchronous requests before deciding whether this tick has
  -- new work. Bodies/headers/credentials are never persisted.
  UPDATE public.process_swing_cron_runs AS r
  SET response_status = h.status_code,
      response_observed_at = now(),
      result_state = CASE
        WHEN h.timed_out OR h.status_code IS NULL THEN 'failed'
        WHEN h.status_code BETWEEN 200 AND 299 THEN 'success'
        ELSE 'failed'
      END,
      error_code = CASE
        WHEN h.timed_out OR h.status_code IS NULL THEN 'timeout'
        WHEN h.status_code = 401 THEN 'http_401'
        WHEN h.status_code = 403 THEN 'http_403'
        WHEN h.status_code BETWEEN 400 AND 499 THEN 'http_4xx'
        WHEN h.status_code BETWEEN 500 AND 599 THEN 'http_5xx'
        WHEN h.status_code BETWEEN 200 AND 299 THEN NULL
        ELSE 'http_non_2xx'
      END
  FROM net._http_response AS h
  WHERE r.request_id = h.id
    AND r.result_state = 'pending';

  v_club_ids := public.get_process_swing_due_club_ids();
  IF cardinality(v_club_ids) = 0 THEN
    RETURN NULL;
  END IF;

  -- Do not read Vault until the cheap relational preflight proves work exists.
  v_url := COALESCE(
    NULLIF(current_setting('app.supabase_url', true), ''),
    'https://orlesggcjamwuknxwcpk.supabase.co'
  );

  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'PROCESS_SWING_INTERNAL_SECRET';

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    INSERT INTO public.process_swing_cron_runs (
      enqueue_state, result_state, error_code
    ) VALUES (
      'skipped_secret_missing', 'failed', 'vault_secret_missing'
    );
    RAISE LOG 'run_process_swing_cron: Vault secret missing; request skipped';
    RETURN NULL;
  END IF;

  BEGIN
    SELECT net.http_post(
      url := v_url || '/functions/v1/process-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('club_ids', v_club_ids),
      timeout_milliseconds := 8000
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.process_swing_cron_runs (
      enqueue_state, result_state, error_code
    ) VALUES (
      'enqueue_error', 'failed', 'enqueue_exception'
    );
    RAISE LOG 'run_process_swing_cron: pg_net enqueue exception; request skipped';
    RETURN NULL;
  END;

  IF v_request_id IS NULL THEN
    INSERT INTO public.process_swing_cron_runs (
      enqueue_state, result_state, error_code
    ) VALUES (
      'enqueue_error', 'failed', 'enqueue_no_request_id'
    );
    RAISE LOG 'run_process_swing_cron: pg_net returned no request id';
    RETURN NULL;
  END IF;

  INSERT INTO public.process_swing_cron_runs (
    request_id, enqueue_state, result_state
  ) VALUES (
    v_request_id, 'enqueued', 'pending'
  ) ON CONFLICT (request_id) DO NOTHING;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_process_swing_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_process_swing_cron()
  TO service_role;

COMMIT;
