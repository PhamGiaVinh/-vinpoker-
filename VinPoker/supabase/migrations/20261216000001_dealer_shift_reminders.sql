-- ════════════════════════════════════════════════════════════════════════════
-- Dealer Shift Planner — automated pre-shift reminders (Telegram + OneSignal push)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  AUTHORED SOURCE ONLY — NOT APPLIED here. Live apply is OWNER-GATED (no
--     `supabase db push` / deploy_db=true). Idempotent (CREATE OR REPLACE /
--     CREATE TABLE IF NOT EXISTS). Does NOT touch schema_migrations.
--     Rollback block at the bottom.
--
-- PURPOSE. Owner request 2026-07-04: "làm phần nhắc ca tự động, chuẩn bị kết
-- nối với OneSignal sẵn". A dealer with a published/confirmed shift gets an
-- automatic reminder shortly before it starts, on BOTH channels (Telegram DM +
-- OneSignal push). A second, optional pass nudges a dealer who has not yet
-- confirmed a published shift.
--
-- SECRET SOURCE = SUPABASE VAULT (mirrors 20260917000000's online-poker cron
-- pattern) — the cron caller reads `vault.decrypted_secrets`, NOT a GUC (this
-- hosted instance's postgres role cannot set a persistent custom GUC).
--
-- DARK / FAIL-SAFE (three independent gates, ALL must be true to send anything):
--   1. Vault secret `dealer_shift_reminders_secret` absent  → caller logs + no-ops.
--   2. `dealer_shift_reminder_config.enabled = false` (DEFAULT) → edge fn returns
--      {skipped:true} and writes nothing.
--   3. No due assignment in the window → nothing to send.
-- So merging this migration + scheduling the cron is a safe no-op until the
-- owner deliberately sets the vault secret AND flips `enabled = true`.
--
-- SCOPE. Reads ONLY dealer_shift_assignments (planner layer), dealers
-- (telegram_user_id/user_id), the new config + dedup ledger below. NEVER reads
-- or writes dealer_attendance / dealer_assignments / swing_* / payroll /
-- dealer_shift_events (the payroll-bridge queue — reserved, not this feature's
-- concern).
--
-- SECURITY. The cron caller is SECURITY DEFINER + search_path=public, EXECUTE
-- granted to service_role only. The vault secret is used only for the
-- Authorization header sent to the edge function — never returned, never
-- logged. Both new tables: RLS enabled, NO policy (service-role /
-- SECURITY DEFINER access only — mirrors dealer_selfcheckin_config).
--
-- Secrets provisioned out-of-band (NOT in this file, never committed):
--   vault: dealer_shift_reminders_secret
--   edge env: SHIFT_REMINDERS_SECRET (same value), plus the already-live
--             TELEGRAM_BOT_TOKEN / ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY.
--
-- ROLLBACK (manual):
--   SELECT cron.unschedule('dealer-shift-reminders');
--   DROP FUNCTION IF EXISTS public.run_dealer_shift_reminders();
--   DROP TABLE IF EXISTS public.dealer_shift_notifications;
--   DROP TABLE IF EXISTS public.dealer_shift_reminder_config;
--   DELETE FROM vault.secrets WHERE name = 'dealer_shift_reminders_secret';
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Single-row config (server-side kill-switch, mirrors dealer_selfcheckin_config) ──
CREATE TABLE IF NOT EXISTS public.dealer_shift_reminder_config (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled               boolean NOT NULL DEFAULT false,
  pre_shift_minutes     integer NOT NULL DEFAULT 60 CHECK (pre_shift_minutes > 0),
  confirm_nudge_enabled boolean NOT NULL DEFAULT false,
  confirm_nudge_hours   integer NOT NULL DEFAULT 3 CHECK (confirm_nudge_hours > 0),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dealer_shift_reminder_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.dealer_shift_reminder_config ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: only service_role / SECURITY DEFINER functions read it.

-- ── Dedup ledger — one row per (assignment, kind, channel) actually sent ────────
-- Prevents double-sends across cron ticks (5-min cadence vs a wide send window).
CREATE TABLE IF NOT EXISTS public.dealer_shift_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.dealer_shift_assignments(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('pre_shift', 'confirm_nudge')),
  channel       text NOT NULL CHECK (channel IN ('telegram', 'push')),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shift_notification UNIQUE (assignment_id, kind, channel)
);
CREATE INDEX IF NOT EXISTS idx_shift_notifications_assignment
  ON public.dealer_shift_notifications (assignment_id);
ALTER TABLE public.dealer_shift_notifications ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: only service_role (the edge fn's admin client) writes/reads it.

-- ── Cron → Edge caller (Vault secret source, mirrors op_run_timeout_sweep) ──────
CREATE OR REPLACE FUNCTION public.run_dealer_shift_reminders()
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
  FROM vault.decrypted_secrets WHERE name = 'dealer_shift_reminders_secret';
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'run_dealer_shift_reminders: vault secret dealer_shift_reminders_secret not set — skipping (no-op)';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-shift-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  ) INTO v_req;
  RETURN v_req;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_dealer_shift_reminders() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_dealer_shift_reminders() TO service_role;

-- ── Schedule the cron (idempotent: unschedule-if-exists, then schedule) ─────────
-- 5-minute cadence: fine enough to catch a 60-min pre-shift window without
-- spamming, matches the 5-min cadence already used for the online-poker crons.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dealer-shift-reminders') THEN
    PERFORM cron.unschedule('dealer-shift-reminders');
  END IF;
  PERFORM cron.schedule('dealer-shift-reminders', '5 minutes', $job$SELECT public.run_dealer_shift_reminders();$job$);
END;
$cron$;

COMMIT;
