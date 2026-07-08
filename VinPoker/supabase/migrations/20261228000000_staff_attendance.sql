-- ═══════════════════════════════════════════════════════════════════════════════
-- Staff Attendance (Bước A) — app-based self check-in/out for NON-dealer staff.
-- SOURCE-ONLY: NOT applied live. DEPENDS ON 20261227000000_staff_directory.sql.
--
-- Apply is a SEPARATE owner-gated controlled op (apply 20261227000000 FIRST + verify,
-- THEN this). NO `supabase db push`, NO deploy_db, NO schema_migrations edit here.
--
-- WHY: staff (floor/cashier/tracker/service/security) clock their hours from the /staff
-- portal with a single check-in / check-out button, mirroring how dealers record
-- attendance — but in a SEPARATE table. This isolation is LOAD-BEARING: if staff check-ins
-- ever wrote into `dealer_attendance` they would re-trigger the pool-poisoning bug that
-- 20260721000000_cleanup_stale_attendance.sql fixed (stale rows falsely mark dealers busy
-- in pickNextDealer.ts). staff_attendance touches ZERO dealer objects.
--
-- WHAT (additive, idempotent):
--   1. public.staff_attendance table + RLS + one-active-checkin partial unique index.
--   2. public.staff_check_in(p_staff_id)  — SELF-owned (staff.user_id=auth.uid()), idempotent.
--   3. public.staff_check_out(p_staff_id) — SELF-owned, sets checkout + 24h-capped minutes.
--   4. public.staff_cleanup_stale_attendance(hours) — service_role, cron
--      'cleanup-stale-staff-attendance' (a DISTINCT job name — never the dealer cron).
--
-- Self actions bind auth.uid() via staff.user_id; p_staff_id only disambiguates multi-club.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Attendance table (clock-relevant subset of dealer_attendance; no Swing internals) ──
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id                   uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  shift_date                 date NOT NULL DEFAULT CURRENT_DATE,   -- DB tz = Asia/Ho_Chi_Minh → VN date
  check_in_time              timestamptz NOT NULL DEFAULT now(),
  check_out_time             timestamptz,
  status                     text NOT NULL DEFAULT 'checked_in'
                               CHECK (status IN ('checked_in', 'checked_out')),
  total_worked_minutes_today integer,              -- set on checkout, 24h-capped
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_att_staff_date ON public.staff_attendance (staff_id, shift_date);
-- Exactly one open check-in per staff at a time (idempotency + anti-zombie guard).
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_staff_checkin
  ON public.staff_attendance (staff_id)
  WHERE status = 'checked_in' AND check_out_time IS NULL;

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_attendance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_attendance TO authenticated;

-- Operator read: super_admin / club_admin / club owner / club cashier of the staff row's club.
DROP POLICY IF EXISTS staff_att_select_operator ON public.staff_attendance;
CREATE POLICY staff_att_select_operator ON public.staff_attendance
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.staff s
               JOIN public.clubs c ON c.id = s.club_id
               WHERE s.id = staff_attendance.staff_id AND c.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.staff s
               JOIN public.club_cashiers cc ON cc.club_id = s.club_id
               WHERE s.id = staff_attendance.staff_id AND cc.user_id = auth.uid())
  );

-- Staff self read: own attendance via staff.user_id = auth.uid().
DROP POLICY IF EXISTS staff_att_select_self ON public.staff_attendance;
CREATE POLICY staff_att_select_self ON public.staff_attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.staff s
            WHERE s.id = staff_attendance.staff_id AND s.user_id = auth.uid())
  );

-- NO INSERT/UPDATE/DELETE policy → writes only via the SECURITY DEFINER RPCs below.

-- ── 2. staff_check_in — self-owned, idempotent ───────────────────────────────
-- Ownership binds auth.uid(): the caller must own p_staff_id (staff.user_id = auth.uid()).
-- p_staff_id only disambiguates which club's staff row (a person may be staff at several).
-- Idempotent: an existing open shift is returned as-is; a race that trips the partial unique
-- index is caught and the existing open row returned.
CREATE OR REPLACE FUNCTION public.staff_check_in(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_open record;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                 WHERE s.id = p_staff_id AND s.user_id = v_uid
                   AND s.deleted_at IS NULL AND s.status = 'active') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Already checked in → return the open shift (idempotent).
  SELECT * INTO v_open FROM public.staff_attendance
  WHERE staff_id = p_staff_id AND status = 'checked_in' AND check_out_time IS NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'already_checked_in', 'attendance_id', v_open.id,
                              'check_in_time', v_open.check_in_time);
  END IF;

  BEGIN
    INSERT INTO public.staff_attendance (staff_id, shift_date, check_in_time, status)
    VALUES (p_staff_id, CURRENT_DATE, now(), 'checked_in')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent check-in won the race → return that open row.
    SELECT id INTO v_id FROM public.staff_attendance
    WHERE staff_id = p_staff_id AND status = 'checked_in' AND check_out_time IS NULL
    LIMIT 1;
    RETURN jsonb_build_object('outcome', 'already_checked_in', 'attendance_id', v_id);
  END;

  RETURN jsonb_build_object('outcome', 'checked_in', 'attendance_id', v_id, 'check_in_time', now());
END;
$$;
REVOKE ALL ON FUNCTION public.staff_check_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_check_in(uuid) TO authenticated;

-- ── 3. staff_check_out — self-owned, 24h-capped ──────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_check_out(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_open    record;
  v_minutes integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                 WHERE s.id = p_staff_id AND s.user_id = v_uid AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO v_open FROM public.staff_attendance
  WHERE staff_id = p_staff_id AND status = 'checked_in' AND check_out_time IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_open_shift');
  END IF;

  -- 24h/shift cap (parity with the PT-wage live-wage cap) to bound a forgotten checkout.
  v_minutes := LEAST(1440, GREATEST(0, EXTRACT(EPOCH FROM (now() - v_open.check_in_time)) / 60.0))::int;

  UPDATE public.staff_attendance SET
    status                     = 'checked_out',
    check_out_time             = now(),
    total_worked_minutes_today = v_minutes,
    updated_at                 = now()
  WHERE id = v_open.id;

  RETURN jsonb_build_object('outcome', 'checked_out', 'attendance_id', v_open.id,
                            'check_in_time', v_open.check_in_time, 'check_out_time', now(),
                            'total_worked_minutes_today', v_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_check_out(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_check_out(uuid) TO authenticated;

-- ── 4. staff_cleanup_stale_attendance — service_role, own cron name ──────────
-- Closes staff shifts left open > threshold hours (forgotten checkout): estimated checkout =
-- check_in + standard_hours_per_shift (fallback 8h), worked minutes 24h-capped. This is the
-- staff twin of cleanup_stale_attendance — it MUST use a DISTINCT cron name so it never
-- collides with the dealer job 'cleanup-stale-attendance'.
CREATE OR REPLACE FUNCTION public.staff_cleanup_stale_attendance(
  p_stale_threshold_hours integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff  timestamptz := now() - (p_stale_threshold_hours || ' hours')::interval;
  v_cleaned integer := 0;
BEGIN
  WITH closed AS (
    UPDATE public.staff_attendance sa
    SET status                     = 'checked_out',
        check_out_time             = sa.check_in_time
                                      + (COALESCE(s.standard_hours_per_shift, 8) || ' hours')::interval,
        total_worked_minutes_today = LEAST(1440,
                                       (COALESCE(s.standard_hours_per_shift, 8) * 60))::int,
        updated_at                 = now()
    FROM public.staff s
    WHERE s.id = sa.staff_id
      AND sa.check_out_time IS NULL
      AND sa.status = 'checked_in'
      AND sa.check_in_time < v_cutoff
    RETURNING sa.id
  )
  SELECT count(*) INTO v_cleaned FROM closed;

  RETURN jsonb_build_object('cleaned', v_cleaned, 'threshold_hours', p_stale_threshold_hours, 'cutoff', v_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_cleanup_stale_attendance(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_cleanup_stale_attendance(integer) TO service_role;

-- Schedule daily at 06:00 (idempotent: unschedule any prior job of the same name first).
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-stale-staff-attendance');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- job did not exist yet
END $$;
SELECT cron.schedule(
  'cleanup-stale-staff-attendance',
  '0 6 * * *',
  $$SELECT public.staff_cleanup_stale_attendance(24)$$
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Controlled-apply TEST PLAN (tx + ROLLBACK; <emp> owns staff row <st> at <club>, <other> unrelated).
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<emp>';
--   SELECT public.staff_check_in('<st>');        -- checked_in
--   SELECT public.staff_check_in('<st>');        -- already_checked_in (idempotent, no 2nd row)
--   SET LOCAL request.jwt.claim.sub = '<other>';
--   SELECT public.staff_check_in('<st>');        -- forbidden (42501, not owner)
--   SET LOCAL request.jwt.claim.sub = '<emp>';
--   SELECT public.staff_check_out('<st>');       -- checked_out + total_worked_minutes_today
--   SELECT public.staff_check_out('<st>');       -- no_open_shift
--   SELECT public.staff_cleanup_stale_attendance(24);  -- (service_role) closes stale rows
-- ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (undo this migration):
--   SELECT cron.unschedule('cleanup-stale-staff-attendance');
--   DROP FUNCTION IF EXISTS public.staff_cleanup_stale_attendance(integer);
--   DROP FUNCTION IF EXISTS public.staff_check_out(uuid);
--   DROP FUNCTION IF EXISTS public.staff_check_in(uuid);
--   DROP TABLE IF EXISTS public.staff_attendance;
-- ═══════════════════════════════════════════════════════════════════════════════
