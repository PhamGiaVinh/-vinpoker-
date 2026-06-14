-- ════════════════════════════════════════════════════════════════════════════
-- Dealer Shift Planner V2.1 — additive staff-scheduling schema
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  AUTHORED SOURCE ONLY — NOT APPLIED in this session. Live apply is
--     OWNER-GATED (no `supabase db push` / deploy_db=true here).
--
-- This module is a SEPARATE staff scheduler. It is ADDITIVE only and must never
-- read or write the live Dealer Swing system: dealer_assignments,
-- dealer_attendance, dealer_rotation_schedule, swing_* or payroll RPCs. It only
-- READS dealers / dealer_skills / clubs (via app queries), and OWNS the new
-- dealer_shift_* tables below. Payroll later consumes dealer_shift_events (a
-- queue) — the scheduler never cross-writes Dealer Swing or Payroll.
--
-- Rollback: see the DROP companion block at the bottom of this file.

BEGIN;

-- ── 1. Flexible shift templates (08–16, 11–19, 16–00, 18–02, 00–08, …) ────────
CREATE TABLE IF NOT EXISTS public.dealer_shift_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  label               text NOT NULL,
  scheduled_start_at  timestamptz NOT NULL,
  scheduled_end_at    timestamptz NOT NULL,
  default_hours       numeric NOT NULL DEFAULT 8,
  required_skills     text[] NOT NULL DEFAULT '{}',
  needs_lead          boolean NOT NULL DEFAULT false,
  need_count          int NOT NULL DEFAULT 1 CHECK (need_count >= 0),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_templates_club
  ON public.dealer_shift_templates (club_id, active);

-- ── 2. Dealer availability / wishes per work date ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_availability_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  dealer_id    uuid NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  work_date    date NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('preferred','available','leave','unavailable')),
  template_id  uuid REFERENCES public.dealer_shift_templates(id) ON DELETE SET NULL,
  note         text,
  status       text NOT NULL DEFAULT 'submitted'
               CHECK (status IN ('submitted','acknowledged','rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_availability_club_date
  ON public.dealer_availability_requests (club_id, work_date);
CREATE INDEX IF NOT EXISTS idx_availability_dealer_date
  ON public.dealer_availability_requests (dealer_id, work_date);

-- ── 3. Schedule runs (a generated/published draft for a work date) ────────────
CREATE TABLE IF NOT EXISTS public.dealer_schedule_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  work_date       date NOT NULL,
  solver_version  text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','superseded')),
  generated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_club_date
  ON public.dealer_schedule_runs (club_id, work_date);

-- ── 4. Shift assignments (one dealer per shift slot per day) ───────────────────
CREATE TABLE IF NOT EXISTS public.dealer_shift_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  run_id              uuid REFERENCES public.dealer_schedule_runs(id) ON DELETE SET NULL,
  dealer_id           uuid NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  template_id         uuid REFERENCES public.dealer_shift_templates(id) ON DELETE SET NULL,
  work_date           date NOT NULL,
  scheduled_start_at  timestamptz NOT NULL,
  scheduled_end_at    timestamptz NOT NULL,
  role                text NOT NULL DEFAULT 'Dealer',
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','confirmed','checked_in','closed','cancelled','no_show')),
  score               numeric,
  reason              jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_in_at       timestamptz,
  checked_out_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- CORE INVARIANT: a dealer holds at most ONE live assignment per work date.
-- (cancelled / no_show rows are excluded so a dealer can be re-planned.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_one_per_dealer_per_day
  ON public.dealer_shift_assignments (dealer_id, work_date)
  WHERE status IN ('draft','published','confirmed','checked_in','closed');

CREATE INDEX IF NOT EXISTS idx_shift_assignments_club_date
  ON public.dealer_shift_assignments (club_id, work_date);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_run
  ON public.dealer_shift_assignments (run_id);

-- ── 5. Audit log (who changed which assignment) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_shift_audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  assignment_id  uuid REFERENCES public.dealer_shift_assignments(id) ON DELETE SET NULL,
  actor          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_audit_club
  ON public.dealer_shift_audit_logs (club_id, created_at);

-- ── 6. Payroll-bound event queue (Payroll polls this; scheduler never writes
--       swing/payroll tables directly) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_shift_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  assignment_id  uuid REFERENCES public.dealer_shift_assignments(id) ON DELETE SET NULL,
  dealer_id      uuid REFERENCES public.dealers(id) ON DELETE SET NULL,
  event_type     text NOT NULL
                 CHECK (event_type IN ('shift_published','checked_in','checked_out','late','no_show','shift_closed')),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_events_club_unconsumed
  ON public.dealer_shift_events (club_id, consumed_at);

-- ── updated_at triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_dealer_shift_templates_updated_at ON public.dealer_shift_templates;
CREATE TRIGGER update_dealer_shift_templates_updated_at
  BEFORE UPDATE ON public.dealer_shift_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_dealer_availability_requests_updated_at ON public.dealer_availability_requests;
CREATE TRIGGER update_dealer_availability_requests_updated_at
  BEFORE UPDATE ON public.dealer_availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_dealer_schedule_runs_updated_at ON public.dealer_schedule_runs;
CREATE TRIGGER update_dealer_schedule_runs_updated_at
  BEFORE UPDATE ON public.dealer_schedule_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_dealer_shift_assignments_updated_at ON public.dealer_shift_assignments;
CREATE TRIGGER update_dealer_shift_assignments_updated_at
  BEFORE UPDATE ON public.dealer_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Control staff (dealer control / club admin / super admin) read+write their
-- club's planner data. A dealer can read assignments/requests that are theirs.
-- service_role owns all writes (edge functions, Phase 2).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dealer_shift_templates',
    'dealer_availability_requests',
    'dealer_schedule_runs',
    'dealer_shift_assignments',
    'dealer_shift_audit_logs',
    'dealer_shift_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_control_all" ON public.%1$s;', t);
    EXECUTE format($p$
      CREATE POLICY "%1$s_control_all" ON public.%1$s FOR ALL
      USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.is_club_admin(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
      )
      WITH CHECK (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.is_club_admin(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
      );
    $p$, t);

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_service_all" ON public.%1$s;', t);
    EXECUTE format($p$
      CREATE POLICY "%1$s_service_all" ON public.%1$s FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
    $p$, t);
  END LOOP;
END $$;

-- Dealer self-read: assignments that belong to them.
DROP POLICY IF EXISTS "dealer_shift_assignments_select_own" ON public.dealer_shift_assignments;
CREATE POLICY "dealer_shift_assignments_select_own"
  ON public.dealer_shift_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_shift_assignments.dealer_id AND d.user_id = auth.uid()
    )
  );

-- Dealer self-manage: their own availability requests.
DROP POLICY IF EXISTS "dealer_availability_requests_own" ON public.dealer_availability_requests;
CREATE POLICY "dealer_availability_requests_own"
  ON public.dealer_availability_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_availability_requests.dealer_id AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_availability_requests.dealer_id AND d.user_id = auth.uid()
    )
  );

-- ── Publish RPC: lock a run + emit shift_published events (NO swing/payroll write)
CREATE OR REPLACE FUNCTION public.publish_shift_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id   uuid;
  v_work_date date;
  v_published int := 0;
BEGIN
  SELECT club_id, work_date INTO v_club_id, v_work_date
  FROM public.dealer_schedule_runs WHERE id = p_run_id;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF NOT (
    public.is_club_dealer_control(auth.uid(), v_club_id)
    OR public.is_club_admin(auth.uid(), v_club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized for club %', v_club_id;
  END IF;

  UPDATE public.dealer_schedule_runs
    SET status = 'published', published_at = now()
    WHERE id = p_run_id;

  UPDATE public.dealer_shift_assignments
    SET status = 'published'
    WHERE run_id = p_run_id AND status = 'draft';
  GET DIAGNOSTICS v_published = ROW_COUNT;

  INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
  SELECT a.club_id, a.id, a.dealer_id, 'shift_published',
         jsonb_build_object('work_date', a.work_date, 'start_at', a.scheduled_start_at, 'end_at', a.scheduled_end_at)
  FROM public.dealer_shift_assignments a
  WHERE a.run_id = p_run_id AND a.status = 'published';

  RETURN jsonb_build_object('outcome', 'published', 'run_id', p_run_id, 'count', v_published);
END;
$$;

-- ── Close-shift RPC: record check-out / no-show as a payroll event ─────────────
CREATE OR REPLACE FUNCTION public.close_shift_assignment(p_assignment_id uuid, p_outcome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
  v_dealer  uuid;
  v_status  text;
  v_event   text;
BEGIN
  IF p_outcome NOT IN ('closed','no_show') THEN
    RAISE EXCEPTION 'invalid outcome %', p_outcome;
  END IF;

  SELECT club_id, dealer_id INTO v_club_id, v_dealer
  FROM public.dealer_shift_assignments WHERE id = p_assignment_id;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF NOT (
    public.is_club_dealer_control(auth.uid(), v_club_id)
    OR public.is_club_admin(auth.uid(), v_club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized for club %', v_club_id;
  END IF;

  v_status := p_outcome;
  v_event  := CASE WHEN p_outcome = 'no_show' THEN 'no_show' ELSE 'shift_closed' END;

  UPDATE public.dealer_shift_assignments
    SET status = v_status,
        checked_out_at = CASE WHEN p_outcome = 'closed' THEN now() ELSE checked_out_at END
    WHERE id = p_assignment_id;

  INSERT INTO public.dealer_shift_events (club_id, assignment_id, dealer_id, event_type, payload)
  VALUES (v_club_id, p_assignment_id, v_dealer, v_event, jsonb_build_object('at', now()));

  RETURN jsonb_build_object('outcome', v_status, 'assignment_id', p_assignment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_shift_run(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift_assignment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_shift_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_shift_assignment(uuid, text) TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual; run only if reverting — all objects are additive/new):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.close_shift_assignment(uuid, text);
-- DROP FUNCTION IF EXISTS public.publish_shift_run(uuid);
-- DROP TABLE IF EXISTS public.dealer_shift_events CASCADE;
-- DROP TABLE IF EXISTS public.dealer_shift_audit_logs CASCADE;
-- DROP TABLE IF EXISTS public.dealer_shift_assignments CASCADE;
-- DROP TABLE IF EXISTS public.dealer_schedule_runs CASCADE;
-- DROP TABLE IF EXISTS public.dealer_availability_requests CASCADE;
-- DROP TABLE IF EXISTS public.dealer_shift_templates CASCADE;
-- COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
