\set ON_ERROR_STOP on

-- Disposable PostgreSQL only: no project ref, credentials, production data or
-- linked Supabase command is used by this suite.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.app_role AS ENUM ('super_admin');

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL
);
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  name text NOT NULL DEFAULT 'TEST Tournament',
  status text NOT NULL DEFAULT 'registration',
  live_status text NOT NULL DEFAULT 'registering',
  players_remaining integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.game_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  table_name text NOT NULL,
  table_type text NOT NULL DEFAULT 'tournament',
  status text NOT NULL DEFAULT 'inactive'
);
CREATE TABLE public.tournament_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid REFERENCES public.game_tables(id),
  table_name text,
  table_number integer,
  max_seats integer NOT NULL DEFAULT 9,
  status text NOT NULL DEFAULT 'active',
  floor_control_mode text NOT NULL DEFAULT 'manual',
  floor_control_revision bigint NOT NULL DEFAULT 0,
  -- The V3 inventory contract orders historical tournament assignments by
  -- creation time. Keep the disposable schema aligned with that public read
  -- contract instead of weakening the production query for a fixture.
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  registration_id uuid,
  player_id uuid NOT NULL,
  entry_no integer NOT NULL,
  current_stack integer NOT NULL DEFAULT 0,
  table_id uuid,
  seat_id uuid,
  seat_number integer,
  seated_at timestamptz,
  busted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'registered'
);
CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  player_id uuid NOT NULL,
  entry_number integer NOT NULL DEFAULT 1,
  table_id uuid,
  seat_number integer NOT NULL,
  chip_count integer NOT NULL DEFAULT 0,
  entry_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  assigned_by uuid,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  is_voided boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hand_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  seat_number integer NOT NULL,
  starting_stack integer,
  ending_stack integer,
  is_eliminated boolean NOT NULL DEFAULT false
);
CREATE TABLE public.dealer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid,
  table_id uuid NOT NULL REFERENCES public.game_tables(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'assigned',
  released_at timestamptz
);
CREATE TABLE public.club_floors (club_id uuid NOT NULL, user_id uuid NOT NULL);
CREATE TABLE public.club_cashiers (club_id uuid NOT NULL, user_id uuid NOT NULL);
CREATE TABLE public.club_dealer_controls (club_id uuid NOT NULL, user_id uuid NOT NULL);
CREATE TABLE public.club_trackers (club_id uuid NOT NULL, user_id uuid NOT NULL);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, display_name text);
CREATE TABLE public.tournament_chip_counts (
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  chip_count integer NOT NULL,
  PRIMARY KEY (tournament_id, player_id, entry_number)
);

CREATE OR REPLACE FUNCTION public.is_club_floor(p_user_id uuid, p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_floors WHERE club_id = p_club_id AND user_id = p_user_id)
$$;
CREATE OR REPLACE FUNCTION public.is_club_dealer_control(p_user_id uuid, p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_dealer_controls WHERE club_id = p_club_id AND user_id = p_user_id)
$$;
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.floor_table_v3_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Floor Table V3 assertion failed: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_table_v3_assert_permission_denied(p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'Floor Table V3 assertion failed: expected permission denial for %', p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_table_v3_assert_json(
  p_actual jsonb,
  p_expected_error text,
  p_message text
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.floor_table_v3_assert(
    p_actual ->> 'error' IS NOT DISTINCT FROM p_expected_error,
    p_message || ': expected=' || COALESCE(p_expected_error, '<success>') ||
      ' actual=' || COALESCE(p_actual::text, '<null>')
  );
END;
$$;

-- Pre-migration fixtures deliberately model the legacy physical-table state.
-- The exact STAGE_TEST rows are cross-club contamination and must be
-- quarantined before the one real operational assignment is bridged.
INSERT INTO public.clubs (id, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333');
INSERT INTO public.tournaments (id, club_id, name, status) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'Operational Tournament', 'active'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'STAGE_TEST Tournament', 'active');
UPDATE public.tournaments
SET updated_at = '2026-06-13 03:57:08.065228+07'
WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.tournaments
SET live_status = 'running'
WHERE id = '11111111-1111-1111-1111-111111111111';
CREATE OR REPLACE FUNCTION public.validate_tournament_live_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.live_status NOT IN ('registering', 'playing', 'finished') THEN
    RAISE EXCEPTION 'Invalid live_status: %', NEW.live_status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_tournament_live_status
BEFORE UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.validate_tournament_live_status();
INSERT INTO public.game_tables (id, club_id, table_name, status) VALUES
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000010', 'Bàn 7', 'maintenance'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'TEST-T1', 'inactive'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'TEST-T2', 'inactive');
ALTER TABLE public.tournament_tables
  ADD CONSTRAINT tournament_tables_table_id_legacy_key UNIQUE (table_id);
INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, status) VALUES
  (
    '00000000-0000-0000-0000-000000000700',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000504',
    7,
    'active'
  );

INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, status) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, 'active');
INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111201', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111301', 1, 'seated', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111202', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111302', 1, 'seated', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111203', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111303', 1, 'registered', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111204', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111304', 1, 'registered', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111205', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111305', 1, 'registered', '2026-06-13 03:57:08.065228+07');
INSERT INTO public.tournament_seats (tournament_id, player_id, entry_number, table_id, seat_number, entry_id, is_active, status, created_at) VALUES
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111301', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1, '11111111-1111-1111-1111-111111111201', true, 'active', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111302', 1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 1, '11111111-1111-1111-1111-111111111202', true, 'active', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111303', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 2, '11111111-1111-1111-1111-111111111203', false, 'moved', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111304', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 3, '11111111-1111-1111-1111-111111111204', false, 'moved', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111305', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 4, '11111111-1111-1111-1111-111111111205', false, 'moved', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111301', 1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 2, '11111111-1111-1111-1111-111111111201', false, 'moved', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111302', 1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 3, '11111111-1111-1111-1111-111111111202', false, 'moved', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111303', 1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 4, '11111111-1111-1111-1111-111111111203', false, 'moved', '2026-06-13 03:57:08.065228+07'),
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111304', 1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 5, '11111111-1111-1111-1111-111111111204', false, 'moved', '2026-06-13 03:57:08.065228+07');

\ir ../../supabase/migrations/20270113000002_floor_table_control_v3_foundation.sql

\ir ../../supabase/migrations/20270112000009_floor_table_control_v3_fixture_live_status_compat.sql

SELECT public.floor_table_v3_assert(
  (SELECT live_status = 'registering' FROM public.tournaments WHERE id = '11111111-1111-1111-1111-111111111111'),
  'stale STAGE_TEST live status is normalized before bridge quarantine'
);

INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, current_stack, status) VALUES
  ('00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000911', 1, 40000, 'seated');
-- The identity bridge must support a current legacy table with two active
-- seats that predate entry-backed registrations. Their seat/player/chip
-- fields, the in-progress hand and hand_players are all immutable here.
INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, entry_id, is_active, status) VALUES
  ('00000000-0000-0000-0000-000000000721', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000911', 1, '00000000-0000-0000-0000-000000000700', 5, 40000, '00000000-0000-0000-0000-000000000711', true, 'active'),
  ('00000000-0000-0000-0000-000000000722', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000912', 1, '00000000-0000-0000-0000-000000000700', 1, 50000, NULL, true, 'active'),
  ('00000000-0000-0000-0000-000000000723', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000913', 1, '00000000-0000-0000-0000-000000000700', 2, 60000, NULL, true, 'active');
INSERT INTO public.tournament_hands (id, tournament_id, table_id, status, is_voided) VALUES
  ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000700', 'in_progress', false);
INSERT INTO public.hand_players (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack) VALUES
  ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000911', 1, 5, 40000, 40000),
  ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000912', 1, 1, 50000, 50000),
  ('00000000-0000-0000-0000-000000000950', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000913', 1, 2, 60000, 60000);
INSERT INTO public.dealer_assignments (id, club_id, table_id, status, released_at) VALUES
  ('00000000-0000-0000-0000-000000000960', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000504', 'assigned', null);

\ir ../../supabase/migrations/20270113000010_floor_table_control_v3_final_live_bridge.sql

SELECT public.floor_table_v3_assert(
  (SELECT status = 'cancelled' AND deleted_at IS NOT NULL FROM public.tournaments WHERE id = '11111111-1111-1111-1111-111111111111')
  AND (SELECT count(*) = 2 FROM public.tournament_tables WHERE id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd') AND status = 'closed')
  AND (SELECT count(*) = 2 FROM public.game_tables WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AND club_id = '33333333-3333-3333-3333-333333333333')
  AND (SELECT count(*) = 5 FROM public.tournament_entries WHERE tournament_id = '11111111-1111-1111-1111-111111111111')
  AND (SELECT count(*) = 9 FROM public.tournament_seats WHERE tournament_id = '11111111-1111-1111-1111-111111111111'),
  'STAGE_TEST fixture is quarantined without mutating foreign physical tables'
);
SELECT public.floor_table_v3_assert(
  (SELECT game_table_id = '00000000-0000-0000-0000-000000000504' AND table_session_id IS NOT NULL FROM public.tournament_tables WHERE id = '00000000-0000-0000-0000-000000000700')
  AND (SELECT count(*) = 3 FROM public.tournament_seats WHERE tournament_id = '00000000-0000-0000-0000-000000000100' AND tournament_table_id = '00000000-0000-0000-0000-000000000700' AND table_session_id IS NOT NULL)
  AND (SELECT count(*) = 1 FROM public.tournament_seats WHERE id = '00000000-0000-0000-0000-000000000721' AND player_id = '00000000-0000-0000-0000-000000000911' AND entry_number = 1 AND table_id = '00000000-0000-0000-0000-000000000700' AND seat_number = 5 AND chip_count = 40000 AND entry_id = '00000000-0000-0000-0000-000000000711' AND is_active AND status = 'active')
  AND (SELECT count(*) = 2 FROM public.tournament_seats WHERE id IN ('00000000-0000-0000-0000-000000000722', '00000000-0000-0000-0000-000000000723') AND entry_id IS NULL AND table_id = '00000000-0000-0000-0000-000000000700' AND ((id = '00000000-0000-0000-0000-000000000722' AND player_id = '00000000-0000-0000-0000-000000000912' AND seat_number = 1 AND chip_count = 50000) OR (id = '00000000-0000-0000-0000-000000000723' AND player_id = '00000000-0000-0000-0000-000000000913' AND seat_number = 2 AND chip_count = 60000)))
  AND (SELECT status = 'in_progress' AND tournament_table_id = '00000000-0000-0000-0000-000000000700' AND table_session_id IS NOT NULL FROM public.tournament_hands WHERE id = '00000000-0000-0000-0000-000000000950')
  AND (SELECT count(*) = 3 FROM public.hand_players WHERE hand_id = '00000000-0000-0000-0000-000000000950')
  AND (SELECT count(*) = 3 FROM public.hand_players WHERE hand_id = '00000000-0000-0000-0000-000000000950' AND ((player_id = '00000000-0000-0000-0000-000000000911' AND entry_number = 1 AND seat_number = 5 AND starting_stack = 40000 AND ending_stack = 40000 AND is_eliminated = false) OR (player_id = '00000000-0000-0000-0000-000000000912' AND entry_number = 1 AND seat_number = 1 AND starting_stack = 50000 AND ending_stack = 50000 AND is_eliminated = false) OR (player_id = '00000000-0000-0000-0000-000000000913' AND entry_number = 1 AND seat_number = 2 AND starting_stack = 60000 AND ending_stack = 60000 AND is_eliminated = false)))
  AND (SELECT status = 'assigned' AND table_session_id IS NOT NULL FROM public.dealer_assignments WHERE id = '00000000-0000-0000-0000-000000000960'),
  'identity bridge links legacy seats without changing orphan fields, hand or hand players'
);

\ir ../../supabase/migrations/20270113000011_floor_table_control_v3_final_contract.sql

DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  v_result := public.floor_bust_player_v3(
    '00000000-0000-0000-0000-000000000722', 0, 0, 50000,
    '00000000-0000-0000-0000-000000000952', 'legacy_orphan_must_not_mutate'
  );
  PERFORM public.floor_table_v3_assert_json(
    v_result, 'entry_not_found', 'legacy orphan cannot be mutated by entry-backed V3 bust writer'
  );
  PERFORM public.floor_table_v3_assert(
    (SELECT is_active AND status = 'active' AND entry_id IS NULL FROM public.tournament_seats WHERE id = '00000000-0000-0000-0000-000000000722'),
    'entry-backed V3 writer leaves legacy orphan untouched'
  );
END;
$$;

INSERT INTO public.tournaments (id, club_id) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000020');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000010', 'Bàn 5', 5, 'available'),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000010', 'Bàn 6', 6, 'available'),
  ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000010', 'Bàn 8', 8, 'available'),
  ('00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000010', 'Bàn 9', 9, 'available'),
  ('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000010', 'Bàn 10', 10, 'available'),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000020', 'Bàn 5', 5, 'available');
INSERT INTO public.club_floors (club_id, user_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.club_dealer_controls (club_id, user_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.game_tables (club_id, table_name, table_number)
    VALUES ('00000000-0000-0000-0000-000000000010', 'Bàn 5 trùng', 5);
    RAISE EXCEPTION 'expected same-club table number constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.game_tables (club_id, table_name, table_number)
    VALUES ('00000000-0000-0000-0000-000000000010', 'Bàn 101', 101);
    RAISE EXCEPTION 'expected table number range constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO public.table_sessions (
  id, club_id, game_table_id, session_type, tournament_id, control_mode, control_epoch
) VALUES (
  '00000000-0000-0000-0000-000000000601',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000501',
  'tournament',
  '00000000-0000-0000-0000-000000000100',
  'tracker',
  7
);
INSERT INTO public.tournament_tables (
  id, tournament_id, table_id, game_table_id, table_session_id, table_number
) VALUES (
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000601',
  5
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.table_sessions (
      id, club_id, game_table_id, session_type, tournament_id, control_mode, control_epoch
    ) VALUES (
      '00000000-0000-0000-0000-000000000603',
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000503',
      'tournament',
      '00000000-0000-0000-0000-000000000100',
      'manual',
      1
    );
    INSERT INTO public.tournament_tables (
      tournament_id, game_table_id, table_session_id, table_number
    ) VALUES (
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000501',
      '00000000-0000-0000-0000-000000000603',
      6
    );
    RAISE EXCEPTION 'expected session/game-table pairing constraint';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.table_sessions (club_id, game_table_id, session_type, tournament_id)
    VALUES (
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000501',
      'cash',
      NULL
    );
    RAISE EXCEPTION 'expected active session lease constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO public.profiles (user_id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000901', 'Entry One'),
  ('00000000-0000-0000-0000-000000000902', 'Entry Two'),
  ('00000000-0000-0000-0000-000000000903', 'Entry Three'),
  ('00000000-0000-0000-0000-000000000904', 'Entry Four');
INSERT INTO public.tournament_entries (
  id, tournament_id, registration_id, player_id, entry_no, current_stack, status
) VALUES
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000901', 1, 30000, 'seated'),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000902', 2, 30000, 'seated');
INSERT INTO public.tournament_seats (
  id, tournament_id, player_id, entry_number, table_id, tournament_table_id, table_session_id,
  seat_number, chip_count, entry_id, is_active
) VALUES (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000901',
  1,
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000601',
  1,
  30000,
  '00000000-0000-0000-0000-000000000801',
  true
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, tournament_table_id, table_session_id,
      seat_number, chip_count, entry_id, is_active
    ) VALUES (
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000902',
      2,
      '00000000-0000-0000-0000-000000000701',
      '00000000-0000-0000-0000-000000000601',
      1,
      30000,
      '00000000-0000-0000-0000-000000000802',
      true
    );
    RAISE EXCEPTION 'expected active explicit seat constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, tournament_table_id, table_session_id,
      seat_number, chip_count, entry_id, is_active
    ) VALUES (
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000901',
      1,
      '00000000-0000-0000-0000-000000000701',
      '00000000-0000-0000-0000-000000000601',
      2,
      30000,
      '00000000-0000-0000-0000-000000000801',
      true
    );
    RAISE EXCEPTION 'expected active entry constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

UPDATE public.tournament_seats
SET is_active = false
WHERE id = '00000000-0000-0000-0000-000000000901';
UPDATE public.table_sessions
SET closed_at = now(), closed_by = '00000000-0000-0000-0000-000000000001'
WHERE id = '00000000-0000-0000-0000-000000000601';

INSERT INTO public.table_sessions (
  id, club_id, game_table_id, session_type, tournament_id, control_mode, control_epoch
) VALUES (
  '00000000-0000-0000-0000-000000000602',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000501',
  'tournament',
  '00000000-0000-0000-0000-000000000101',
  'manual',
  1
);

INSERT INTO public.tournament_tables (
  id, tournament_id, game_table_id, table_session_id, table_number, max_seats, status
) VALUES (
  '00000000-0000-0000-0000-000000000702',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000602',
  5,
  9,
  'active'
);

SELECT public.floor_table_v3_assert(
  (SELECT table_id IS NULL FROM public.tournament_tables WHERE id = '00000000-0000-0000-0000-000000000702'),
  'V3 assignment does not write legacy tournament_tables.table_id'
);

SELECT public.floor_table_v3_assert(
  (SELECT count(*) = 2 FROM public.table_sessions WHERE game_table_id = '00000000-0000-0000-0000-000000000501')
  AND (SELECT count(*) = 1 FROM public.table_sessions WHERE game_table_id = '00000000-0000-0000-0000-000000000501' AND closed_at IS NULL),
  'closing preserves history and allows exactly one new active session'
);

-- RLS/ACL proof: a browser role cannot read or write the private session and
-- receipt tables, even when it holds a valid Floor membership.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT public.floor_table_v3_assert_permission_denied('SELECT * FROM public.table_sessions');
SELECT public.floor_table_v3_assert_permission_denied(
  $$INSERT INTO public.table_operation_receipts
    (actor_id, operation_type, request_id, request_fingerprint, result)
    VALUES
    ('00000000-0000-0000-0000-000000000002', 'fixture', '00000000-0000-0000-0000-000000000950', 'x', '{}'::jsonb)$$
);
SELECT public.floor_table_v3_assert_permission_denied(
  $$SELECT public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000507',
    'manual',
    '00000000-0000-0000-0000-000000000951'
  )$$
);
COMMIT;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
SELECT public.floor_table_v3_assert(
  (SELECT count(*) = 0 FROM public.get_floor_table_v3_preflight('00000000-0000-0000-0000-000000000010')),
  'unrelated actor receives no cross-club preflight metadata'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SELECT public.floor_table_v3_assert(
  EXISTS (
    SELECT 1 FROM public.get_floor_table_v3_preflight('00000000-0000-0000-0000-000000000010')
    WHERE finding_code = 'LEGACY_OPERATIONAL_STATUS_UNMAPPED'
  ),
  'legacy maintenance remains unmapped and cannot be treated as available'
);
SELECT public.floor_table_v3_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.tournament_tables'::regclass
      AND c.contype = 'u'
      AND ARRAY(
        SELECT a.attname
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = ANY(c.conkey)
        ORDER BY a.attnum
      ) = ARRAY['table_id']::name[]
  ),
  'catalog-targeted transition removes only the legacy permanent table_id uniqueness'
);

BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT public.floor_table_v3_assert(
  EXISTS (
    SELECT 1 FROM public.get_floor_table_v3_preflight('00000000-0000-0000-0000-000000000010')
  ),
  'Floor membership can execute caller-bound preflight'
);
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT public.floor_table_v3_assert(
  EXISTS (
    SELECT 1 FROM public.get_floor_table_v3_preflight('00000000-0000-0000-0000-000000000010')
  ),
  'Dealer Control membership can execute caller-bound preflight'
);
COMMIT;

-- Server-authoritative V3 lifecycle: the owner opens two physical tables,
-- changes the second to Tracker, seats/moves entries, applies tracker
-- fencing, bust/restore rules, breaks a table, and reuses the released
-- physical table for another tournament.  No legacy table_id is written.
-- The bridged historical hand above is intentionally in progress to prove
-- exact-ID linkage. Complete it before this independent break-table scenario:
-- V3 correctly refuses to redistribute a table while any destination hand is
-- still active.
UPDATE public.tournament_hands
SET status = 'completed'
WHERE id = '00000000-0000-0000-0000-000000000950';

INSERT INTO public.profiles (user_id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000905', 'Entry Five'),
  ('00000000-0000-0000-0000-000000000906', 'Entry Six');
INSERT INTO public.tournament_entries (
  id, tournament_id, registration_id, player_id, entry_no, current_stack, status
) VALUES
  ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000903', 3, 30000, 'registered'),
  ('00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000904', 4, 30000, 'registered'),
  ('00000000-0000-0000-0000-000000000805', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000905', 5, 30000, 'registered'),
  ('00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000906', 6, 30000, 'registered');
INSERT INTO public.club_trackers (club_id, user_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000004');

DO $$
DECLARE
  v_manual_open jsonb;
  v_repeat jsonb;
  v_tracker_open jsonb;
  v_result jsonb;
  v_manual_table_id uuid;
  v_manual_session_id uuid;
  v_tracker_table_id uuid;
  v_tracker_session_id uuid;
  v_old_tracker_table_id uuid;
  v_old_tracker_session_id uuid;
  v_reopened_session_id uuid;
  v_cash_session_id uuid;
  v_tracker_epoch bigint;
  v_tracker_revision bigint;
  v_manual_revision bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

  v_manual_open := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000503',
    'manual',
    '00000000-0000-0000-0000-000000001001'
  );
  PERFORM public.floor_table_v3_assert((v_manual_open ->> 'ok')::boolean, 'owner can open a same-club physical tournament table');
  v_manual_table_id := (v_manual_open ->> 'tournament_table_id')::uuid;
  v_manual_session_id := (v_manual_open ->> 'table_session_id')::uuid;
  PERFORM public.floor_table_v3_assert(
    (SELECT table_id IS NULL FROM public.tournament_tables WHERE id = v_manual_table_id),
    'V3 floor writer never writes legacy tournament_tables.table_id'
  );

  v_repeat := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000503',
    'manual',
    '00000000-0000-0000-0000-000000001001'
  );
  PERFORM public.floor_table_v3_assert(v_repeat = v_manual_open, 'same idempotency request returns the original open result');
  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000505',
    'manual',
    '00000000-0000-0000-0000-000000001001'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'IDEMPOTENCY_CONFLICT', 'same request id with a different payload is rejected');

  v_tracker_open := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000505',
    'manual',
    '00000000-0000-0000-0000-000000001002'
  );
  PERFORM public.floor_table_v3_assert((v_tracker_open ->> 'ok')::boolean, 'owner can open a second physical table for the tournament');
  v_tracker_table_id := (v_tracker_open ->> 'tournament_table_id')::uuid;
  v_tracker_session_id := (v_tracker_open ->> 'table_session_id')::uuid;
  v_result := public.floor_set_table_control_mode_v3(
    v_tracker_table_id, 'tracker', 1, '00000000-0000-0000-0000-000000001003'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean AND (v_result ->> 'control_epoch')::bigint = 2, 'empty table mode change advances the fencing epoch');
  v_tracker_epoch := (v_result ->> 'control_epoch')::bigint;
  v_tracker_revision := (v_result ->> 'revision')::bigint;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
  v_result := public.validate_tracker_table_writer_context_v3(
    '00000000-0000-0000-0000-000000000100', v_tracker_table_id, v_tracker_session_id, 1
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'STALE_TRACKER_CONTEXT', 'pre-mode-change Tracker context is fenced');
  v_result := public.validate_tracker_table_writer_context_v3(
    '00000000-0000-0000-0000-000000000100', v_tracker_table_id, v_tracker_session_id, v_tracker_epoch
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'current Tracker context is accepted for the active session only');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000803', v_manual_table_id, 1, 1, '00000000-0000-0000-0000-000000001004'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'registered entry can be seated through the V3 entry picker contract');
  v_manual_revision := (v_result ->> 'revision')::bigint;
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000804', v_manual_table_id, 2, v_manual_revision, '00000000-0000-0000-0000-000000001005'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'second registered entry can occupy a different V3 seat');
  v_manual_revision := (v_result ->> 'revision')::bigint;
  v_result := public.floor_set_table_control_mode_v3(
    v_manual_table_id, 'tracker', v_manual_revision, '00000000-0000-0000-0000-000000001006'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'table_not_empty', 'mode switch is blocked while the roster is non-empty');
  v_result := public.close_tournament_table_v3(
    v_manual_table_id, v_manual_revision, '00000000-0000-0000-0000-000000001007'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'table_not_empty', 'narrow close cannot silently move or orphan seated entries');

  v_result := public.move_player_seat_v2(
    '00000000-0000-0000-0000-000000000803', v_tracker_table_id, 1,
    v_manual_revision, v_tracker_revision, '00000000-0000-0000-0000-000000001008'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'move uses source/destination sessions and revisions');
  v_manual_revision := (v_result ->> 'source_revision')::bigint;
  v_tracker_revision := (v_result ->> 'destination_revision')::bigint;
  PERFORM public.floor_table_v3_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tournament_seats
      WHERE entry_id = '00000000-0000-0000-0000-000000000803'
        AND tournament_table_id = v_manual_table_id AND is_active
    ) AND EXISTS (
      SELECT 1 FROM public.tournament_seats
      WHERE entry_id = '00000000-0000-0000-0000-000000000803'
        AND tournament_table_id = v_tracker_table_id AND is_active
    ),
    'move leaves no ghost seat in the former table'
  );

  INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
  VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000903', 3, 30000);
  v_result := public.floor_bust_player_v3(
    '00000000-0000-0000-0000-000000000803', v_tracker_revision, v_tracker_epoch, 30000,
    '00000000-0000-0000-0000-000000001009', 'fixture_tracker_nonzero'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'player_has_chips', 'Tracker bust requires an authoritative zero chip count');
  UPDATE public.tournament_chip_counts SET chip_count = 0
  WHERE tournament_id = '00000000-0000-0000-0000-000000000100'
    AND player_id = '00000000-0000-0000-0000-000000000903' AND entry_number = 3;
  UPDATE public.tournament_seats SET chip_count = 0
  WHERE entry_id = '00000000-0000-0000-0000-000000000803' AND is_active;
  v_result := public.floor_bust_player_v3(
    '00000000-0000-0000-0000-000000000803', v_tracker_revision, v_tracker_epoch, 0,
    '00000000-0000-0000-0000-000000001010', 'fixture_tracker_zero'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean AND (v_result ->> 'payout_applied')::boolean = false, 'Tracker bust at zero is server-authoritative and never pays out');
  v_tracker_revision := (v_result ->> 'revision')::bigint;

  v_result := public.floor_bust_player_v3(
    '00000000-0000-0000-0000-000000000804', v_manual_revision, 1, 30000,
    '00000000-0000-0000-0000-000000001011', 'fixture_manual_override'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean AND (v_result ->> 'manual_nonzero_chip_override')::boolean, 'Manual Floor bust records a non-zero-chip audit override without payout');
  v_manual_revision := (v_result ->> 'revision')::bigint;
  v_result := public.floor_restore_busted_player_to_seat_v3(
    '00000000-0000-0000-0000-000000000804', v_manual_table_id, 2, v_manual_revision, 1,
    '00000000-0000-0000-0000-000000001012'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'only a busted entry can be restored to an active explicit session');
  v_manual_revision := (v_result ->> 'revision')::bigint;

  INSERT INTO public.dealer_assignments (table_id, table_session_id, status)
  VALUES ('00000000-0000-0000-0000-000000000503', v_manual_session_id, 'assigned');
  v_result := public.floor_break_table_v3(
    v_manual_table_id, v_manual_revision, '00000000-0000-0000-0000-000000001013', 'fill_lowest_table'
  );
  PERFORM public.floor_table_v3_assert(
    (v_result ->> 'ok')::boolean AND (v_result ->> 'moved_count')::integer = 1,
    'break atomically moves the active roster before closing its source session: result=' || v_result::text
  );
  PERFORM public.floor_table_v3_assert(
    (SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id = v_manual_session_id)
    AND (SELECT released_at IS NOT NULL FROM public.dealer_assignments WHERE table_session_id = v_manual_session_id),
    'break ends the dealer assignment and session history together'
  );
  BEGIN
    INSERT INTO public.dealer_assignments (table_id, table_session_id, status)
    VALUES ('00000000-0000-0000-0000-000000000503', v_manual_session_id, 'assigned');
    RAISE EXCEPTION 'expected V3 dealer assignment guard for a closed session';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'floor_table_v3_dealer_assignment_session_not_active' THEN
      RAISE;
    END IF;
  END;

  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000503',
    'manual',
    '00000000-0000-0000-0000-000000001014'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'a released physical table can be used by another tournament');
  v_reopened_session_id := (v_result ->> 'table_session_id')::uuid;
  PERFORM public.floor_table_v3_assert(v_reopened_session_id <> v_manual_session_id, 'same physical table reuse always creates a new session identity');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  v_result := public.operator_open_club_tables_v2(
    ARRAY['00000000-0000-0000-0000-000000000507']::uuid[], 'cash', '00000000-0000-0000-0000-000000001015'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'Dealer Control opens Cash through the shared physical-table lease');
  v_cash_session_id := (v_result -> 'sessions' -> 0 ->> 'table_session_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000507',
    'manual',
    '00000000-0000-0000-0000-000000001016'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'game_table_in_use', 'Floor cannot create a second use while Dealer Swing holds the physical table');
  INSERT INTO public.dealer_assignments (table_id, table_session_id, status)
  VALUES ('00000000-0000-0000-0000-000000000507', v_cash_session_id, 'assigned');
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  v_result := public.operator_close_club_table_v2(
    v_cash_session_id, 1, '00000000-0000-0000-0000-000000001017'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'Dealer Control close releases its Cash lease through the same session contract');
  PERFORM public.floor_table_v3_assert(
    (SELECT released_at IS NOT NULL FROM public.dealer_assignments WHERE table_session_id = v_cash_session_id),
    'Cash close ends the active dealer assignment rather than deleting history'
  );

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000506',
    'tracker',
    '00000000-0000-0000-0000-000000001018'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'Tracker session can open on another available physical table');
  v_old_tracker_table_id := (v_result ->> 'tournament_table_id')::uuid;
  v_old_tracker_session_id := (v_result ->> 'table_session_id')::uuid;
  v_result := public.close_tournament_table_v3(
    v_old_tracker_table_id, 1, '00000000-0000-0000-0000-000000001019'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'empty Tracker session closes cleanly');

  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000506',
    'tracker',
    '00000000-0000-0000-0000-000000001020'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'the same physical table can reopen only as a new session');
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
  v_result := public.validate_tracker_table_writer_context_v3(
    '00000000-0000-0000-0000-000000000100', v_old_tracker_table_id, v_old_tracker_session_id, 1
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'STALE_TRACKER_CONTEXT', 'Tracker request from a closed session is fenced after physical-table reuse');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000502',
    'manual',
    '00000000-0000-0000-0000-000000001021'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'game_table_scope_mismatch', 'authenticated Floor cannot open another club physical table');
END;
$$;

SELECT 'FLOOR_TABLE_CONTROL_V3_SERVER_CONTRACT_DISPOSABLE_PASS' AS result;
