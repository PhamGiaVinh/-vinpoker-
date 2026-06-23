-- Rollback for 20261024000000_leaderboard_public_read.sql
-- Restores the prior security context + revokes the public grants.
REVOKE EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid) FROM anon;
ALTER FUNCTION public.get_tournament_leaderboard(uuid) SECURITY INVOKER;
-- (authenticated EXECUTE is left in place — it was the pre-existing default.)
