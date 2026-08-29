-- ============================================================================
-- 20260903000000_online_poker_timeout_sweep_cron.sql
--
-- PR C — timeout-sweep hardening (the cron half). Schedules a periodic call to the
-- `online-poker-timeout-sweep` Edge function so an AFK / disconnected player cannot
-- stall a table. The Edge function runs the engine's forcedTimeoutAction for every
-- hand past its act_deadline and routes it through op_submit_action (CAS + idempotent).
--
-- SOURCE-ONLY (PR C): authored, **NOT applied**. Apply only at the owner-gated
-- Phase D, AFTER: (a) the Edge function `online-poker-timeout-sweep` is deployed
-- (--no-verify-jwt) with env OP_TIMEOUT_SWEEP_SECRET set, and (b) the matching DB GUC
-- `app.op_timeout_sweep_secret` is set to the SAME value, and (c) online_poker_config
-- .enabled is true. While the secret GUC is unset the cron is a safe no-op; while the
-- runtime is dark the Edge returns "disabled".
--
-- Secret handling: the function secret is read from a GUC (current_setting), NEVER
-- hardcoded here (mirrors 20260609000018_notify_dealer_ready_v2). The project URL is
-- public. Depends on pg_net (20260609000015) + pg_cron (already enabled).
--
-- ROLLBACK (manual):
--   SELECT cron.unschedule('op-timeout-sweep');
--   DROP FUNCTION IF EXISTS public.op_run_timeout_sweep();
-- ============================================================================

BEGIN;

-- Caller for the sweep edge function. Secret from app.op_timeout_sweep_secret GUC;
-- if unset, it logs + no-ops (safe before the owner provisions the secret).
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

  BEGIN v_secret := current_setting('app.op_timeout_sweep_secret', TRUE); EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'op_run_timeout_sweep: GUC app.op_timeout_sweep_secret not set — skipping (no-op)';
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

REVOKE EXECUTE ON FUNCTION public.op_run_timeout_sweep() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_run_timeout_sweep() TO service_role;

-- Schedule every 15s (poker act clock is ~30s). Idempotent: replace if already set.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'op-timeout-sweep') THEN
    PERFORM cron.unschedule('op-timeout-sweep');
  END IF;
  -- pg_cron sub-minute interval syntax; if unsupported on the instance, use '* * * * *'.
  PERFORM cron.schedule('op-timeout-sweep', '15 seconds', $job$SELECT public.op_run_timeout_sweep();$job$);
END;
$cron$;

COMMIT;
