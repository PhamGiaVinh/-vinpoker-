-- ============================================================================================
-- REPAIR WAVE R3a (2026-07-02, owner-approved): staking refund — enum leg.
-- SOURCE-ONLY: NOT applied on merge — applied only via the owner-triggered "Repair wave — apply"
-- workflow (staking-edge), in its OWN Management-API call BEFORE the columns leg (Postgres cannot
-- use a new enum value inside the transaction that adds it — same pattern as marketing enum).
--
-- WHY: staking-process-refund (and the RefundTab/RefundHistoryTab UI) target
-- staking_deals.status = 'deal_refunded', but the live staking_deal_status enum has 14 values and
-- no such label (verified read-only 2026-07-02). Without it every refund state-write fails.
-- ============================================================================================

ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'deal_refunded';
