-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 5a-claim — additive override-claim table for the M2 non-forgeable override
-- signal. SOURCE-ONLY (ADR 012 + Amendment A8, claim model).
--
-- WHY: the rejected REVOKE+GUC model (#556) would have broken release_dealer_from_table
-- (SECURITY INVOKER, called from DealerSwingTab.tsx:2168 as authenticated) and exposed 3
-- other INVOKER writers. This table replaces it: an authorized manual override leaves a
-- same-transaction, single-use CLAIM row that the seat trigger (Patch 5a-rewrite,
-- 20261109000000) consumes — instead of a forgeable GUC + a collateral REVOKE.
--
-- FORGERY-PROOF BY CONSTRUCTION (no REVOKE needed): RLS enabled + NO write policy
-- (the proven Patch-2 pattern, 20261104000000:122-139) → authenticated/anon direct writes
-- are RLS-denied even with the default grant. Only the postgres SECURITY DEFINER
-- assign_dealer_to_table (owner bypasses RLS) writes a claim; only the postgres SECURITY
-- DEFINER trigger reads/consumes it. No client can fabricate a claim.
--
-- SAME-TX + REPLAY-PROOF: `txid` = pg_current_xact_id() of the writing (assign) tx. The
-- trigger matches `txid = pg_current_xact_id()` of the seating tx → matches only its own
-- tx; a different tx (a client's direct insert) never matches; a stale claim from a past
-- tx never re-matches (different xid). Match is anchored on `attendance_id` (the seat
-- instance) so a claim for one seat cannot cover a different seat in the same tx.
--
-- NO REVOKE here or in the rewrite → release_dealer_from_table + the 3 INVOKER writers are
-- UNTOUCHED → zero production regression. Apply BEFORE 20261109000000 (it references this
-- table). NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- ROLLBACK: `DROP TABLE public.dealer_override_claims;` (independent, additive, inert until
-- the rewrite's trigger/assign reference it).
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

create table if not exists public.dealer_override_claims (
  id            uuid primary key default gen_random_uuid(),
  table_id      uuid not null references public.game_tables(id) on delete cascade,
  dealer_id     uuid not null references public.dealers(id) on delete cascade,         -- audit/debug only; matching anchors on attendance_id
  attendance_id uuid not null references public.dealer_attendance(id) on delete cascade, -- seat-instance anchor for trigger matching
  txid          bigint not null,                                                        -- pg_current_xact_id() of the assign tx (same-tx, replay-proof)
  created_at    timestamptz not null default now()
);

-- Trigger match path: (attendance_id, txid).
create index if not exists idx_dealer_override_claims_match on public.dealer_override_claims(attendance_id, txid);
-- Cleanup of harmless orphans (an override that wrote a claim but returned before the seat INSERT,
-- e.g. table_occupied): such claims never re-match (txid-scoped) but can be pruned by age.
create index if not exists idx_dealer_override_claims_created on public.dealer_override_claims(created_at);

-- RLS: enable + NO write policy → direct client writes denied (Patch-2 precedent). The trigger
-- (postgres DEFINER, owner) bypasses RLS to read/DELETE; assign (postgres DEFINER) bypasses RLS to
-- INSERT. No SELECT policy → clients cannot read claims either. service_role bypasses RLS but never
-- writes claims. No GRANT/REVOKE statements — default grants are inert under RLS-with-no-policy.
alter table public.dealer_override_claims enable row level security;

COMMENT ON TABLE public.dealer_override_claims IS
  'Patch 5a (M2): same-tx, single-use authorized-override claims consumed by dealer_assignments_pool_enforce. RLS-on + no write policy → unforgeable by clients; only the postgres DEFINER assign_dealer_to_table writes, only the postgres DEFINER trigger reads/consumes. txid=pg_current_xact_id() gives same-tx + replay-proof matching anchored on attendance_id. Replaces the rejected REVOKE+GUC override model (no REVOKE → release_dealer_from_table + INVOKER writers untouched).';

COMMIT;
