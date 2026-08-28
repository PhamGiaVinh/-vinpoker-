-- 20261220000000_dealer_shift_preference_and_draft_rls.sql
--
-- Patch 1 of the auto-fill ("Tự động xếp") build for the dealer Shift Planner.
-- Two changes, both low-risk:
--   (a) ADDITIVE column  public.dealers.shift_preference  (solver input).
--   (b) TIGHTEN one RLS policy so the dealer app can never SELECT a floor 'draft'
--       assignment (defence-in-depth behind the frontend filter added in #741).
--
-- Idempotent. No backfill. Does NOT touch save_shift_run / publish_shift_run,
-- the operator `<table>_control_all` policies, Dealer Swing, payroll, or any
-- other table. Rollback + pre-change snapshot:
--   docs/emergency_rollbacks/20261220000000_shift_preference_and_draft_rls_PRE.md
--
-- Apply is OWNER-GATED (run in Supabase SQL editor; schema_migrations untouched).
-- Sequencing: apply this migration BEFORE merging the frontend PR — the two
-- dialogs write dealers.shift_preference and that column must exist first.

-- ── (a) dealers.shift_preference ──────────────────────────────────────────────
-- som = ưu tiên ca sớm · muon = ưu tiên ca muộn · linh_hoat = linh hoạt.
-- NULL = linh hoạt (mặc định, không backfill). Solver coi NULL == 'linh_hoat'.
ALTER TABLE public.dealers ADD COLUMN IF NOT EXISTS shift_preference text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealers_shift_preference_check'
  ) THEN
    ALTER TABLE public.dealers
      ADD CONSTRAINT dealers_shift_preference_check
      CHECK (shift_preference IS NULL OR shift_preference IN ('som', 'muon', 'linh_hoat'));
  END IF;
END $$;

COMMENT ON COLUMN public.dealers.shift_preference IS
  'Auto-fill shift preference: som (early) | muon (late) | linh_hoat (flexible). NULL = flexible.';

-- ── (b) Dealer self-read: never expose a floor DRAFT to the dealer app ────────
-- Replaces the policy from 20260827000000:198-207 VERBATIM, adding status<>'draft'.
-- status is NOT NULL (default 'draft') so the comparison is total.
-- The operator FOR ALL policy `<table>_control_all` is deliberately UNCHANGED —
-- floor / dealer-control still see drafts to build the schedule.
DROP POLICY IF EXISTS "dealer_shift_assignments_select_own" ON public.dealer_shift_assignments;
CREATE POLICY "dealer_shift_assignments_select_own"
  ON public.dealer_shift_assignments FOR SELECT
  USING (
    dealer_shift_assignments.status <> 'draft'
    AND EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_shift_assignments.dealer_id AND d.user_id = auth.uid()
    )
  );
