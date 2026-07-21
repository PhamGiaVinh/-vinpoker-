-- ============================================================================
-- 20270103000002_online_poker_idle_preflight.sql
--
-- Source-only performance hardening for online-poker cron callers. The 5-second
-- table-runner and 15-second timeout schedules are intentionally unchanged.
-- Each wrapper now proves work exists through an existing read-only RPC before
-- it reads Vault or enqueues pg_net HTTP.
--
-- Disabled/idle ticks return NULL and create no net._http_response row. Races
-- after preflight remain safe because the existing op_start_hand partial unique
-- index and op_submit_action CAS/idempotency guards remain authoritative.
--
-- OWNER-GATED APPLY. Do not apply autonomously.
--
-- ROLLBACK (owner-gated): recreate both wrapper functions from
-- 20260917000000_online_poker_runner_cron_vault.sql. Cron schedules do not need
-- to be changed for either apply or rollback.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.op_run_timeout_sweep()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preflight jsonb;
  v_url       text;
  v_secret    text;
  v_req       bigint;
BEGIN
  -- op_timeout_sweep() is read-only, op_is_enabled-gated, and returns only hands
  -- whose betting action deadline has already expired.
  v_preflight := public.op_timeout_sweep();
  IF COALESCE(v_preflight->>'outcome', 'disabled') <> 'ok'
     OR jsonb_typeof(v_preflight->'hands') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_preflight->'hands') = 0
  THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_url := current_setting('app.supabase_url', true);
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL;
  END;
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://orlesggcjamwuknxwcpk.supabase.co'; -- public URL, not a secret
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'op_timeout_sweep_secret';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'op_run_timeout_sweep: vault secret missing; skipping';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/online-poker-timeout-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) INTO v_req;

  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.op_run_table_runner()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preflight jsonb;
  v_url       text;
  v_secret    text;
  v_req       bigint;
BEGIN
  -- Limit 1 keeps the 5-second preflight cheap. The Edge runner still loads its
  -- normal batch after enqueue, so active-table throughput is unchanged.
  v_preflight := public.op_run_due_table_ticks(1);
  IF COALESCE(v_preflight->>'outcome', 'disabled') <> 'ok'
     OR jsonb_typeof(v_preflight->'tables') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_preflight->'tables') = 0
  THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_url := current_setting('app.supabase_url', true);
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL;
  END;
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://orlesggcjamwuknxwcpk.supabase.co'; -- public URL, not a secret
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'op_table_runner_secret';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'op_run_table_runner: vault secret missing; skipping';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/online-poker-table-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) INTO v_req;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.op_run_timeout_sweep()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_run_timeout_sweep()
  TO service_role;

REVOKE ALL ON FUNCTION public.op_run_table_runner()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_run_table_runner()
  TO service_role;

COMMIT;
