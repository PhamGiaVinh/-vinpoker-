-- ============================================================================
-- 20260717000001_process_swing_cron_vault_caller.sql
--
-- P1 fix: the live process-swing cron used a public credential after the Edge
-- auth guard was hardened. This migration replaces that caller with a dedicated
-- internal-secret path. The secret is provisioned out-of-band in both places:
--
--   Vault secret name: PROCESS_SWING_INTERNAL_SECRET
--   Edge secret name:  PROCESS_SWING_INTERNAL_SECRET
--
-- The values must match, but no value belongs in source, migration, logs, or PR.
-- Missing/empty Vault secret is a safe no-op and is recorded as a failure. The
-- caller never falls back to a public token or to the service-role key.
--
-- Observability: pg_net returns a request id when a request is enqueued, not
-- when the Edge function succeeds. Each tick finalizes prior request ids from
-- net._http_response and records only status/error class, never response bodies,
-- headers, or credentials.
--
-- ROLLBACK (controlled, before re-enabling a known-good caller):
--   SELECT cron.unschedule('process-swing');
--   DROP FUNCTION IF EXISTS public.run_process_swing_cron();
--   DROP TABLE IF EXISTS public.process_swing_cron_runs;
-- Re-apply the reviewed prior cron definition only after its auth contract is
-- verified. Do not restore the old public credential.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.process_swing_cron_runs (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id            bigint UNIQUE,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  enqueue_state         text NOT NULL CHECK (enqueue_state IN (
                           'enqueued', 'skipped_secret_missing', 'enqueue_error'
                         )),
  response_status       integer,
  response_observed_at  timestamptz,
  result_state          text CHECK (result_state IS NULL OR result_state IN (
                           'pending', 'success', 'failed'
                         )),
  error_code            text CHECK (error_code IS NULL OR error_code IN (
                           'vault_secret_missing',
                           'enqueue_no_request_id',
                           'enqueue_exception',
                           'http_401',
                           'http_403',
                           'http_4xx',
                           'http_5xx',
                           'http_non_2xx',
                           'timeout'
                         ))
);

CREATE INDEX IF NOT EXISTS idx_process_swing_cron_runs_requested
  ON public.process_swing_cron_runs (requested_at DESC);

ALTER TABLE public.process_swing_cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.process_swing_cron_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.process_swing_cron_runs TO service_role;

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
BEGIN
  -- Finalize prior asynchronous requests. Only status and a fixed error class
  -- are persisted; response body and headers are deliberately discarded.
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

REVOKE ALL ON FUNCTION public.run_process_swing_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_process_swing_cron() TO service_role;

-- Replace both historical names idempotently, then install one canonical job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing') THEN
    PERFORM cron.unschedule('process-swing');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing-auto') THEN
    PERFORM cron.unschedule('process-swing-auto');
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-swing',
  '* * * * *',
  $$SELECT public.run_process_swing_cron();$$
);

COMMIT;
