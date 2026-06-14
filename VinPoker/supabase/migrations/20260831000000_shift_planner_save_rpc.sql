-- ════════════════════════════════════════════════════════════════════════════
-- Dealer Shift Planner — Phase 2C: save_shift_run RPC + template uniqueness
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  AUTHORED SOURCE ONLY — apply via a controlled owner-gated op (Supabase SQL
--     Editor / direct SQL), NEVER `supabase db push`. Idempotent. Does NOT touch
--     schema_migrations or the pending risky chain. Additive only; never writes
--     dealer_assignments / dealer_attendance / dealer_rotation_schedule / swing_* /
--     payroll. Builds on 20260827000000 (publish_shift_run / close_shift_assignment).
--
-- save_shift_run: persist a planner draft (run + assignments).
--   • SECURITY DEFINER + internal role check (DEFINER bypasses RLS).
--   • Supersedes ONLY prior DRAFT runs for the club/date.
--   • MUST NOT overwrite a published/confirmed/checked_in/closed schedule →
--     raises 'published_schedule_exists'.
-- Rollback: DROP block at the bottom.

BEGIN;

-- Defense-in-depth for the idempotent template seed (one active label per club).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_templates_club_label
  ON public.dealer_shift_templates (club_id, label)
  WHERE active;

CREATE OR REPLACE FUNCTION public.save_shift_run(
  p_club_id        uuid,
  p_work_date      date,
  p_solver_version text,
  p_params         jsonb,
  p_assignments    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_count  int := 0;
BEGIN
  -- Internal authorization (do NOT rely on RLS — DEFINER bypasses it).
  IF NOT (
    public.is_club_dealer_control(auth.uid(), p_club_id)
    OR public.is_club_admin(auth.uid(), p_club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized for club %', p_club_id;
  END IF;

  -- GUARD: never overwrite a schedule that has progressed beyond draft.
  IF EXISTS (
    SELECT 1 FROM public.dealer_schedule_runs r
    WHERE r.club_id = p_club_id AND r.work_date = p_work_date
      AND r.status IN ('published')
  ) OR EXISTS (
    SELECT 1 FROM public.dealer_shift_assignments a
    WHERE a.club_id = p_club_id AND a.work_date = p_work_date
      AND a.status IN ('published','confirmed','checked_in','closed')
  ) THEN
    RAISE EXCEPTION 'published_schedule_exists';
  END IF;

  -- Supersede prior DRAFT runs + cancel their draft assignments (frees the
  -- uq_shift_one_per_dealer_per_day index for the new draft).
  UPDATE public.dealer_shift_assignments
    SET status = 'cancelled'
    WHERE club_id = p_club_id AND work_date = p_work_date AND status = 'draft';
  UPDATE public.dealer_schedule_runs
    SET status = 'superseded'
    WHERE club_id = p_club_id AND work_date = p_work_date AND status = 'draft';

  -- New draft run.
  INSERT INTO public.dealer_schedule_runs
    (club_id, work_date, solver_version, params, status, generated_by)
  VALUES
    (p_club_id, p_work_date, COALESCE(p_solver_version, 'shift-planner'),
     COALESCE(p_params, '{}'::jsonb), 'draft', auth.uid())
  RETURNING id INTO v_run_id;

  -- Insert the draft assignments.
  INSERT INTO public.dealer_shift_assignments
    (club_id, run_id, dealer_id, template_id, work_date,
     scheduled_start_at, scheduled_end_at, role, status, score, reason)
  SELECT
    p_club_id, v_run_id, x.dealer_id, x.template_id, p_work_date,
    x.scheduled_start_at, x.scheduled_end_at, COALESCE(x.role, 'Dealer'),
    'draft', x.score, COALESCE(x.reason, '{}'::jsonb)
  FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::jsonb)) AS x(
    dealer_id          uuid,
    template_id        uuid,
    scheduled_start_at timestamptz,
    scheduled_end_at   timestamptz,
    role               text,
    score              numeric,
    reason             jsonb
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('outcome', 'saved', 'run_id', v_run_id, 'count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.save_shift_run(uuid, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_shift_run(uuid, date, text, jsonb, jsonb) TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual; additive objects only):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.save_shift_run(uuid, date, text, jsonb, jsonb);
-- DROP INDEX IF EXISTS public.uq_shift_templates_club_label;
-- COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
