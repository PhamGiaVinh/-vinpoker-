-- ============================================================================================
-- REPAIR WAVE R3b (2026-07-02, owner-approved): staking refund — columns leg.
-- SOURCE-ONLY: NOT applied on merge — applied via the owner-triggered "Repair wave — apply"
-- workflow (staking-edge), AFTER the enum leg (20261212000000) committed in its own call.
--
-- WHY: staking-process-refund writes refund_status/refund_reason/refunded_by/refunded_at on
-- staking_deals, and CashierDashboard RefundHistoryTab selects the same columns — none exist live
-- (verified read-only 2026-07-02). Additive, idempotent, no data rewrite.
-- staking_purchases.status is TEXT (no enum) — the 'refunded' purchase state needs no DDL.
-- ============================================================================================

ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunded_by uuid,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

COMMENT ON COLUMN public.staking_deals.refund_status IS 'repair-wave R3: completed|partial — set by staking-process-refund';
COMMENT ON COLUMN public.staking_deals.refunded_by IS 'auth.users id of the admin/cashier who processed the refund';
