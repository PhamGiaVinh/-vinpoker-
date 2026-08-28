-- SePay ingestion — Patch 1a: raw bank-transaction work-queue + append-only webhook audit.
-- Greenfield: no prior bank_transactions / bank_webhook_audit / sepay objects exist on main.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL
-- Editor / Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: the platform needs to ingest SePay bank-transfer webhook events idempotently and durably
-- BEFORE any reconciliation. This patch creates ONLY the storage layer — two tables + RLS + indexes.
-- It is INERT: rows are raw and trigger no business/money action. The Edge Function that receives
-- the webhook (sepay-webhook) + its deploy wiring = Patch 1b. Independent SePay-API reconciliation,
-- the per-club secret store, and the matching/confirmation (fraud) gate = Patch 2.
--
-- bank_transactions = MUTABLE work-queue (Patch 2 advances status / resolves club_id).
-- bank_webhook_audit = APPEND-ONLY security/ops log; also the lossless backstop for an
--   authenticated-but-malformed event (Patch 1b stores raw_body so Patch-2 API-poll can recover it).
--
-- DEDUPE (P1-1 / P2-A): unique (provider, account_number, provider_txn_id). SePay `id` is only
--   assumed unique within ONE SePay account, so the MASTER account_number is part of the key —
--   never sub_account (the per-VA identity), which varies per club while the id space is shared.
-- LOSSLESS (P1-A): amount + occurred_at are NULLABLE so a soft parse failure is persisted as
--   status='quarantined' instead of rejected (SePay does not re-send once the endpoint responds).
-- HELPERS USED (must already exist): public.has_role(auth.uid(), 'super_admin'),
--   public.is_club_owner(auth.uid(), club_id). (get_user_club_id / is_super_admin do NOT exist.)
--
-- RLS: default-deny. REVOKE ALL from public/anon/authenticated, GRANT SELECT to authenticated,
--   SELECT-only policies (owner / super-admin). NO insert/update/delete policy on either table —
--   only the service-role Edge client (Patch 1b) writes, bypassing RLS. The audit table stays
--   append-only by the ABSENCE of any UPDATE/DELETE policy.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; DROP POLICY IF EXISTS before CREATE POLICY.

-- ===========================================================================================
-- 1. bank_transactions — raw ingest work-queue (mutable, inert)
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL DEFAULT 'sepay',
  provider_txn_id text NOT NULL,                                   -- SePay transaction id
  account_number  text NOT NULL,                                   -- master account (dedupe key part)
  sub_account     text,                                            -- VA identity; resolves club in Patch 2
  club_id         uuid REFERENCES public.clubs(id),                -- NULLABLE at raw ingest; resolved in Patch 2
  gateway         text,
  amount          bigint,                                          -- VND; NULLABLE (P1-A quarantine path)
  transfer_type   text,                                            -- 'in' | 'out'
  content         text,
  txn_ref         text,                                            -- SePay referenceCode
  occurred_at     timestamptz,                                     -- from SePay transactionDate (Asia/Ho_Chi_Minh); NULLABLE
  status          text NOT NULL DEFAULT 'unmatched'
                    CHECK (status IN ('unmatched','matched','ignored','quarantined')),
  processed_at    timestamptz,                                     -- set when the row reaches a terminal status
  raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,              -- parsed body; never contains the auth header/secret
  raw_body        text,                                            -- verbatim bytes (future HMAC + parse-fail blob)
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_txn_matched_has_amount CHECK (status <> 'matched' OR amount IS NOT NULL)
);

-- Multi-tenant-safe idempotency key (P1-1 / P2-A): master account_number, NOT sub_account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_txn
  ON public.bank_transactions (provider, account_number, provider_txn_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_club
  ON public.bank_transactions (club_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_unmatched
  ON public.bank_transactions (status) WHERE status = 'unmatched';  -- matching worklist
CREATE INDEX IF NOT EXISTS idx_bank_txn_occurred_at
  ON public.bank_transactions (occurred_at);

-- ===========================================================================================
-- 2. bank_webhook_audit — append-only security/ops log + lossless backstop
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.bank_webhook_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL DEFAULT 'sepay',
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  verified            boolean NOT NULL,                            -- did the Apikey check pass?
  http_status         integer NOT NULL,                           -- response code returned
  outcome             text NOT NULL
                        CHECK (outcome IN ('inserted','duplicate','unauthorized','bad_payload')),
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,  -- P2-F: survives Patch-2 purge
  remote_ip           text,
  raw_payload         jsonb NOT NULL DEFAULT '{}'::jsonb,          -- never store the secret; no attacker payload for 'unauthorized'
  raw_body            text                                         -- P1-B: kept for authenticated 'bad_payload' (1b decides)
);

CREATE INDEX IF NOT EXISTS idx_bank_webhook_audit_received_at
  ON public.bank_webhook_audit (received_at);
CREATE INDEX IF NOT EXISTS idx_bank_webhook_audit_outcome
  ON public.bank_webhook_audit (outcome);

-- ===========================================================================================
-- 3. RLS — default-deny; SELECT-only (owner / super-admin). Writes are service-role-only (Edge,
--    Patch 1b). No INSERT/UPDATE/DELETE policy on either table → audit stays append-only by design.
-- ===========================================================================================
ALTER TABLE public.bank_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_webhook_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bank_transactions  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bank_webhook_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bank_transactions  TO authenticated;
GRANT SELECT ON public.bank_webhook_audit TO authenticated;

-- bank_transactions: super-admin sees all; a club owner sees only its OWN resolved rows.
-- Raw rows with club_id IS NULL are visible to super-admin only (safe default for a platform feed).
DROP POLICY IF EXISTS bank_transactions_select ON public.bank_transactions;
CREATE POLICY bank_transactions_select ON public.bank_transactions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id))
  );

-- bank_webhook_audit: super-admin only (platform-level security/ops log).
DROP POLICY IF EXISTS bank_webhook_audit_select ON public.bank_webhook_audit;
CREATE POLICY bank_webhook_audit_select ON public.bank_webhook_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
