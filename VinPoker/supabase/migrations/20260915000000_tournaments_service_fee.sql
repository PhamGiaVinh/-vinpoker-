-- Tournament per-entry SERVICE FEE (phí dịch vụ) — additive column, separate from rake.
-- SOURCE-ONLY: NOT applied here. Apply is an owner-gated controlled op (Management API:
-- preflight -> ALTER ADD COLUMN IF NOT EXISTS -> verify column present + default).
-- NO `supabase db push`, NO deploy_db, NO schema_migrations edit by the runner.
--
-- Model (owner-locked 2026-06-17): a tournament entry's player price is
--     buy_in + rake_amount + service_fee_amount
-- rake_amount (existing) = the house/prize rake; service_fee_amount (this column) = a SEPARATE
-- service fee. Both are single configured per-tour values, identical online & offline. When
-- service_fee_amount = 0 (the default for every existing tour) the price is exactly buy_in + rake,
-- so this column is a NO-OP until an owner sets it > 0. Additive + idempotent.
--
-- ROLLBACK: docs/emergency_rollbacks/PRE_SERVICE_FEE_20260915.sql
--   ALTER TABLE public.tournaments DROP COLUMN IF EXISTS service_fee_amount;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS service_fee_amount bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tournaments.service_fee_amount IS
  'Per-entry service fee (phí dịch vụ) in VND, separate from rake_amount. Player pays buy_in + rake_amount + service_fee_amount. Default 0 = no service fee.';
