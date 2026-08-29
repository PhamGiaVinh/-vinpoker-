-- Floor Edge handlers call this caller-bound scope RPC with the authenticated
-- user's JWT. Supabase default privileges can leave an unnecessary direct
-- service_role EXECUTE grant after CREATE FUNCTION, despite PUBLIC/anon being
-- revoked by the original migration.
--
-- ROLLBACK: only if a reviewed server-only consumer is introduced, add a new
-- forward migration that grants EXECUTE to service_role. Do not edit history.

BEGIN;

REVOKE ALL ON FUNCTION public.get_my_floor_operator_scope()
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_floor_operator_scope()
TO authenticated;

COMMIT;
