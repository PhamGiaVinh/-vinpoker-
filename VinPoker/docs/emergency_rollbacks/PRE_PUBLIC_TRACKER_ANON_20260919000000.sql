-- Rollback for 20260919000000_public_tracker_anon_read.sql
-- (Public tracker anon read — additive anon SELECT policies + GRANTs + 2 RPC EXECUTE
--  grants. No data change, no function logic change.)
--
-- Pre-apply state: none of the *_public_anon_read policies exist; anon has no SELECT
-- on these tables and no EXECUTE on the two RPCs.
--
-- VERIFY BEFORE APPLY (read-only):
--   select count(*) from pg_policies where schemaname='public'
--     and policyname like '%\_public\_anon\_read';            -- expect 0 before, 9 after
--
-- ROLLBACK (structural only — drops the anon policies + revokes the anon grants;
-- touches NO data, NO existing authenticated policies, NO function bodies):

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tournaments', 'tournament_seats', 'tournament_hands', 'hand_actions',
    'hand_players', 'tournament_prizes', 'tournament_levels', 'tournament_tables', 'game_tables'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_public_anon_read', tbl);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', tbl);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_tournament_clock(uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tournament_tables(uuid) FROM anon;

-- After rollback: the count above is 0 again, and the public /live tracker reverts to
-- authenticated-only reads (anonymous visitors see nothing, as before).
