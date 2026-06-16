-- ════════════════════════════════════════════════════════════════════════════
-- Dealer Mobile App — Migration A: dealer self-service RPCs (roster-only)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  AUTHORED SOURCE ONLY — NOT APPLIED in this session. Live apply is
--     OWNER-GATED (no `supabase db push` / deploy_db=true here). Idempotent
--     (CREATE OR REPLACE). Does NOT touch schema_migrations or the pending risky
--     chain. Apply later via a controlled owner-gated op (Supabase SQL Editor /
--     direct SQL). Rollback: DROP block at the bottom.
--
-- PURPOSE. These RPCs let a *dealer* drive the lifecycle of their OWN shift on the
-- additive Shift Planner V2.1 layer (`dealer_shift_assignments`) — confirm,
-- ROSTER check-in / check-out, and submit availability / leave wishes. They are
-- the write side of the Dealer Mobile App (/dealer/*).
--
-- HARD SAFETY BOUNDARY (CLAUDE.md). This module is ADDITIVE and PLANNER-ONLY. It
-- MUST NEVER read or write the protected live Dealer Swing system:
--   dealer_attendance · dealer_assignments · dealer_rotation_schedule · swing_* ·
--   any *payroll* table/RPC.
-- Payroll later CONSUMES `dealer_shift_events` (a queue) — these RPCs only enqueue
-- events; they never cross-write swing/attendance/payroll. Builds on
-- 20260827000000 (tables + publish_shift_run / close_shift_assignment) and
-- 20260831000000 (save_shift_run).
--
-- SECURITY MODEL.
--   • Every function is SECURITY DEFINER + `SET search_path = public`.
--   • Actor is bound to `auth.uid()` via `dealers.user_id` (a dealer can only act
--     on their OWN assignment / their OWN membership). DEFINER bypasses RLS, so
--     authorization is enforced INTERNALLY (never relies on RLS).
--   • Authorization failures RAISE (loud). State / window problems return a jsonb
--     outcome code (mirrors close_shift_assignment's {outcome:'not_found'} style).
--   • Each function: REVOKE ALL FROM PUBLIC, anon;  GRANT EXECUTE TO authenticated.
--
-- WINDOW MATH (must mirror the client constants in src/lib/dealerApp/constants.ts):
--   CHECKIN_OPEN_BEFORE_MIN = 30  → window opens at scheduled_start − 30 min
--   CHECKIN_LATE_AFTER_MIN  = 10  → check-in flagged 'late' after scheduled_start + 10 min
-- Operates on absolute timestamptz, so overnight (18:00→02:00) shifts are correct.

BEGIN;

-- ── Guard helper: does the current auth user own this assignment? ──────────────
-- STABLE + DEFINER. Returns true only when the assignment's dealer row is linked
-- to auth.uid(). Used by all three shift-lifecycle RPCs below.
CREATE OR REPLACE FUNCTION public._dealer_owns_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dealer_shift_assignments a
    JOIN public.dealers d ON d.id = a.dealer_id
    WHERE a.id = p_assignment_id
      AND d.user_id = auth.uid()
  );
$$;

-- ── Guard helper: does the current auth user own this dealer membership? ───────
CREATE OR REPLACE FUNCTION public._dealer_user_owns(p_dealer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dealers d
    WHERE d.id = p_dealer_id AND d.user_id = auth.uid()
  );
$$;

-- ── 1. Confirm shift: published → confirmed (NO event type 'confirmed' exists in
--       dealer_shift_events' CHECK, so we record an audit row only) ─────────────
CREATE OR REPLACE FUNCTION public.dealer_confirm_shift(p_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
  v_dealer  uuid;
  v_status  text;
BEGIN
  IF NOT public._dealer_owns_assignment(p_assignment_id) THEN
    RAISE EXCEPTION 'not authorized for assignment %', p_assignment_id;
  END IF;

  SELECT club_id, dealer_id, status INTO v_club_id, v_dealer, v_status
  FROM public.dealer_shift_assignments WHERE id = p_assignment_id;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Idempotent: already confirmed (or further along) is a no-op success.
  IF v_status = 'confirmed' THEN
    RETURN jsonb_build_object('outcome', 'confirmed', 'idempotent', true);
  END IF;
  IF v_status <> 'published' THEN
    RETURN jsonb_build_object('outcome', 'invalid_state', 'status', v_status);
  END IF;

  UPDATE public.dealer_shift_assignments
    SET status = 'confirmed'
    WHERE id = p_assignment_id;

  INSERT INTO public.dealer_shift_audit_logs (club_id, assignment_id, actor, action, before, after)
  VALUES (v_club_id, p_assignment_id, auth.uid(), 'dealer_confirm_shift',
          jsonb_build_object('status', v_status),
          jsonb_build_object('status', 'confirmed'));

  RETURN jsonb_build_object('outcome', 'confirmed', 'assignment_id', p_assignment_id);
END;
$$;

-- ── 2. Check-in: confirmed → checked_in (server-enforce the 30-min open window;
--       flag 'late' past start+10m). Emits checked_in [+ late] events. ──────────
CREATE OR REPLACE FUNCTION public.dealer_check_in(p_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id  uuid;
  v_dealer   uuid;
  v_status   text;
  v_start    timestamptz;
  v_opens_at timestamptz;
  v_is_late  boolean;
BEGIN
  IF NOT public._dealer_owns_assignment(p_assignment_id) THEN
    RAISE EXCEPTION 'not authorized for assignment %', p_assignment_id;
  END IF;

  SELECT club_id, dealer_id, status, scheduled_start_at
    INTO v_club_id, v_dealer, v_status, v_start
  FROM public.dealer_shift_assignments WHERE id = p_assignment_id;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Idempotent: already checked in.
  IF v_status = 'checked_in' THEN
    RETURN jsonb_build_object('outcome', 'checked_in', 'idempotent', true);
  END IF;
  IF v_status <> 'confirmed' THEN
    -- e.g. still 'published' (must confirm first) or already 'closed'.
    RETURN jsonb_build_object('outcome', 'invalid_state', 'status', v_status);
  END IF;

  -- Server-side window enforcement (mirror client: open 30m before start).
  v_opens_at := v_start - interval '30 minutes';
  IF now() < v_opens_at THEN
    RETURN jsonb_build_object('outcome', 'too_early',
                              'window_opens_at', to_char(v_opens_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  END IF;

  v_is_late := now() > (v_start + interval '10 minutes');

  UPDATE public.dealer_shift_assignments
    SET status = 'checked_in', checked_in_at = now()
    WHERE id = p_assignment_id;

  INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
  VALUES (v_club_id, p_assignment_id, v_dealer, 'checked_in',
          jsonb_build_object('at', now(), 'late', v_is_late));
  IF v_is_late THEN
    INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
    VALUES (v_club_id, p_assignment_id, v_dealer, 'late',
            jsonb_build_object('at', now(), 'scheduled_start_at', v_start));
  END IF;

  INSERT INTO public.dealer_shift_audit_logs (club_id, assignment_id, actor, action, before, after)
  VALUES (v_club_id, p_assignment_id, auth.uid(), 'dealer_check_in',
          jsonb_build_object('status', v_status),
          jsonb_build_object('status', 'checked_in', 'late', v_is_late));

  RETURN jsonb_build_object('outcome', 'checked_in', 'late', v_is_late, 'assignment_id', p_assignment_id);
END;
$$;

-- ── 3. Check-out: checked_in → closed. Emits checked_out + shift_closed. ───────
CREATE OR REPLACE FUNCTION public.dealer_check_out(p_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
  v_dealer  uuid;
  v_status  text;
BEGIN
  IF NOT public._dealer_owns_assignment(p_assignment_id) THEN
    RAISE EXCEPTION 'not authorized for assignment %', p_assignment_id;
  END IF;

  SELECT club_id, dealer_id, status INTO v_club_id, v_dealer, v_status
  FROM public.dealer_shift_assignments WHERE id = p_assignment_id;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_status = 'closed' THEN
    RETURN jsonb_build_object('outcome', 'closed', 'idempotent', true);
  END IF;
  IF v_status <> 'checked_in' THEN
    RETURN jsonb_build_object('outcome', 'invalid_state', 'status', v_status);
  END IF;

  UPDATE public.dealer_shift_assignments
    SET status = 'closed', checked_out_at = now()
    WHERE id = p_assignment_id;

  INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
  VALUES
    (v_club_id, p_assignment_id, v_dealer, 'checked_out', jsonb_build_object('at', now())),
    (v_club_id, p_assignment_id, v_dealer, 'shift_closed', jsonb_build_object('at', now()));

  INSERT INTO public.dealer_shift_audit_logs (club_id, assignment_id, actor, action, before, after)
  VALUES (v_club_id, p_assignment_id, auth.uid(), 'dealer_check_out',
          jsonb_build_object('status', v_status),
          jsonb_build_object('status', 'closed'));

  RETURN jsonb_build_object('outcome', 'closed', 'assignment_id', p_assignment_id);
END;
$$;

-- ── 4. Submit availability wish (preferred / available) for a work date ────────
-- Upsert-by-(dealer,date): replaces the dealer's prior *submitted* wish for that
-- date so resubmitting doesn't spam rows; acknowledged/rejected history is kept.
CREATE OR REPLACE FUNCTION public.dealer_submit_availability(
  p_dealer_id   uuid,
  p_work_date   date,
  p_kind        text,
  p_template_id uuid DEFAULT NULL,
  p_note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
  v_id      uuid;
BEGIN
  IF NOT public._dealer_user_owns(p_dealer_id) THEN
    RAISE EXCEPTION 'not authorized for dealer %', p_dealer_id;
  END IF;
  IF p_kind NOT IN ('preferred','available') THEN
    RETURN jsonb_build_object('outcome', 'invalid_kind', 'kind', p_kind);
  END IF;

  SELECT club_id INTO v_club_id FROM public.dealers WHERE id = p_dealer_id;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  UPDATE public.dealer_availability_requests
    SET kind = p_kind, template_id = p_template_id, note = p_note
    WHERE dealer_id = p_dealer_id AND work_date = p_work_date AND status = 'submitted'
    RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.dealer_availability_requests
      (club_id, dealer_id, work_date, kind, template_id, note, status)
    VALUES (v_club_id, p_dealer_id, p_work_date, p_kind, p_template_id, p_note, 'submitted')
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('outcome', 'submitted', 'request_id', v_id, 'kind', p_kind);
END;
$$;

-- ── 5. Request leave / unavailable for a work date ─────────────────────────────
-- Phase-1 reuses dealer_availability_requests (kind = leave | unavailable); no new
-- swap table. Same upsert-by-(dealer,date) semantics.
CREATE OR REPLACE FUNCTION public.dealer_request_leave_or_swap(
  p_dealer_id uuid,
  p_work_date date,
  p_kind      text DEFAULT 'leave',
  p_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
  v_id      uuid;
BEGIN
  IF NOT public._dealer_user_owns(p_dealer_id) THEN
    RAISE EXCEPTION 'not authorized for dealer %', p_dealer_id;
  END IF;
  IF p_kind NOT IN ('leave','unavailable') THEN
    RETURN jsonb_build_object('outcome', 'invalid_kind', 'kind', p_kind);
  END IF;

  SELECT club_id INTO v_club_id FROM public.dealers WHERE id = p_dealer_id;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  UPDATE public.dealer_availability_requests
    SET kind = p_kind, note = p_note, template_id = NULL
    WHERE dealer_id = p_dealer_id AND work_date = p_work_date AND status = 'submitted'
    RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.dealer_availability_requests
      (club_id, dealer_id, work_date, kind, note, status)
    VALUES (v_club_id, p_dealer_id, p_work_date, p_kind, p_note, 'submitted')
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('outcome', 'requested', 'request_id', v_id, 'kind', p_kind);
END;
$$;

-- ── Privileges: authenticated only (never anon / PUBLIC) ───────────────────────
REVOKE ALL ON FUNCTION public._dealer_owns_assignment(uuid)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dealer_user_owns(uuid)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dealer_confirm_shift(uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dealer_check_in(uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dealer_check_out(uuid)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dealer_submit_availability(uuid, date, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dealer_request_leave_or_swap(uuid, date, text, text)     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._dealer_owns_assignment(uuid)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public._dealer_user_owns(uuid)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_confirm_shift(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_check_in(uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_check_out(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_submit_availability(uuid, date, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dealer_request_leave_or_swap(uuid, date, text, text)     TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual; all objects are additive/new):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.dealer_request_leave_or_swap(uuid, date, text, text);
-- DROP FUNCTION IF EXISTS public.dealer_submit_availability(uuid, date, text, uuid, text);
-- DROP FUNCTION IF EXISTS public.dealer_check_out(uuid);
-- DROP FUNCTION IF EXISTS public.dealer_check_in(uuid);
-- DROP FUNCTION IF EXISTS public.dealer_confirm_shift(uuid);
-- DROP FUNCTION IF EXISTS public._dealer_user_owns(uuid);
-- DROP FUNCTION IF EXISTS public._dealer_owns_assignment(uuid);
-- COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
