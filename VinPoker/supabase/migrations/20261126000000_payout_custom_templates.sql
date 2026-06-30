-- 20261126000000_payout_custom_templates.sql
-- ============================================================================================
-- Let a club SAVE a reusable CUSTOM payout (its own % per rank) into the existing
-- payout_templates library and reload it into any future tournament. Minimal, additive:
--   1. widen the archetype CHECK to allow 'CUSTOM' (was DAILY/INTL/MULTI/TRITON only);
--   2. add a nullable custom_percents jsonb column — frozen [{position, percent_bp}] (Σ=10000)
--      for CUSTOM templates; NULL for preset templates.
-- No new RPC and no RLS change: payout_templates RLS already lets Owner/Admin write and
-- Owner/Admin/Cashier read, scoped per club (see 20261120000000).
--
-- SOURCE-ONLY. Apply via the controlled Management-API BEGIN..COMMIT runbook (NOT db push);
-- do NOT write schema_migrations. Flag FEATURES.payoutCustomTemplates stays OFF until applied.
-- ============================================================================================

-- 1. widen archetype CHECK (+CUSTOM); drop-then-add so a re-run is safe ------------------------
ALTER TABLE public.payout_templates DROP CONSTRAINT IF EXISTS payout_templates_archetype_check;
ALTER TABLE public.payout_templates
  ADD CONSTRAINT payout_templates_archetype_check
  CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON','CUSTOM'));

-- 2. add custom_percents jsonb (CUSTOM templates only) -----------------------------------------
ALTER TABLE public.payout_templates ADD COLUMN IF NOT EXISTS custom_percents jsonb;
COMMENT ON COLUMN public.payout_templates.custom_percents IS
  'CUSTOM templates only: saved [{position, percent_bp}] basis points (Σ=10000). NULL for preset archetypes.';

-- ============================================================================================
-- Down-migration (reference only; run only to fully revert):
--   ALTER TABLE public.payout_templates DROP COLUMN IF EXISTS custom_percents;
--   ALTER TABLE public.payout_templates DROP CONSTRAINT IF EXISTS payout_templates_archetype_check;
--   ALTER TABLE public.payout_templates ADD CONSTRAINT payout_templates_archetype_check
--     CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON'));
-- ============================================================================================
