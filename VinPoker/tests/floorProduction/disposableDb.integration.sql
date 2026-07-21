\set ON_ERROR_STOP on

-- Disposable PostgreSQL fixture only. It deliberately has no project ref,
-- application credentials, production data, or production connection string.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS dblink;
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

DO $$
BEGIN
  CREATE ROLE service_role;
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
  user_id uuid UNIQUE,
  full_name text,
  display_name text
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
  bust_order integer,
  finished_place integer,
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
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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
  duration_minutes integer DEFAULT 20,
  small_blind integer DEFAULT 0,
  big_blind integer DEFAULT 0,
  ante integer DEFAULT 0,
  is_break boolean DEFAULT false
);

-- Supabase projects grant table reads to runtime roles and enforce row access
-- with RLS. This disposable schema has no platform bootstrap, so reproduce only
-- the read privilege needed by the SECURITY INVOKER clock projection.
GRANT SELECT ON public.tournaments, public.tournament_levels
TO anon, authenticated, service_role;

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
\ir ../../supabase/migrations/20261242000000_floor_operator_scope.sql
\ir ../../supabase/migrations/20270104000001_floor_chip_cas_rpc.sql
\ir ../../supabase/migrations/20270104000004_floor_clock_control_atomic.sql

-- Reproduce the exact reviewed live predecessor drift. Vanilla PostgreSQL does
-- not include Supabase's direct service_role function grant by default, so the
-- forward migration must prove that it removes this grant rather than passing
-- only because the disposable database started stricter than production.
GRANT EXECUTE ON FUNCTION public.get_my_floor_operator_scope() TO service_role;
\ir ../../supabase/migrations/20270104000005_floor_operator_scope_acl.sql

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO public.clubs (id, owner_id)
VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099');

INSERT INTO public.club_cashiers (club_id, user_id)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002');

INSERT INTO public.club_floors (club_id, user_id)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003');

SELECT public.floor_test_assert(
  EXISTS (
    SELECT 1 FROM public.get_my_floor_operator_scope()
    WHERE club_id = '00000000-0000-0000-0000-000000000010'
      AND can_owner AND NOT can_cashier AND NOT can_floor
  ),
  'owner capability derives only from clubs.owner_id'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SELECT public.floor_test_assert(
  EXISTS (
    SELECT 1 FROM public.get_my_floor_operator_scope()
    WHERE club_id = '00000000-0000-0000-0000-000000000010'
      AND can_cashier AND NOT can_owner AND NOT can_floor
  ),
  'cashier capability derives from club_cashiers without user_roles'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SELECT public.floor_test_assert(
  EXISTS (
    SELECT 1 FROM public.get_my_floor_operator_scope()
    WHERE club_id = '00000000-0000-0000-0000-000000000010'
      AND can_floor AND NOT can_owner AND NOT can_cashier
  ),
  'floor capability derives from club_floors without user_roles'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
SELECT public.floor_test_assert(
  EXISTS (
    SELECT 1 FROM public.get_my_floor_operator_scope()
    WHERE club_id = '00000000-0000-0000-0000-000000000020'
      AND can_owner AND NOT can_cashier AND NOT can_floor
  ),
  'cross-club actor has a real but unrelated owner membership'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

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
  (SELECT count(*) FILTER (WHERE is_active) = 1
       AND count(*) FILTER (WHERE NOT is_active) = 1
       AND bool_and(chip_count = 100)
   FROM public.tournament_seats
   WHERE entry_id = '00000000-0000-0000-0000-000000000401'),
  'move preserves chip count with exactly one active seat and one historical seat'
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
VALUES
  ('00000000-0000-0000-0000-000000000110', 1, 20),
  ('00000000-0000-0000-0000-000000000110', 2, 30),
  ('00000000-0000-0000-0000-000000000110', 3, 40);

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

CREATE TEMP TABLE floor_clock_client_snapshots (
  label text PRIMARY KEY,
  revision text NOT NULL
);
GRANT SELECT, INSERT ON floor_clock_client_snapshots TO authenticated;
INSERT INTO floor_clock_client_snapshots (label, revision)
SELECT 'started_l1', public.get_tournament_clock(
  '00000000-0000-0000-0000-000000000110'
)->>'control_revision';

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    NULL
  )->>'error') = 'expected_control_revision_required',
  'post-start controls reject a missing browser revision'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    'not-a-revision'
  )->>'error') = 'expected_control_revision_required',
  'post-start controls reject a malformed browser revision'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'started_l1')
  )->>'ok')::boolean,
  'floor membership can pause through the narrow clock RPC'
);
SELECT public.floor_test_assert(
  (SELECT clock_paused_at IS NOT NULL FROM public.tournaments WHERE id = '00000000-0000-0000-0000-000000000110'),
  'pause commits a server timestamp without changing the clock start'
);
SELECT public.floor_test_assert(
  public.get_tournament_clock(
    '00000000-0000-0000-0000-000000000110'
  )->>'clock_paused_at' IS NOT NULL,
  'clock projection retains the pause marker for reviewed legacy frontend rollback'
);
INSERT INTO floor_clock_client_snapshots (label, revision)
SELECT 'paused_l1', public.get_tournament_clock(
  '00000000-0000-0000-0000-000000000110'
)->>'control_revision';
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'started_l1')
  )->>'error') = 'stale_clock_state',
  'double pause with the same snapshot is rejected'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'next_level',
    NULL,
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'paused_l1')
  )->>'ok')::boolean,
  'floor membership can advance a paused clock through the narrow RPC'
);
SELECT public.floor_test_assert(
  (SELECT current_level = 2
       AND clock_paused_at = clock_started_at
       AND pause_accumulated = 0
   FROM public.tournaments
   WHERE id = '00000000-0000-0000-0000-000000000110'),
  'paused level advance resets the level anchor and preserves paused state'
);
INSERT INTO floor_clock_client_snapshots (label, revision)
SELECT 'paused_l2', public.get_tournament_clock(
  '00000000-0000-0000-0000-000000000110'
)->>'control_revision';
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'next_level',
    NULL,
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'paused_l1')
  )->>'error') = 'stale_clock_state',
  'double level advance with one initial snapshot is rejected'
);
SELECT public.floor_test_assert(
  (SELECT current_level = 2 FROM public.tournaments WHERE id = '00000000-0000-0000-0000-000000000110'),
  'stale level action cannot advance a second time'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'resume',
    NULL,
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'paused_l2')
  )->>'ok')::boolean,
  'floor membership can resume the reset paused level'
);
SELECT public.floor_test_assert(
  (SELECT clock_paused_at IS NULL AND pause_accumulated >= 0
   FROM public.tournaments
   WHERE id = '00000000-0000-0000-0000-000000000110'),
  'resume clears the pause marker and retains non-negative accumulated time'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'next_level',
    NULL,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'ok')::boolean,
  'owner can advance a running clock through the caller-bound RPC'
);
SELECT public.floor_test_assert(
  (SELECT current_level = 3
       AND clock_paused_at IS NULL
       AND pause_accumulated = 0
       AND clock_started_at >= clock_timestamp() - interval '5 seconds'
   FROM public.tournaments
   WHERE id = '00000000-0000-0000-0000-000000000110'),
  'running level advance resets the level anchor to a full new level'
);
SELECT public.floor_test_assert(
  ((public.get_tournament_clock('00000000-0000-0000-0000-000000000110')->>'remaining_seconds')::integer BETWEEN 2395 AND 2400),
  'running level advance starts with the target level full duration'
);
RESET ROLE;

UPDATE public.tournaments
SET clock_started_at = clock_timestamp() - interval '50 minutes',
    clock_paused_at = NULL,
    pause_accumulated = 0
WHERE id = '00000000-0000-0000-0000-000000000110';

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'adjust_time',
    60,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'outcome') = 'clock_time_adjusted',
  'cashier can add time to an expired running clock'
);
SELECT public.floor_test_assert(
  ((public.get_tournament_clock('00000000-0000-0000-0000-000000000110')->>'remaining_seconds')::integer BETWEEN 59 AND 60),
  'expired clock plus sixty seconds becomes exactly one displayed minute'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'adjust_time',
    86400,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'outcome') = 'clock_time_adjusted',
  'positive adjustment clamps at the current level duration'
);
SELECT public.floor_test_assert(
  ((public.get_tournament_clock('00000000-0000-0000-0000-000000000110')->>'remaining_seconds')::integer BETWEEN 2395 AND 2400),
  'upper clamp cannot exceed the current level duration'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'adjust_time',
    -86400,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'outcome') = 'clock_time_adjusted',
  'negative adjustment clamps at zero'
);
SELECT public.floor_test_assert(
  (public.get_tournament_clock('00000000-0000-0000-0000-000000000110')->>'remaining_seconds')::integer = 0,
  'lower clamp cannot make remaining time negative'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'ok')::boolean,
  'cashier can pause the expired clock before a paused adjustment'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'adjust_time',
    60,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'outcome') = 'clock_time_adjusted',
  'cashier can adjust a paused clock without unpausing it'
);
SELECT public.floor_test_assert(
  (SELECT clock_paused_at IS NOT NULL FROM public.tournaments
   WHERE id = '00000000-0000-0000-0000-000000000110')
  AND (public.get_tournament_clock('00000000-0000-0000-0000-000000000110')->>'remaining_seconds')::integer = 60,
  'paused adjustment preserves pause state and exact remaining time'
);
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'resume',
    NULL,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'ok')::boolean,
  'cashier can resume after a paused adjustment'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'previous_level',
    NULL,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'ok')::boolean,
  'floor membership can rewind one existing level'
);
SELECT public.floor_test_assert(
  (SELECT current_level = 2
       AND clock_paused_at IS NULL
       AND pause_accumulated = 0
       AND clock_started_at >= clock_timestamp() - interval '5 seconds'
   FROM public.tournaments
   WHERE id = '00000000-0000-0000-0000-000000000110'),
  'running level rewind resets the level anchor'
);
SELECT public.floor_test_assert(
  ((public.get_tournament_clock('00000000-0000-0000-0000-000000000110')->>'remaining_seconds')::integer BETWEEN 1795 AND 1800),
  'running level rewind starts with the target level full duration'
);
RESET ROLE;

SELECT public.floor_test_assert(
  (SELECT count(*) = 11 FROM public.audit_logs
   WHERE entity_id = '00000000-0000-0000-0000-000000000110'
     AND action = 'floor_tournament_clock_controlled'),
  'every changed post-start clock action is audited once'
);

-- Two independent database sessions echo the same browser snapshot. Exactly
-- one mutation may win the row lock; the other must observe a stale revision.
INSERT INTO public.tournaments (id, club_id, status, current_level)
VALUES ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000010', 'registration', NULL);
INSERT INTO public.tournament_levels (tournament_id, level_number, duration_minutes)
VALUES
  ('00000000-0000-0000-0000-000000000113', 1, 20),
  ('00000000-0000-0000-0000-000000000113', 2, 20),
  ('00000000-0000-0000-0000-000000000113', 3, 20);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_start_tournament_clock(
    '00000000-0000-0000-0000-000000000113'
  )->>'ok')::boolean,
  'concurrency fixture clock starts once'
);
RESET ROLE;

CREATE OR REPLACE FUNCTION public.floor_test_concurrent_next(
  p_tournament_id uuid,
  p_revision text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003',
    true
  );
  RETURN public.floor_control_tournament_clock(
    p_tournament_id,
    'next_level',
    NULL,
    p_revision
  );
END;
$$;

INSERT INTO floor_clock_client_snapshots (label, revision)
SELECT 'concurrent_l1', public.get_tournament_clock(
  '00000000-0000-0000-0000-000000000113'
)->>'control_revision';

SELECT dblink_connect('clock_a', 'dbname=' || current_database());
SELECT dblink_connect('clock_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'clock_a',
  format(
    'SELECT public.floor_test_concurrent_next(%L::uuid, %L)',
    '00000000-0000-0000-0000-000000000113',
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'concurrent_l1')
  )
);
SELECT dblink_send_query(
  'clock_b',
  format(
    'SELECT public.floor_test_concurrent_next(%L::uuid, %L)',
    '00000000-0000-0000-0000-000000000113',
    (SELECT revision FROM floor_clock_client_snapshots WHERE label = 'concurrent_l1')
  )
);

CREATE TEMP TABLE floor_clock_concurrency_results (result jsonb NOT NULL);
INSERT INTO floor_clock_concurrency_results (result)
SELECT result FROM dblink_get_result('clock_a') AS t(result jsonb);
INSERT INTO floor_clock_concurrency_results (result)
SELECT result FROM dblink_get_result('clock_b') AS t(result jsonb);
SELECT public.floor_test_assert(
  (SELECT count(*) FROM floor_clock_concurrency_results
    WHERE (result->>'ok')::boolean IS TRUE) = 1
  AND (SELECT count(*) FROM floor_clock_concurrency_results
    WHERE result->>'error' = 'stale_clock_state') = 1,
  'two database sessions with one snapshot produce one winner and one stale rejection'
);
SELECT public.floor_test_assert(
  (SELECT current_level = 2 FROM public.tournaments
    WHERE id = '00000000-0000-0000-0000-000000000113'),
  'concurrent level actions advance exactly one level'
);
SELECT public.floor_test_assert(
  (SELECT count(*) = 1 FROM public.audit_logs
    WHERE entity_id = '00000000-0000-0000-0000-000000000113'
      AND action = 'floor_tournament_clock_controlled'),
  'only the winning concurrent action writes an audit record'
);
SELECT dblink_disconnect('clock_a');
SELECT dblink_disconnect('clock_b');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'error') = 'actor_not_allowed',
  'cross-club actor cannot mutate the tournament clock'
);
SELECT public.floor_test_assert(
  (SELECT current_level = 2 AND clock_paused_at IS NULL
   FROM public.tournaments WHERE id = '00000000-0000-0000-0000-000000000110'),
  'real cross-club membership cannot change another club clock'
);
RESET ROLE;

UPDATE public.tournaments
SET status = 'finished'
WHERE id = '00000000-0000-0000-0000-000000000110';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_control_tournament_clock(
    '00000000-0000-0000-0000-000000000110',
    'pause',
    NULL,
    public.get_tournament_clock(
      '00000000-0000-0000-0000-000000000110'
    )->>'control_revision'
  )->>'error') = 'tournament_not_open',
  'finished tournament rejects post-start clock controls'
);
SELECT public.floor_test_assert(
  (public.floor_start_tournament_clock(
    '00000000-0000-0000-0000-000000000110'
  )->>'error') = 'tournament_not_open',
  'finished tournament cannot be restarted through the direct start RPC'
);
RESET ROLE;

INSERT INTO public.tournaments (id, club_id, status, current_level)
VALUES ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000010', 'registration', NULL);
INSERT INTO public.tournament_levels (tournament_id, level_number, duration_minutes)
VALUES ('00000000-0000-0000-0000-000000000112', 1, 20);
INSERT INTO public.tournament_close_report (tournament_id, club_id)
VALUES ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000010');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_start_tournament_clock(
    '00000000-0000-0000-0000-000000000112'
  )->>'error') = 'tournament_already_closed',
  'close-report tournament cannot be started through the direct RPC'
);
RESET ROLE;

SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.floor_bust_player(uuid,uuid,integer,text)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_bust_player(uuid,uuid,integer,text)'::regprocedure, 'EXECUTE'),
  'bust RPC grants are scoped to authenticated and deny anon'
);
SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.floor_start_tournament_clock(uuid)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_start_tournament_clock(uuid)'::regprocedure, 'EXECUTE'),
  'clock RPC denies anon and grants authenticated'
);
SELECT public.floor_test_assert(
  NOT has_function_privilege(
    'anon',
    'public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure,
    'EXECUTE'
  ),
  'post-start clock RPC grants only authenticated among runtime roles'
);
SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.get_my_floor_operator_scope()'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_my_floor_operator_scope()'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege(
    'service_role',
    'public.get_my_floor_operator_scope()'::regprocedure,
    'EXECUTE'
  ),
  'operator-scope RPC grants only authenticated among runtime roles'
);

INSERT INTO public.tournament_entries (
  id, tournament_id, player_id, entry_no, status, current_stack, table_id, seat_id, seat_number
) VALUES (
  '00000000-0000-0000-0000-000000000403',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000503',
  1,
  'seated',
  100,
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000603',
  4
);
INSERT INTO public.tournament_seats (
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, player_name, entry_id, status
) VALUES (
  '00000000-0000-0000-0000-000000000603',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000503',
  1,
  '00000000-0000-0000-0000-000000000301',
  4,
  100,
  true,
  'Chip CAS Player',
  '00000000-0000-0000-0000-000000000403',
  'active'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_update_tournament_seat_chip(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000603',
    100,
    125
  )->>'ok')::boolean,
  'floor membership can perform the first chip CAS write'
);
RESET ROLE;

SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_update_tournament_seat_chip(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000603',
    100,
    150
  )->>'error') = 'stale_seat_state',
  'stale chip CAS is rejected after the first write'
);
RESET ROLE;
SELECT public.floor_test_assert(
  (SELECT chip_count = 125
   FROM public.tournament_seats
   WHERE id = '00000000-0000-0000-0000-000000000603'),
  'stale chip CAS leaves the committed chip count unchanged'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
SET ROLE authenticated;
SELECT public.floor_test_assert(
  (public.floor_update_tournament_seat_chip(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000603',
    125,
    150
  )->>'error') = 'actor_not_allowed',
  'cross-club actor cannot update chip count'
);
RESET ROLE;
SELECT public.floor_test_assert(
  (SELECT chip_count = 125
   FROM public.tournament_seats
   WHERE id = '00000000-0000-0000-0000-000000000603'),
  'cross-club denial does not change the seat'
);

SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.floor_update_tournament_seat_chip(uuid,uuid,integer,integer)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_update_tournament_seat_chip(uuid,uuid,integer,integer)'::regprocedure, 'EXECUTE'),
  'chip CAS RPC denies anon and grants authenticated'
);

SELECT 'floor disposable DB integration passed' AS result;
