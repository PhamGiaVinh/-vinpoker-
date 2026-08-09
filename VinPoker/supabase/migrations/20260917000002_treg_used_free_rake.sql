-- Fix online-registration 500: add the missing `used_free_rake` column that the deployed
-- tournament-register Edge Function already inserts/selects, but which no migration ever created
-- (live-DB schema drift). Additive + idempotent. Boolean flag: did this registration consume a
-- free-rake slot (for the savings display). The authoritative slot count stays on
-- tournaments.free_rake_used (incremented atomically by try_consume_free_rake_slot).
--
-- SOURCE-ONLY: NOT applied here. Apply is an owner-gated controlled op (Management API:
-- preflight column absent -> ALTER ADD COLUMN IF NOT EXISTS -> NOTIFY pgrst reload -> verify).
-- NO `supabase db push`, NO deploy_db, NO schema_migrations write by the runner.
--
-- ROLLBACK: ALTER TABLE public.tournament_registrations DROP COLUMN IF EXISTS used_free_rake;

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS used_free_rake boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tournament_registrations.used_free_rake IS
  'Whether this registration consumed a free-rake slot (display/savings only). Default false.';
