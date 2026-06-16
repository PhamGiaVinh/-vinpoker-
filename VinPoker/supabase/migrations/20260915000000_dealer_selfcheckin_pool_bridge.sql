-- ════════════════════════════════════════════════════════════════════════════
-- Dealer self check-in (ALL channels) → scheduled Dealer Swing pool entry
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  AUTHORED SOURCE ONLY — NOT APPLIED here. Live apply is OWNER-GATED (no
--     `supabase db push` / deploy_db=true). Idempotent (CREATE OR REPLACE).
--     Does NOT touch schema_migrations. Rollback block at the bottom.
--
-- PURPOSE. Unify the two divergent dealer self check-in paths (Dealer Mobile App
-- `dealer_check_in`, and Telegram `/checkin`) onto ONE canonical server path so a
-- dealer's POOL entry (and therefore the payroll clock) starts at the SCHEDULED
-- shift start, never at an early arrival.
--
--   pool_entry_at = greatest(scheduled_start_at, arrival_at)
--     • arrival 14:45 for a 15:00 shift  → enters the pool at 15:00 (cron sweep)
--     • arrival 15:10 (late) for 15:00   → enters the pool at 15:10 (RPC, now)
--     • never checked in                 → not auto-entered (floor manual still works)
--
-- WHY IT MATTERS. `dealer_attendance.check_in_time` drives `get_dealer_payroll`
-- hours; entering at 14:45 instead of 15:00 overpays. Here `check_in_time` is set
-- to the POOL/PAYROLL entry time, NOT the arrival time.
--
-- HARD BOUNDARY. `_enter_dealer_pool` is the ONLY place a `dealer_attendance` pool
-- row is created from a self check-in. It mirrors the floor's `doCheckin`
-- (DealerSwingTab.tsx): INSERT status='checked_in', current_state='available',
-- guarded by the existing partial unique index `idx_one_active_checkin_per_dealer`
-- (dealer_id, shift_date WHERE status='checked_in') + the no-overlap trigger. It
-- NEVER touches perform_swing / payroll / rotation logic.
--
-- GATING. A single-row global flag `dealer_selfcheckin_config.scheduled_pool_enabled`
-- (default FALSE). While FALSE: the app RPC behaves planner-only (no pool entry),
-- the Telegram bot keeps its old direct-insert path (see edge fn), the cron sweep
-- no-ops. Flip TRUE (Phase C) for the unified scheduled-pool behavior on all channels.

BEGIN;

-- ── Global single-row config (server-side kill-switch) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_selfcheckin_config (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  scheduled_pool_enabled boolean NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dealer_selfcheckin_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.dealer_selfcheckin_config ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: only service_role / SECURITY DEFINER functions read it.

CREATE OR REPLACE FUNCTION public._dealer_scheduled_pool_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT scheduled_pool_enabled FROM public.dealer_selfcheckin_config WHERE id), false);
$$;

-- ── Pool-entry helper — the ONLY place a pool row is created from self check-in ─
-- `p_check_in_time` = pool/payroll entry time, NOT arrival. Mirrors the floor's
-- doCheckin shape; shift_date uses UTC calendar date to match the floor + the
-- partial unique index idempotency key. Returns true if a row was inserted.
CREATE OR REPLACE FUNCTION public._enter_dealer_pool(
  p_dealer_id uuid, p_club_id uuid, p_check_in_time timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift_date date := (now() AT TIME ZONE 'UTC')::date;  -- matches floor toISOString() date
  v_shift_id   uuid;
BEGIN
  -- Idempotent: never create a second active row (floor manual / prior entry / race).
  IF EXISTS (SELECT 1 FROM public.dealer_attendance
             WHERE dealer_id = p_dealer_id AND shift_date = v_shift_date AND status = 'checked_in') THEN
    RETURN false;
  END IF;
  SELECT id INTO v_shift_id FROM public.dealer_shifts
    WHERE club_id = p_club_id ORDER BY start_time LIMIT 1;
  BEGIN
    INSERT INTO public.dealer_attendance (dealer_id, shift_id, shift_date, status, current_state, check_in_time)
    VALUES (p_dealer_id, v_shift_id, v_shift_date, 'checked_in', 'available', p_check_in_time);
  EXCEPTION WHEN unique_violation THEN
    RETURN false;  -- concurrent insert won the race (idx_one_active_checkin_per_dealer)
  END;
  RETURN true;
END;
$$;

-- ── Canonical core: record arrival, then enter-pool-now or leave pending ───────
-- Authorization is the CALLER's responsibility (auth.uid() for the app entry point,
-- telegram_user_id resolution for the bot entry point). Returns the rich result
-- consumed by both the app (useShiftActions) and Telegram (reply copy).
CREATE OR REPLACE FUNCTION public._dealer_record_checkin(p_assignment_id uuid, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club_id    uuid;
  v_dealer     uuid;
  v_status     text;
  v_start      timestamptz;
  v_checked_at timestamptz;
  v_opens_at   timestamptz;
  v_arrival    timestamptz;
  v_is_late    boolean;
  v_flag       boolean := public._dealer_scheduled_pool_enabled();
  v_pool_at    timestamptz;
  v_entered    boolean := false;
  v_pending    boolean := false;
  v_reason     text := NULL;
  v_already    boolean;
  v_shift_date date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT club_id, dealer_id, status, scheduled_start_at, checked_in_at
    INTO v_club_id, v_dealer, v_status, v_start, v_checked_at
  FROM public.dealer_shift_assignments WHERE id = p_assignment_id;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome','not_found');
  END IF;

  -- Window: cannot check in more than 30 min before scheduled start.
  v_opens_at := v_start - interval '30 minutes';
  IF now() < v_opens_at THEN
    RETURN jsonb_build_object('outcome','too_early',
      'window_opens_at', to_char(v_opens_at,'YYYY-MM-DD"T"HH24:MI:SSOF'));
  END IF;

  IF v_status = 'closed' THEN
    RETURN jsonb_build_object('outcome','invalid_state','status','closed');
  END IF;

  -- Record arrival (idempotent). First arrival published|confirmed -> checked_in.
  -- (Check-in implies confirmation; the app UI still guides confirm-first.)
  IF v_status = 'checked_in' THEN
    v_arrival := COALESCE(v_checked_at, now());
  ELSIF v_status IN ('published','confirmed') THEN
    v_arrival := now();
    v_is_late := now() > (v_start + interval '10 minutes');
    UPDATE public.dealer_shift_assignments
      SET status='checked_in', checked_in_at=now()
      WHERE id = p_assignment_id;
    INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
    VALUES (v_club_id, p_assignment_id, v_dealer, 'checked_in',
            jsonb_build_object('at', now(), 'late', v_is_late, 'source', p_source));
    IF v_is_late THEN
      INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
      VALUES (v_club_id, p_assignment_id, v_dealer, 'late',
              jsonb_build_object('at', now(), 'scheduled_start_at', v_start, 'source', p_source));
    END IF;
    INSERT INTO public.dealer_shift_audit_logs (club_id, assignment_id, actor, action, before, after)
    VALUES (v_club_id, p_assignment_id, auth.uid(), 'dealer_check_in',
            jsonb_build_object('status', v_status),
            jsonb_build_object('status','checked_in','source',p_source));
  ELSE
    RETURN jsonb_build_object('outcome','invalid_state','status',v_status);
  END IF;

  v_is_late := v_arrival > (v_start + interval '10 minutes');
  v_pool_at := GREATEST(v_start, v_arrival);

  -- Pool entry — only when the scheduled-pool feature is enabled.
  IF v_flag THEN
    SELECT EXISTS (SELECT 1 FROM public.dealer_attendance
                   WHERE dealer_id = v_dealer AND shift_date = v_shift_date AND status='checked_in')
      INTO v_already;
    IF v_already THEN
      v_reason := 'already_in_pool';
    ELSIF now() >= v_start THEN
      IF public._enter_dealer_pool(v_dealer, v_club_id, v_pool_at) THEN
        v_entered := true; v_reason := 'entered_now';
      ELSE
        v_reason := 'already_in_pool';
      END IF;
    ELSE
      v_pending := true; v_reason := 'early_arrival_pending';
    END IF;
  ELSE
    v_reason := 'flag_off';
  END IF;

  RETURN jsonb_build_object(
    'outcome','checked_in',
    'assignment_id', p_assignment_id,
    'checked_in_at', to_char(v_arrival,'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'scheduled_start_at', to_char(v_start,'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'pool_entry_at', to_char(v_pool_at,'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'entered_pool', v_entered,
    'pending_pool', v_pending,
    'pool_entry_reason', v_reason,
    'late', v_is_late
  );
END;
$$;

-- ── App entry point (authenticated; auth.uid() ownership guard) ────────────────
CREATE OR REPLACE FUNCTION public.dealer_check_in(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._dealer_owns_assignment(p_assignment_id) THEN
    RAISE EXCEPTION 'not authorized for assignment %', p_assignment_id;
  END IF;
  RETURN public._dealer_record_checkin(p_assignment_id, 'app_self_checkin');
END;
$$;

-- ── Telegram entry point (service-role only; the bot has no auth.uid()) ─────────
-- Resolves the dealer by telegram_user_id, finds today's assignment if not given,
-- verifies ownership, then runs the canonical core. NEVER inserts dealer_attendance
-- directly — it goes through _enter_dealer_pool like every other channel.
CREATE OR REPLACE FUNCTION public.dealer_self_checkin_by_telegram(
  p_telegram_user_id bigint, p_assignment_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dealer uuid;
  v_assign uuid := p_assignment_id;
BEGIN
  SELECT id INTO v_dealer FROM public.dealers
   WHERE telegram_user_id = p_telegram_user_id AND deleted_at IS NULL
   LIMIT 1;
  IF v_dealer IS NULL THEN
    RETURN jsonb_build_object('outcome','no_dealer');
  END IF;

  IF v_assign IS NULL THEN
    SELECT id INTO v_assign FROM public.dealer_shift_assignments
     WHERE dealer_id = v_dealer
       AND work_date = (now() AT TIME ZONE 'UTC')::date
       AND status IN ('published','confirmed','checked_in')
     ORDER BY scheduled_start_at
     LIMIT 1;
  ELSE
    PERFORM 1 FROM public.dealer_shift_assignments WHERE id = v_assign AND dealer_id = v_dealer;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome','not_authorized');
    END IF;
  END IF;

  IF v_assign IS NULL THEN
    RETURN jsonb_build_object('outcome','no_assignment');
  END IF;

  RETURN public._dealer_record_checkin(v_assign, 'telegram_self_checkin');
END;
$$;

-- ── Sweep: enter early arrivals into the pool at their scheduled start ──────────
-- Pure in-DB; runs as the cron owner. No-ops while the feature flag is off.
CREATE OR REPLACE FUNCTION public.bridge_shift_checkins_to_pool()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec   record;
  v_count integer := 0;
BEGIN
  IF NOT public._dealer_scheduled_pool_enabled() THEN
    RETURN 0;
  END IF;
  FOR v_rec IN
    SELECT a.dealer_id, a.club_id,
           GREATEST(a.scheduled_start_at, COALESCE(a.checked_in_at, a.scheduled_start_at)) AS pool_at
    FROM public.dealer_shift_assignments a
    WHERE a.status = 'checked_in'
      AND a.scheduled_start_at <= now()
      AND a.scheduled_start_at > now() - interval '12 hours'   -- recent only; no stale backfill
      AND NOT EXISTS (
        SELECT 1 FROM public.dealer_attendance da
        WHERE da.dealer_id = a.dealer_id
          AND da.shift_date = (now() AT TIME ZONE 'UTC')::date
          AND da.status = 'checked_in'
      )
  LOOP
    IF public._enter_dealer_pool(v_rec.dealer_id, v_rec.club_id, v_rec.pool_at) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── Schedule the sweep every minute (mirrors process-swing-auto) ───────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN PERFORM cron.unschedule('dealer-app-pool-bridge'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('dealer-app-pool-bridge', '* * * * *',
  $cron$ SELECT public.bridge_shift_checkins_to_pool(); $cron$);

-- ── Privileges ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._dealer_scheduled_pool_enabled()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._enter_dealer_pool(uuid, uuid, timestamptz)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dealer_record_checkin(uuid, text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bridge_shift_checkins_to_pool()                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dealer_self_checkin_by_telegram(bigint, uuid)          FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dealer_check_in(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_self_checkin_by_telegram(bigint, uuid)       TO service_role;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual; all objects additive/new except the dealer_check_in body,
-- which reverts to the version in 20260906000000):
--
-- BEGIN;
-- DO $$ BEGIN PERFORM cron.unschedule('dealer-app-pool-bridge'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- DROP FUNCTION IF EXISTS public.bridge_shift_checkins_to_pool();
-- DROP FUNCTION IF EXISTS public.dealer_self_checkin_by_telegram(bigint, uuid);
-- DROP FUNCTION IF EXISTS public._dealer_record_checkin(uuid, text);
-- DROP FUNCTION IF EXISTS public._enter_dealer_pool(uuid, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS public._dealer_scheduled_pool_enabled();
-- DROP TABLE IF EXISTS public.dealer_selfcheckin_config;
-- -- Re-apply dealer_check_in(uuid) body from 20260906000000_dealer_self_service_rpcs.sql
-- COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
