DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END;
$roles$;
CREATE SCHEMA floor_private;
CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  table_id uuid NOT NULL,
  table_session_id uuid,
  hand_number integer NOT NULL,
  status text NOT NULL,
  is_voided boolean DEFAULT false,
  button_seat integer NOT NULL
);
CREATE TABLE public.hand_players (
  hand_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  seat_number integer NOT NULL
);
CREATE TABLE public.hand_actions (
  hand_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  action_type text NOT NULL,
  action_order integer NOT NULL
);
