\set ON_ERROR_STOP on
-- Minimal PostgreSQL 17 fixture: tests the new close fences without touching live data.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA floor_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.clubs(id uuid PRIMARY KEY, owner_id uuid);
CREATE TABLE public.club_cashiers(club_id uuid, user_id uuid);
CREATE TABLE public.dealer_shifts(id uuid PRIMARY KEY, club_id uuid, closed_at timestamptz);
CREATE TABLE public.game_tables(
  id uuid PRIMARY KEY, club_id uuid, status text, shift_id uuid
);
CREATE TABLE public.table_sessions(
  id uuid PRIMARY KEY, game_table_id uuid, tournament_id uuid, closed_at timestamptz
);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid, status text);
CREATE TABLE public.tournament_tables(
  id uuid PRIMARY KEY, tournament_id uuid, game_table_id uuid, table_id uuid, status text
);
CREATE TABLE public.tournament_seats(
  id uuid PRIMARY KEY, tournament_id uuid, tournament_table_id uuid, table_id uuid,
  is_active boolean
);
CREATE TABLE public.tournament_hands(
  id uuid PRIMARY KEY, tournament_id uuid, table_session_id uuid,
  tournament_table_id uuid, table_id uuid, status text, is_voided boolean
);
CREATE TABLE public.floor_pending_tracker_moves(
  id uuid PRIMARY KEY, tournament_id uuid, source_table_session_id uuid,
  destination_table_session_id uuid, status text
);
CREATE TABLE public.dealer_assignments(
  id uuid PRIMARY KEY, table_session_id uuid, table_id uuid, released_at timestamptz
);
CREATE TABLE public.dealer_swing_archives(
  id uuid PRIMARY KEY, tour_id uuid, club_id uuid
);
CREATE TABLE public.tournament_close_report(id uuid PRIMARY KEY, tournament_id uuid);
CREATE TABLE public.tournament_registrations(
  tournament_id uuid, status text, buy_in bigint, total_pay bigint
);
CREATE TABLE public.tournament_eliminations(tournament_id uuid, prize bigint);

CREATE FUNCTION public.is_club_dealer_control(p_actor uuid, p_club uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club AND owner_id = p_actor)
$$;

\ir ../../supabase/migrations/20270128000012_felt_lifecycle_close_guards_v1.sql

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_dealer_tour_close_readiness_v1(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_tournament_close_readiness_v1(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_tournament_close_readiness_v1(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'readiness ACL mismatch';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
INSERT INTO public.clubs VALUES
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
INSERT INTO public.dealer_shifts VALUES
  ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',NULL);
INSERT INTO public.tournaments VALUES
  ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','live');
INSERT INTO public.game_tables VALUES
  ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000010',
   'active','00000000-0000-0000-0000-000000000020');
INSERT INTO public.table_sessions VALUES
  ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000040',
   '00000000-0000-0000-0000-000000000030',NULL);
INSERT INTO public.tournament_tables VALUES
  ('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000040','active');
INSERT INTO public.tournament_seats VALUES
  ('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-000000000060',NULL,true);
INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000060',
   NULL,'in_progress',false);
INSERT INTO public.floor_pending_tracker_moves VALUES
  ('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000050','pending');
INSERT INTO public.dealer_assignments VALUES
  ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-000000000050',
   '00000000-0000-0000-0000-000000000040',NULL);
INSERT INTO public.tournament_registrations VALUES
  ('00000000-0000-0000-0000-000000000030','confirmed',2000000,0);

DO $$
DECLARE v_tour jsonb; v_tournament jsonb;
BEGIN
  v_tour := public.get_dealer_tour_close_readiness_v1(
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000010');
  v_tournament := public.get_tournament_close_readiness_v1(
    '00000000-0000-0000-0000-000000000030');
  IF (v_tour->>'ready')::boolean OR (v_tournament->>'ready')::boolean
    OR NOT (v_tour->'blockers' ? 'open_table_session')
    OR NOT (v_tour->'blockers' ? 'active_hand')
    OR NOT (v_tournament->'blockers' ? 'pending_move')
    OR (v_tournament->>'club_revenue')::bigint <> -2000000
    OR (v_tournament->>'reconciled')::boolean THEN
    RAISE EXCEPTION 'active lifecycle or financial preview was not fenced';
  END IF;
  BEGIN
    INSERT INTO public.dealer_swing_archives VALUES (
      '00000000-0000-0000-0000-0000000000b0',
      '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000010');
    RAISE EXCEPTION 'archive unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'floor_tour_close_blocked' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.game_tables SET status='inactive'
    WHERE id='00000000-0000-0000-0000-000000000040';
    RAISE EXCEPTION 'deactivation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'open_table_session' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.tournament_close_report VALUES (
      '00000000-0000-0000-0000-0000000000c0',
      '00000000-0000-0000-0000-000000000030');
    RAISE EXCEPTION 'report unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'floor_tournament_close_blocked' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE public.tournament_seats SET is_active=false;
UPDATE public.tournament_hands SET status='completed';
UPDATE public.floor_pending_tracker_moves SET status='cancelled';
UPDATE public.dealer_assignments SET released_at=now();
UPDATE public.tournament_tables SET status='closed';
UPDATE public.table_sessions SET closed_at=now();

DO $$
DECLARE v_tour jsonb; v_tournament jsonb;
BEGIN
  v_tour := public.get_dealer_tour_close_readiness_v1(
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000010');
  v_tournament := public.get_tournament_close_readiness_v1(
    '00000000-0000-0000-0000-000000000030');
  IF NOT (v_tour->>'ready')::boolean OR NOT (v_tournament->>'ready')::boolean
    OR (v_tournament->>'reconcile_delta')::bigint <> 2000000 THEN
    RAISE EXCEPTION 'closed lifecycle readiness mismatch';
  END IF;
END;
$$;
INSERT INTO public.dealer_swing_archives VALUES (
  '00000000-0000-0000-0000-0000000000b0',
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000010');
UPDATE public.game_tables SET status='inactive',shift_id=NULL;
INSERT INTO public.tournament_close_report VALUES (
  '00000000-0000-0000-0000-0000000000c0',
  '00000000-0000-0000-0000-000000000030');
