-- ============================================================================================
-- REPAIR WAVE R3a (2026-07-02, owner-approved): staking refund — enum leg.
-- SOURCE-ONLY: NOT applied on merge — applied only via the owner-triggered "Repair wave — apply"
-- workflow (staking-edge), in its OWN Management-API call BEFORE the columns leg (Postgres cannot
-- use a new enum value inside the transaction that adds it — same pattern as marketing enum).
--
-- WHY: staking-process-refund (and the RefundTab/RefundHistoryTab UI) target
-- staking_deals.status = 'deal_refunded', but the live staking_deal_status enum has 14 values and
-- no such label (verified read-only 2026-07-02). Without it every refund state-write fails.
-- Cross-review additions (same reason, different enums):
--   staking_audit_action lacks 'refunded' (refund audit insert would fail) and the new
--   'release_cosign_state_mismatch' action; notification_type lacks 'deal_refunded' (every refund
--   notification insert would fail silently inside try/catch — nobody told about a real refund).
-- All values are ADDED here and USED only in later, separate calls — safe in one transaction.
-- ============================================================================================

ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'deal_refunded';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'release_cosign_state_mismatch';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'deal_refunded';
