-- ═══════════════════════════════════════════════════════════════════════════
-- Hardening B — REVOKE PUBLIC on LEGACY club-lock functions (SOURCE-ONLY; apply later)
-- Date: 2026-10-07
--
-- WHY: B2.2a (P0) revoked PUBLIC on the NEW fenced lock funcs. The LEGACY lock funcs
--   (try_acquire_club_lock / release_club_lock / cleanup_expired_club_locks) were left
--   PUBLIC-executable (verified live: P4 showed authenticated=true, anon=true). They are
--   SECURITY DEFINER, so any client could call them (lock DoS / probe). This tightens them
--   to service_role only — matching the fenced funcs.
--
-- CALLSITE AUDIT (required before this revoke — done 2026-06-19):
--   • try_acquire_club_lock  — NO runtime caller (process-swing now uses the fenced acquire
--     after B2.2b). Only a generated types.ts type-def. Safe.
--   • release_club_lock       — sole caller = process-swing defensive fallback, runs as
--     service_role. Safe (service_role keeps EXECUTE).
--   • cleanup_expired_club_locks — caller = pg_cron job 'cleanup-locks-pass1b', runs as the
--     scheduling role (postgres/superuser), which is unaffected by REVOKE FROM PUBLIC. Safe.
--   → No anon/authenticated/frontend caller. Revoking PUBLIC breaks nothing.
--
-- DESIGN: a DO-loop over pg_proc so ALL overloads are covered (live has 2 try_acquire_club_lock
--   overloads — drift). Idempotent. Does NOT change function bodies. Additive-security only.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Apply = separate
--   owner-gated controlled op. Rollback: docs/emergency_rollbacks/PRE_20261007_lock_legacy_grant_hardening.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $hardenB$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('try_acquire_club_lock', 'release_club_lock', 'cleanup_expired_club_locks')
  LOOP
    -- Remove the default PUBLIC grant (and any anon/authenticated grant) — service_role only.
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role;', r.proname, r.args);
    RAISE NOTICE 'lock_legacy_hardening: tightened public.%(%) → service_role only', r.proname, r.args;
  END LOOP;
END
$hardenB$;

COMMIT;
