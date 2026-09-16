DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END;
$roles$;
CREATE SCHEMA floor_private;
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  current_level_id uuid,
  current_level integer
);
CREATE TABLE public.tournament_levels (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  level_number integer NOT NULL,
  small_blind integer NOT NULL,
  big_blind integer NOT NULL,
  ante integer NOT NULL,
  is_break boolean NOT NULL
);
CREATE TABLE public.tournament_seats (
  tournament_id uuid NOT NULL,
  table_id uuid NOT NULL,
  seat_number integer NOT NULL,
  is_active boolean NOT NULL
);
CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  table_id uuid NOT NULL,
  table_session_id uuid,
  hand_number integer NOT NULL,
  status text NOT NULL,
  is_voided boolean DEFAULT false,
  button_seat integer NOT NULL,
  tracker_level_id uuid,
  tracker_level_number integer,
  tracker_small_blind integer,
  tracker_big_blind integer,
  tracker_bba integer,
  tracker_is_break boolean
);
CREATE TABLE public.hand_players (
  hand_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  seat_number integer NOT NULL,
  starting_stack integer NOT NULL DEFAULT 2000000
);
CREATE TABLE public.hand_actions (
  hand_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  action_type text NOT NULL,
  action_order integer NOT NULL,
  action_amount integer NOT NULL DEFAULT 0
);
