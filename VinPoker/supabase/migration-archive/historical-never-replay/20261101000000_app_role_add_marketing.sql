-- Marketing module (MKT-1, A1) — add the 'marketing' value to the shared app_role enum.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply THIS ALONE FIRST in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db),
-- VERIFY the enum contains 'marketing', and ONLY THEN apply 20261101000001_marketing_role.sql.
-- schema_migrations is NOT touched here.
--
-- WHY SEPARATE: Postgres cannot use a newly-added enum value inside the same transaction that
-- added it. The role membership table + helpers + grant/revoke RPCs (000001) and the core
-- schema (000002) never reference 'marketing' literally, but the human-run TEST blocks may
-- insert the role — so the enum value must be committed before anything that depends on it.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op if 'marketing' already exists.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing';

-- Verify (run manually after apply):
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--   WHERE t.typname = 'app_role' ORDER BY e.enumsortorder;
--   -- EXPECT the list to include 'marketing'.
