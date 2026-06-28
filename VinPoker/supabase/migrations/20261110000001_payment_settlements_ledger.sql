-- SePay ingestion — Patch 2a-inert (2/2): payment_settlements append-only ledger (EMPTY).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL
-- Editor / Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: Patch 2 will record one settlement row per processed bank transfer — auto-confirmed,
-- manually-confirmed, or one of several flagged-for-cashier outcomes. THIS patch only CREATES the
-- empty table + its RLS + indexes. It is INERT: NO trigger, NO RPC, NOTHING writes to it yet (the
-- settle / manual-confirm / ignore RPCs that append rows are later, separately-reviewed patches).
-- Append-only by construction: a SELECT-only policy and NO insert/update/delete policy → only a
-- future SECURITY DEFINER RPC (service-role, which bypasses RLS) can ever write, never a client.
--
-- All three FKs are ON DELETE SET NULL so the ledger survives a later raw-blob purge of
-- bank_transactions / a deleted registration / a deleted club without FK violations or orphan rows.
-- confirmed_by is a plain uuid (NULL = system auto-confirm), NOT an FK to auth.users.
--
-- This patch does NOT touch registration / cashier / seat logic, and creates NO token store
-- (per-club credentials = a later, separately-gated patch).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; DROP POLICY IF EXISTS before CREATE POLICY.

CREATE TABLE IF NOT EXISTS public.payment_settlements (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id        uuid REFERENCES public.bank_transactions(id)        ON DELETE SET NULL,  -- nullable: survives raw purge (Patch 2)
  tournament_registration_id uuid REFERENCES public.tournament_registrations(id) ON DELETE SET NULL,  -- FK reference-only; NO logic in this patch
  club_id                    uuid REFERENCES public.clubs(id)                    ON DELETE SET NULL,  -- nullable: un-resolved rows = super_admin-only
  amount                     bigint NOT NULL,                 -- VND snapshot of bank_transactions.amount
  expected_amount            bigint,                          -- VND snapshot of registration.total_pay (mismatch forensics)
  reference_code             text,                            -- extracted code (nullable for no-match)
  outcome                    text NOT NULL CHECK (outcome IN (
                               'auto_confirmed','manual_confirmed',
                               'flagged_amount_mismatch','flagged_no_match','flagged_duplicate',
                               'flagged_not_pending','flagged_seating_failed','dismissed')),
  confirmed_by               uuid,                            -- NULL = system (C6); else cashier uid. Plain uuid, no FK.
  reason                     text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: at most ONE terminal confirm per bank transaction (partial — flag outcomes may repeat across re-runs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_confirm_per_txn
  ON public.payment_settlements (bank_transaction_id)
  WHERE outcome IN ('auto_confirmed','manual_confirmed');

CREATE INDEX IF NOT EXISTS idx_settlement_club    ON public.payment_settlements (club_id);
CREATE INDEX IF NOT EXISTS idx_settlement_created ON public.payment_settlements (created_at);

-- RLS — append-only, default-deny. SELECT only; writes go through a future SECURITY DEFINER RPC
-- (service-role bypasses RLS). NO insert/update/delete policy → the table stays append-only.
ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_settlements TO authenticated;

DROP POLICY IF EXISTS payment_settlements_select ON public.payment_settlements;
CREATE POLICY payment_settlements_select ON public.payment_settlements
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (club_id IS NOT NULL AND public.is_club_cashier(auth.uid(), club_id))
  );
