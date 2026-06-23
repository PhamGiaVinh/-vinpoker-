-- Make the read-only get_tournament_leaderboard RPC callable by the PUBLIC viewer.
-- The viewer's Payouts ("Giải thưởng") tab wants to show finisher NAMES + the
-- Champion, but the RPC reads tournament_eliminations (not anon-readable) and runs
-- SECURITY INVOKER, so anon currently gets players with no finish position. Switch
-- it to SECURITY DEFINER (read-only; its output — names / chips / finish positions /
-- prizes — is already shown publicly) + grant EXECUTE to anon & authenticated.
--
-- SOURCE-ONLY: apply via the controlled Management-API path (dry-run BEGIN/ROLLBACK
-- first), NOT `db push`. No table/data change; only the function's security context
-- + grants. schema_migrations untouched.

ALTER FUNCTION public.get_tournament_leaderboard(uuid) SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid) TO anon, authenticated;
