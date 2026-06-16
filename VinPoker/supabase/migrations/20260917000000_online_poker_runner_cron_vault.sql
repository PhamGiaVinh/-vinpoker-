-- ============================================================================
-- 20260917000000_online_poker_runner_cron_vault.sql
--
-- GE-2 Continuous-play infra — schedule BOTH online-poker cron callers
-- (timeout-sweep + table-runner) so an AFK player can't stall a table and so open
-- tables auto-deal the next hand. Each caller posts to its Edge function with a shared
-- Bearer secret; the Edge compares it to its own env secret (OP_*_SECRET).
--
-- SECRET SOURCE = SUPABASE VAULT (encrypted at rest), NOT a GUC.
--   Rationale: the original design (20260903000000) read the secret from the persistent
--   GUC `app.op_timeout_sweep_secret`. On this hosted instance the (non-superuser)
--   `postgres` role CANNOT set a persistent custom GUC — `ALTER DATABASE/ROLE SET app.*`
--   returns `42501 permission denied`, and `SET ROLE supabase_admin` is denied. Vault,
--   by contrast, is writable via `vault.create_secret()` and the postgres-owned
--   SECURITY DEFINER caller can read `vault.decrypted_secrets`. This migration therefore
--   SUPERSEDES 20260903000000's `op_run_timeout_sweep` with a body-equivalent version
--   whose ONLY change is the secret source (GUC → Vault), and adds the matching
--   `op_run_table_runner`. The Edge functions, the engine, and the runtime gate are
--   unchanged.
--
-- DARK / FAIL-SAFE: if the Vault secret is absent the caller logs + no-ops (RETURN NULL);
--   if the secret is present but the runtime is dark (`online_poker_config.enabled=false`)
--   each Edge returns `{"outcome":"disabled"}` and creates NOTHING. So scheduling these
--   crons while dark is a safe no-op loop. Depends on pg_net + pg_cron + supabase_vault.
--
-- SECURITY: each caller is SECURITY DEFINER + search_path=public, EXECUTE granted to
--   service_role only. The secret is used only for the Authorization header — never
--   returned, never logged (G1).
--
-- Secrets provisioned out-of-band (NOT in this file, never committed):
--   vault: op_timeout_sweep_secret, op_table_runner_secret
--   edge env: OP_TIMEOUT_SWEEP_SECRET, OP_TABLE_RUNNER_SECRET (same values)
--
-- ROLLBACK (manual):
--   SELECT cron.unschedule('op-timeout-sweep');
--   SELECT cron.unschedule('op-table-runner');
--   DROP FUNCTION IF EXISTS public.op_run_timeout_sweep();
--   DROP FUNCTION IF EXISTS public.op_run_table_runner();
--   DELETE FROM vault.secrets WHERE name IN ('op_timeout_sweep_secret','op_table_runner_secret');
-- ============================================================================

BEGIN;

-- ── timeout-sweep caller (Vault secret source) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.op_run_timeout_sweep()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text;
  v_secret text;
  v_req    bigint;
BEGIN
  BEGIN v_url := current_setting('app.supabase_url', TRUE); EXCEPTION WHEN OTHERS THEN v_url := NULL; END;
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://orlesggcjamwuknxwcpk.supabase.co'; -- public project URL (not a secret)
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'op_timeout_sweep_secret';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'op_run_timeout_sweep: vault secret op_timeout_sweep_secret not set — skipping (no-op)';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/online-poker-timeout-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) INTO v_req;
  RETURN v_req;
END;
$$;

-- ── table-runner caller (Vault secret source) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.op_run_table_runner()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text;
  v_secret text;
  v_req    bigint;
BEGIN
  BEGIN v_url := current_setting('app.supabase_url', TRUE); EXCEPTION WHEN OTHERS THEN v_url := NULL; END;
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://orlesggcjamwuknxwcpk.supabase.co'; -- public project URL (not a secret)
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'op_table_runner_secret';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'op_run_table_runner: vault secret op_table_runner_secret not set — skipping (no-op)';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/online-poker-table-runner',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_secret),
    body    := '{}'::jsonb,           -- defaults: dryRun=false, limit=50
    timeout_milliseconds := 5000
  ) INTO v_req;
  RETURN v_req;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.op_run_timeout_sweep() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_run_timeout_sweep() TO service_role;
REVOKE EXECUTE ON FUNCTION public.op_run_table_runner()  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_run_table_runner()  TO service_role;

-- ── schedule both crons (idempotent: unschedule-if-exists, then schedule) ────
DO $cron$
BEGIN
  -- timeout-sweep every 15s (poker act clock ~30s)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'op-timeout-sweep') THEN
    PERFORM cron.unschedule('op-timeout-sweep');
  END IF;
  PERFORM cron.schedule('op-timeout-sweep', '15 seconds', $job$SELECT public.op_run_timeout_sweep();$job$);

  -- table-runner every 5s (snappy next-hand deal; tunable)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'op-table-runner') THEN
    PERFORM cron.unschedule('op-table-runner');
  END IF;
  PERFORM cron.schedule('op-table-runner', '5 seconds', $job$SELECT public.op_run_table_runner();$job$);
END;
$cron$;

COMMIT;
