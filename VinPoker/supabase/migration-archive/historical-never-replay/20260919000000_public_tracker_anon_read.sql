-- ════════════════════════════════════════════════════════════════════════════
-- PUBLIC TRACKER — public read for EVERYONE (anonymous + all authenticated)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  SOURCE-ONLY — NOT APPLIED here. Owner-gated controlled apply (Management-API).
--     NO `supabase db push`, NO `deploy_db=true`, schema_migrations untouched.
--     See docs/tournament/PUBLIC_TRACKER_ANON_ROLLOUT.md.
--
-- WHY: the public live tracker (/live/:id) is meant to be PUBLIC, but the tracker
-- read tables blocked two groups: (1) anonymous (not-logged-in) had no anon policy
-- at all; (2) some tables (notably `tournaments` + `game_tables`) restrict the
-- `authenticated` role to CLUB members/owner — so a registered NON-owner user (any
-- normal account) also saw nothing, while only the club owner did. This ADDS a
-- permissive SELECT policy `TO anon, authenticated USING(true)` on every tracker
-- read table so EVERY viewer (logged-out, registered, owner) can watch. Hole-card
-- visibility is INTENTIONALLY public (Triton-style broadcast). Everyone sees the
-- SAME rows/columns — this only removes the read wall on the public tracker tables.
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
    -- table privilege (PostgREST needs it for both roles)
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', tbl);
    -- RLS policy: any viewer (anon OR authenticated) may read all rows. This is a
    -- PERMISSIVE policy (OR'd with existing ones) — it does not weaken any other
    -- table; it guarantees the public tracker is readable by everyone.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_public_anon_read', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', tbl || '_public_anon_read', tbl);
  END LOOP;
END $$;

-- Public-viewer RPCs (SECURITY INVOKER → their internal reads use the policies above).
GRANT EXECUTE ON FUNCTION public.get_tournament_clock(uuid)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_tables(uuid) TO anon, authenticated;
