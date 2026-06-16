-- ════════════════════════════════════════════════════════════════════════════
-- PUBLIC TRACKER — anonymous (not-logged-in) read access
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  SOURCE-ONLY — NOT APPLIED here. Owner-gated controlled apply (Management-API).
--     NO `supabase db push`, NO `deploy_db=true`, schema_migrations untouched.
--     See docs/tournament/PUBLIC_TRACKER_ANON_ROLLOUT.md.
--
-- WHY: the public live tracker (/live/:id) is meant to be PUBLIC, but every tracker
-- read table grants SELECT only TO authenticated → anonymous (not-logged-in) visitors
-- see nothing. This ADDS anon read so non-registered spectators can watch. It mirrors
-- the EXISTING "viewable by all authenticated" intent (USING(true)); hole-card
-- visibility is INTENTIONALLY public (Triton-style broadcast). Anon sees the SAME
-- rows/columns any logged-in user already sees — this only removes the login wall.
--
-- ⚠️  COLUMN EXPOSURE: anon can read all columns of these tables (same as any logged-in
--     user today). The tracker UI only displays tracker fields. If specific columns
--     (e.g. tournaments.rake_amount / free_rake_*) must be hidden from anon, that needs
--     PUBLIC VIEWS + frontend changes — a SEPARATE effort, NOT this patch.
--
-- ADDITIVE & REVERSIBLE: new anon SELECT policies + table GRANTs + 2 RPC EXECUTE
-- grants. Existing authenticated policies untouched. NO writes for anon. NO function
-- logic change. NO payroll / finance / operator impact.
--
-- ROLLBACK: docs/emergency_rollbacks/PRE_PUBLIC_TRACKER_ANON_20260919000000.sql
-- ════════════════════════════════════════════════════════════════════════════

-- Tables the public viewer reads — directly (.from) or inside the SECURITY-INVOKER
-- RPCs get_tournament_clock (tournaments, tournament_levels) and get_tournament_tables
-- (tournament_tables, game_tables).
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tournaments', 'tournament_seats', 'tournament_hands', 'hand_actions',
    'hand_players', 'tournament_prizes', 'tournament_levels', 'tournament_tables', 'game_tables'
  ] LOOP
    -- table privilege (PostgREST needs it for the anon role)
    EXECUTE format('GRANT SELECT ON public.%I TO anon', tbl);
    -- RLS policy: anon may read all rows (mirrors the existing authenticated USING(true)).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_public_anon_read', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)', tbl || '_public_anon_read', tbl);
  END LOOP;
END $$;

-- Public-viewer RPCs (SECURITY INVOKER → their internal reads use the anon policies above).
GRANT EXECUTE ON FUNCTION public.get_tournament_clock(uuid)  TO anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_tables(uuid) TO anon;
