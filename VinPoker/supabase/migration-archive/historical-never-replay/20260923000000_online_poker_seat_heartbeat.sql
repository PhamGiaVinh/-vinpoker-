-- ============================================================================
-- 20260923000000_online_poker_seat_heartbeat.sql
--
-- Online poker — SEAT HEARTBEAT + STALE-SEAT REAPER (friends-practice model).
--
-- Problem: a player who closes the tab / loses connection leaves a GHOST seat.
-- Today nothing frees it: op_timeout_sweep only force-folds the actor-to-act on
-- their turn; it never vacates a dead seat or reassigns the host. So an abandoned
-- seat blocks others from sitting and can strand the host role.
--
-- Fix (additive, two new RPCs + one column + one cron — NO existing object changed):
--   * online_poker_seats.last_seen_at  — liveness timestamp, bumped by the client.
--   * op_heartbeat(table)              — caller pings ~every 10s while seated.
--   * op_reap_stale_seats(stale_secs)  — vacates seats whose heartbeat went stale,
--                                        reassigns host, runs from a 30s cron.
--
-- WHY THE REAPER IS PURE SQL (no engine, no edge, no pg_net/Vault): it only touches
-- seats that are NOT contesting a live hand. An absent player who IS in a live hand
-- is already handled by the existing online-poker-timeout-sweep edge (engine
-- forcedTimeoutAction on their turn). So the reaper safely handles only the
-- between-hands ghosts — a plain UPDATE + host reassign, schedulable as a direct
-- pg_cron SQL call.
--
-- SIT-RACE SAFETY: a freshly (re)claimed seat could carry an old last_seen_at (the
-- ON CONFLICT re-claim path in op_sit_open refreshes joined_at but not last_seen_at).
-- The reaper therefore requires BOTH last_seen_at AND joined_at to be stale, so a new
-- sitter is protected for the full stale window while the client's first heartbeat
-- (fired immediately on sitting, then every ~10s) refreshes last_seen_at. No change
-- to op_sit_open is needed.
--
-- SECURITY: SECURITY DEFINER + search_path=public, op_is_enabled()-gated. op_heartbeat
-- is auth.uid()-bound (authenticated + service_role; REVOKE anon/public). The reaper is
-- service_role ONLY (cron-invoked; REVOKE anon/public/authenticated).
--
-- ⚠️ SOURCE-ONLY — authored, **NOT applied**. Apply only via a controlled, owner-gated
-- Management-API operation (snapshot → apply → verify bodies/grants → rollback note).
-- Do NOT `supabase db push` / `deploy_db=true`. While online_poker_config.enabled is
-- false the cron + both RPCs are safe no-ops ("disabled"). DEPLOY ORDER: apply this
-- migration (dark) → deploy the client heartbeat (already in this PR) → enable the
-- runtime only for a test session. The client heartbeat degrades to a no-op until the
-- RPC exists, so shipping the frontend first is harmless.
--
-- ROLLBACK (manual):
--   SELECT cron.unschedule('op-reap-stale-seats');
--   DROP FUNCTION IF EXISTS public.op_reap_stale_seats(int);
--   DROP FUNCTION IF EXISTS public.op_heartbeat(uuid);
--   ALTER TABLE public.online_poker_seats DROP COLUMN IF EXISTS last_seen_at;
-- ============================================================================

BEGIN;

-- ── liveness column ─────────────────────────────────────────────────────────
-- Existing rows get now() so nothing is reaped immediately on apply (and the cron
-- is dark anyway until the runtime is enabled).
ALTER TABLE public.online_poker_seats
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- ── op_heartbeat ────────────────────────────────────────────────────────────
-- The seated caller pings to prove liveness. Bumps last_seen_at for their seat.
CREATE OR REPLACE FUNCTION public.op_heartbeat(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n   int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  UPDATE public.online_poker_seats
  SET last_seen_at = now()
  WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('outcome', CASE WHEN v_n > 0 THEN 'ok' ELSE 'not_seated' END);
END;
$$;

-- ── op_reap_stale_seats ─────────────────────────────────────────────────────
-- Vacate seats whose heartbeat went stale and that are NOT in a live hand; reassign
-- the host per affected table (lowest remaining seat_no, mirroring op_leave_open_table).
CREATE OR REPLACE FUNCTION public.op_reap_stale_seats(p_stale_secs int DEFAULT 45)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reaped   int := 0;
  v_seat     record;
  v_host     uuid;
  v_new_host uuid;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled', 'reaped', 0);
  END IF;
  -- Floor the window so a misconfig can never reap fresh seats.
  IF p_stale_secs IS NULL OR p_stale_secs < 15 THEN p_stale_secs := 15; END IF;

  FOR v_seat IN
    SELECT s.id, s.table_id, s.seat_no, s.user_id
    FROM public.online_poker_seats s
    WHERE s.status IN ('sitting', 'sitting_out')
      AND s.user_id IS NOT NULL
      AND s.last_seen_at < now() - make_interval(secs => p_stale_secs)
      -- sit-race guard: a freshly (re)claimed seat keeps a fresh joined_at even if its
      -- last_seen_at is old, so require BOTH to be stale.
      AND s.joined_at    < now() - make_interval(secs => p_stale_secs)
      -- not contesting a live hand (those are force-folded by the timeout-sweep)
      AND NOT EXISTS (
        SELECT 1 FROM public.online_poker_hands h
        JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
        WHERE h.table_id = s.table_id AND h.status IN ('dealing', 'betting')
          AND hs.seat_no = s.seat_no AND hs.status IN ('active', 'allin')
      )
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.online_poker_seats
    SET user_id = NULL, stack = 0, status = 'empty'
    WHERE id = v_seat.id;
    v_reaped := v_reaped + 1;

    -- Reassign the host if we just removed this table's host.
    SELECT host_user_id INTO v_host FROM public.online_poker_tables
    WHERE id = v_seat.table_id FOR UPDATE;
    IF v_host = v_seat.user_id THEN
      SELECT user_id INTO v_new_host FROM public.online_poker_seats
      WHERE table_id = v_seat.table_id AND user_id IS NOT NULL AND status IN ('sitting', 'sitting_out')
      ORDER BY seat_no ASC LIMIT 1;
      UPDATE public.online_poker_tables SET host_user_id = v_new_host WHERE id = v_seat.table_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('outcome', 'ok', 'reaped', v_reaped);
END;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.op_heartbeat(uuid)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.op_heartbeat(uuid)            TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.op_reap_stale_seats(int)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_reap_stale_seats(int)      TO service_role;

-- ── cron: reap every 30s (direct SQL call — no edge/pg_net needed) ───────────
-- Idempotent: replace if already scheduled. Safe no-op while the runtime is dark.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'op-reap-stale-seats') THEN
    PERFORM cron.unschedule('op-reap-stale-seats');
  END IF;
  -- pg_cron sub-minute interval; if unsupported on the instance, use '* * * * *'.
  PERFORM cron.schedule('op-reap-stale-seats', '30 seconds', $job$SELECT public.op_reap_stale_seats();$job$);
END;
$cron$;

COMMIT;
