-- SePay ingestion — Patch 2a-inert (1/2): fraud-gate columns on bank_transactions.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL
-- Editor / Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: Patch 2 reconciliation will independently pull each transaction from the SePay API (the
-- source of truth) and stamp the matching bank_transactions row as api-verified. Auto-confirm
-- (a later, separately-reviewed patch) may only proceed when api_verified_at IS NOT NULL — a
-- forged webhook row is never listed by SePay's API, so it never gets verified and can never
-- auto-confirm. THIS patch only ADDS the columns + a worklist index. It is INERT: the new columns
-- are NULL on every existing row and NOTHING writes them yet (the reconcile fn that sets them is a
-- later patch). No row is touched — no backfill, no UPDATE.
--
-- Additive only: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS. Idempotent / re-runnable.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS api_verified_at     timestamptz,   -- set ONLY by the Patch-2 SePay-API pull
  ADD COLUMN IF NOT EXISTS api_verified_source text;          -- provenance, e.g. 'sepay_userapi' (nullable)

-- Settlement worklist: rows that arrived (unmatched) AND have been independently SePay-API-verified.
-- Partial index keeps it small; the predicate columns (status, api_verified_at) are immutable.
CREATE INDEX IF NOT EXISTS idx_bank_txn_settle_worklist
  ON public.bank_transactions (created_at)
  WHERE status = 'unmatched' AND api_verified_at IS NOT NULL;
