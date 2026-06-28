-- F&B module (FNB-P0) — add the three F&B operator values to the shared app_role enum.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply THIS ALONE FIRST in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db),
-- VERIFY the enum contains the three values, and ONLY THEN apply 20261111000001_fnb_role.sql.
-- schema_migrations is NOT touched here.
--
-- WHY SEPARATE: Postgres cannot USE a newly-added enum value inside the same transaction that
-- added it. The role membership table + helpers + grant/revoke RPCs (000001) and the core schema
-- (000002) never reference these values literally — ALL authority is the public.club_fnb_staff
-- membership table; these enum values are a COARSE NAV AFFORDANCE ONLY (so the header can show the
-- right F&B entry without a membership round-trip). But the human-run TEST blocks may insert a
-- role, so the values must be committed before anything that depends on them.
--
-- WHY THREE VALUES: F&B has three distinct job functions — counter cashier (takes money), server
-- (carries food, marks SHIPPED), and kitchen (reads the live display). They mirror how `cashier`,
-- `media`, `dealer_control`, `floor`, `marketing` were each added as their own value.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op if the value already exists. These statements
-- only ADD (never USE) the values, so applying the file as a single transaction is safe on PG15.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fnb_cashier';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fnb_server';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fnb_kitchen';

-- Verify (run manually after apply):
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--   WHERE t.typname = 'app_role' ORDER BY e.enumsortorder;
--   -- EXPECT the list to include 'fnb_cashier', 'fnb_server', 'fnb_kitchen'.
--
-- ROLLBACK: a single enum value cannot be dropped without recreating public.app_role (referenced
-- by user_roles + many RLS policies). Leaving an unused enum value is harmless; do NOT attempt to
-- drop it. If the whole F&B module is abandoned, the value simply stays unused.
