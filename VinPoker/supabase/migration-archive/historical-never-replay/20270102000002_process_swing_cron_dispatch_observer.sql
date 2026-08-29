-- ============================================================================
-- P1 Dealer Swing: separate business dispatch from HTTP response observation.
--
-- The dispatcher must remain O(1): it reads the internal Vault secret, enqueues
-- one Edge request, and records the pg_net request id. Response collection runs
-- in a separate cron job with a small time/window/row budget. No object in the
-- internal `net` schema is altered by this migration.
--
-- ROLLBACK (controlled owner window only):
--   SELECT cron.unschedule('process-swing-observer');
--   Re-apply a reviewed dispatcher definition before removing the observer.
--   Do not restore the response scan inside run_process_swing_cron().
-- ============================================================================

BEGIN;

-- Old pending rows cannot be useful to the bounded observer and must not remain
-- ambiguous after rollout.
UPDATE public.process_swing_cron_runs
SET result_state = 'failed',
    error_code = 'timeout',
    response_observed_at = coalesce(response_observed_at, now())
WHERE result_state = 'pending'
  AND requested_at < now() - interval '2 minutes';

CREATE INDEX IF NOT EXISTS idx_process_swing_cron_runs_pending
  ON public.process_swing_cron_runs (requested_at, request_id)
  WHERE result_state = 'pending';

CREATE OR REPLACE FUNCTION public.run_process_swing_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  v_url := coalesce(
    nullif(current_setting('app.supabase_url', true), ''),
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
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
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

REVOKE ALL ON FUNCTION public.run_process_swing_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_process_swing_cron() TO service_role;

CREATE OR REPLACE FUNCTION public.observe_process_swing_cron(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
SET statement_timeout = '1s'
AS $$
DECLARE
  v_limit       integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_timed_out   integer := 0;
  v_observed    integer := 0;
BEGIN
  -- Expiration is independent of pg_net and uses the partial application index.
  WITH expired AS (
    SELECT id
    FROM public.process_swing_cron_runs
    WHERE result_state = 'pending'
      AND requested_at < now() - interval '2 minutes'
    ORDER BY requested_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.process_swing_cron_runs AS r
  SET result_state = 'failed',
      error_code = 'timeout',
      response_observed_at = now()
  FROM expired
  WHERE r.id = expired.id;
  GET DIAGNOSTICS v_timed_out = ROW_COUNT;

  -- Only recent, bounded pending ids are eligible. The created predicate lets
  -- pg_net use its existing `created` index; this migration never alters it.
  WITH pending AS MATERIALIZED (
    SELECT id, request_id
    FROM public.process_swing_cron_runs
    WHERE result_state = 'pending'
      AND requested_at >= now() - interval '10 minutes'
      AND request_id IS NOT NULL
    ORDER BY requested_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ), observed AS MATERIALIZED (
    SELECT
      pending.id,
      h.status_code,
      h.timed_out
    FROM pending
    JOIN net._http_response AS h
      ON h.id = pending.request_id
     AND h.created >= now() - interval '10 minutes'
  )
  UPDATE public.process_swing_cron_runs AS r
  SET response_status = observed.status_code,
      response_observed_at = now(),
      result_state = CASE
        WHEN observed.timed_out OR observed.status_code IS NULL THEN 'failed'
        WHEN observed.status_code BETWEEN 200 AND 299 THEN 'success'
        ELSE 'failed'
      END,
      error_code = CASE
        WHEN observed.timed_out OR observed.status_code IS NULL THEN 'timeout'
        WHEN observed.status_code = 401 THEN 'http_401'
        WHEN observed.status_code = 403 THEN 'http_403'
        WHEN observed.status_code BETWEEN 400 AND 499 THEN 'http_4xx'
        WHEN observed.status_code BETWEEN 500 AND 599 THEN 'http_5xx'
        WHEN observed.status_code BETWEEN 200 AND 299 THEN NULL
        ELSE 'http_non_2xx'
      END
  FROM observed
  WHERE r.id = observed.id;
  GET DIAGNOSTICS v_observed = ROW_COUNT;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'observed', v_observed,
    'timed_out', v_timed_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.observe_process_swing_cron(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observe_process_swing_cron(integer)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing') THEN
    PERFORM cron.unschedule('process-swing');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing-auto') THEN
    PERFORM cron.unschedule('process-swing-auto');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing-observer') THEN
    PERFORM cron.unschedule('process-swing-observer');
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-swing',
  '* * * * *',
  $$SELECT public.run_process_swing_cron();$$
);

SELECT cron.schedule(
  'process-swing-observer',
  '* * * * *',
  $$SELECT public.observe_process_swing_cron(100);$$
);

COMMIT;
