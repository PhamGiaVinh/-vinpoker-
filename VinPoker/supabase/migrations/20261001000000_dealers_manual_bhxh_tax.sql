-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL — per-dealer MANUAL BHXH + TAX override columns (additive)
--
-- Owner request 2026-06-19: let the owner manually set BHXH (social insurance) and
-- PIT (thuế TNCN) per dealer — including to 0 — instead of the auto-computed values.
--
-- NULL  = use the formula (auto-compute), exactly as today.
-- 0     = no BHXH / no tax for this dealer.
-- > 0   = use this exact amount.
--
-- Additive + idempotent. The formula re-author (20261001000001) reads these columns;
-- apply THIS migration FIRST. SOURCE-ONLY: apply is an owner-gated controlled op.
-- NO `supabase db push`, NO deploy_db.
--
-- ROLLBACK:
--   ALTER TABLE public.dealers DROP COLUMN IF EXISTS manual_bhxh_vnd;
--   ALTER TABLE public.dealers DROP COLUMN IF EXISTS manual_tax_vnd;
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.dealers
  ADD COLUMN IF NOT EXISTS manual_bhxh_vnd bigint,
  ADD COLUMN IF NOT EXISTS manual_tax_vnd  bigint;

COMMENT ON COLUMN public.dealers.manual_bhxh_vnd IS
  'Manual social-insurance (BHXH+BHYT+BHTN) override in VND. NULL = auto-compute; 0 = no insurance; >0 = use this total.';
COMMENT ON COLUMN public.dealers.manual_tax_vnd IS
  'Manual PIT (thuế TNCN) override in VND. NULL = auto-compute via calculate_pit_vn; 0 = no tax; >0 = use this amount.';
