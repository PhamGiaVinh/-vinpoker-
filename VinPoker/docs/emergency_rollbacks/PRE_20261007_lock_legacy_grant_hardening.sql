-- EMERGENCY ROLLBACK — Hardening B legacy lock-grant tightening (migration 20261007000000)
--
-- 20261007000000 only changed GRANTS (revoked PUBLIC/anon/authenticated, kept service_role) on the
-- legacy lock functions; it did NOT change any function body. Pre-apply state: these functions were
-- PUBLIC-executable (authenticated=true, anon=true, per the B2.2a dry-run P4).
--
-- The callsite audit found NO non-service-role caller, so this rollback should NOT be needed. Use it
-- ONLY if some unforeseen non-service caller breaks: it re-grants EXECUTE to PUBLIC (restores the loose
-- pre-hardening posture) for all overloads. Re-loosening a SECURITY DEFINER lock primitive — emergency only.

DO $rollback$
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
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO PUBLIC;', r.proname, r.args);
  END LOOP;
END
$rollback$;
