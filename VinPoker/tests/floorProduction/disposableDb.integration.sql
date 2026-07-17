\set ON_ERROR_STOP on

-- Disposable PostgreSQL fixture only. It deliberately has no project ref,
-- application credentials, production data, or production connection string.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL
);

CREATE TABLE public.club_cashiers (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE TABLE public.club_floors (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_club_floor(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_floors
    WHERE club_id = _club_id AND user_id = _user_id
  );
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text
);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  status text NOT NULL,
  starting_stack integer,
  current_level integer,
  clock_started_at timestamptz,
  clock_paused_at timestamptz,
  pause_accumulated integer DEFAULT 0,
  players_remaining integer DEFAULT 0,
  current_players integer DEFAULT 0,
  rake_amount bigint DEFAULT 0,
  service_fee_amount bigint DEFAULT 0,
  prize_pool jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.game_tables (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  table_name text NOT NULL,
  table_type text,
  status text,
  current_blind_level integer
);

CREATE TABLE public.tournament_tables (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  table_id uuid,
  table_number integer,
  max_seats integer,
  status text,
  table_name text
);

CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  registration_id uuid,
  player_id uuid NOT NULL,
  entry_no integer NOT NULL,
  source text,
  status text NOT NULL,
  current_stack integer NOT NULL,
  table_id uuid,
  seat_id uuid,
  seat_number integer,
  seated_at timestamptz,
  busted_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  table_id uuid,
  seat_number integer NOT NULL,
  chip_count integer NOT NULL,
  is_active boolean NOT NULL,
  player_name text,
  entry_id uuid,
  status text NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz
);
CREATE UNIQUE INDEX tournament_seats_active_seat_idx
  ON public.tournament_seats (tournament_id, table_id, seat_number)
  WHERE is_active;

CREATE TABLE public.seat_draw_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  registration_id uuid,
  entry_id uuid,
  player_id uuid,
  display_name text,
  table_id uuid,
  table_number integer,
  seat_id uuid,
  seat_number integer,
  receipt_code text UNIQUE,
  qr_payload jsonb,
  draw_type text,
  status text,
  issued_by uuid,
  cancelled_at timestamptz
);

CREATE TABLE public.seat_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  entry_id uuid,
  player_id uuid,
  from_table_id uuid,
  from_table_number integer,
  from_seat_number integer,
  to_table_id uuid,
  to_table_number integer,
  to_seat_number integer,
  reason text,
  draw_type text,
  actor_user_id uuid,
  metadata jsonb
);

CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.hand_players (
  hand_id uuid NOT NULL,
  player_id uuid NOT NULL
);

CREATE TABLE public.tournament_close_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL UNIQUE,
  club_id uuid,
  closed_by uuid,
  entry_count integer,
  buy_in_total bigint,
  cash_in_total bigint,
  club_revenue bigint,
  prize_total bigint,
  cashier_balance bigint,
  reconcile_delta bigint,
  reconciled boolean,
  detail jsonb,
  reason text
);

CREATE TABLE public.tournament_prize_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL
);

CREATE TABLE public.tournament_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  status text NOT NULL,
  buy_in bigint DEFAULT 0,
  total_pay bigint DEFAULT 0
);

CREATE TABLE public.tournament_eliminations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  prize bigint DEFAULT 0
);

CREATE TABLE public.tournament_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  level_number integer NOT NULL,
  duration_minutes integer DEFAULT 20
);

CREATE TABLE public.tournament_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  previous_state text NOT NULL,
  new_state text NOT NULL,
  changed_by uuid,
  reason text
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid,
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.release_dealer_from_table(uuid)
RETURNS void
LANGUAGE sql
AS $$ SELECT; $$;

CREATE OR REPLACE FUNCTION public.floor_test_assert(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'floor disposable DB assertion failed: %', message;
  END IF;
END;
$$;

\ir ../../supabase/migrations/20261240000000_floor_production_hardening.sql
\ir ../../supabase/migrations/20261241000000_floor_clock_start_atomic.sql

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO public.clubs (id, owner_id)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001');

INSERT INTO public.tournaments (id, club_id, status, starting_stack, current_level, players_remaining, current_players)
VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'registration', 100, 1, 4, 4);

INSERT INTO public.game_tables (id, club_id, table_name, table_type, status, current_blind_level)
VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000010', 'Bàn 1', 'tournament', 'active', 1),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000010', 'Bàn 2', 'tournament', 'active', 1);

INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status, table_name)
VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000201', 1, 9, 'active', 'Bàn 1'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000202', 2, 9, 'active', 'Bàn 2');

INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack, table_id, seat_id, seat_number)
VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000501', 1, 'seated', 100, '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000601', 1),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000502', 1, 'seated', 0, '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000602', 2);

INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, player_name, entry_id, status)
VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000501', 1, '00000000-0000-0000-0000-000000000301', 1, 100, true, 'Move Player', '00000000-0000-0000-0000-000000000401', 'active'),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000502', 1, '00000000-0000-0000-0000-000000000302', 2, 0, true, 'Bust Player', '00000000-0000-0000-0000-000000000402', 'active');

SELECT public.floor_test_assert(
  (public.move_player_seat(
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000302',
    1,
    NULL,
    'fixture_move'
  )->>'ok')::boolean,
  'move succeeds with actor derived from auth.uid'
);
SELECT public.floor_test_assert(
  EXISTS (
    SELECT 1
    FROM public.tournament_seats
    WHERE entry_id = '00000000-0000-0000-0000-000000000401'
      AND chip_count = 100
      AND is_active
  ) AND (
    SELECT count(*)
    FROM public.tournament_seats
    WHERE entry_id = '00000000-0000-0000-0000-000000000401'
      AND is_active
  ) = 1,
  'move preserves chip count and leaves one active seat'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
SELECT public.floor_test_assert(
  (public.move_player_seat(
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000301',
    2,
    NULL,
    'cross_club'
  )->>'error') = 'actor_not_allowed',
  'cross-club move is denied'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

SELECT public.floor_test_assert(
  (public.floor_bust_player(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000602',
    0,
    'fixture_bust'
  )->>'ok')::boolean,
  'zero-chip bust succeeds'
);
SELECT public.floor_test_assert(
  (public.floor_bust_player(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000602',
    0,
    'double_bust'
  )->>'error') = 'already_busted',
  'double bust is rejected'
);

SELECT public.floor_test_assert(
  (public.restore_busted_player_to_seat(
    '00000000-0000-0000-0000-000000000402',
    '00000000-0000-0000-0000-000000000302',
    3,
    NULL,
    'fixture_restore'
  )->>'ok')::boolean,
  'restore uses the existing busted entry'
);
SELECT public.floor_test_assert(
  (SELECT status = 'seated' AND current_stack = 0 FROM public.tournament_entries WHERE id = '00000000-0000-0000-0000-000000000402'),
  'restore retains the zero chip value and does not create a new entry'
);

INSERT INTO public.tournaments (id, club_id, status, current_level)
VALUES ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000010', 'registration', NULL);
INSERT INTO public.tournament_levels (tournament_id, level_number, duration_minutes)
VALUES ('00000000-0000-0000-0000-000000000110', 1, 20);

SELECT public.floor_test_assert(
  (public.floor_start_tournament_clock('00000000-0000-0000-0000-000000000110')->>'ok')::boolean,
  'atomic clock start succeeds'
);
SELECT public.floor_test_assert(
  (public.floor_start_tournament_clock('00000000-0000-0000-0000-000000000110')->>'error') = 'clock_already_started',
  'second clock start is rejected'
);
SELECT public.floor_test_assert(
  (SELECT status = 'live' AND current_level = 1 AND clock_started_at IS NOT NULL FROM public.tournaments WHERE id = '00000000-0000-0000-0000-000000000110'),
  'clock status, level and start timestamp are committed together'
);

SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.floor_bust_player(uuid,uuid,integer,text)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_bust_player(uuid,uuid,integer,text)'::regprocedure, 'EXECUTE'),
  'bust RPC grants are scoped to authenticated and deny anon'
);
SELECT public.floor_test_assert(
  NOT has_function_privilege('PUBLIC', 'public.floor_start_tournament_clock(uuid)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_start_tournament_clock(uuid)'::regprocedure, 'EXECUTE'),
  'clock RPC revokes PUBLIC and grants authenticated'
);

SELECT 'floor disposable DB integration passed' AS result;
