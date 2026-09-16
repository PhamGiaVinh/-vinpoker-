CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claim.role', true)
$$;
CREATE SCHEMA realtime;
CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY, deleted_at timestamptz, current_level integer, current_level_id uuid
);
CREATE TABLE public.tournament_levels (
  id uuid PRIMARY KEY, tournament_id uuid, level_number integer, big_blind numeric
);
CREATE TABLE public.table_sessions (id uuid PRIMARY KEY, tournament_id uuid);
CREATE TABLE public.tournament_tables (
  id uuid PRIMARY KEY, tournament_id uuid, table_session_id uuid, table_name text
);
CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY, tournament_id uuid, player_id uuid, entry_no integer,
  finished_place integer, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY, tournament_id uuid, tournament_table_id uuid, table_session_id uuid,
  entry_id uuid, player_id uuid, entry_number integer, seat_number integer,
  player_name text, avatar_url text, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY, tournament_id uuid, tournament_table_id uuid, table_session_id uuid,
  hand_number integer, button_seat integer, community_cards jsonb DEFAULT '[]',
  pot_size numeric, tracker_small_blind numeric, tracker_big_blind numeric,
  status text, is_voided boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.hand_players (
  id uuid PRIMARY KEY, hand_id uuid, tournament_id uuid, player_id uuid,
  entry_number integer, seat_number integer, player_name text, avatar_url text,
  starting_stack numeric, ending_stack numeric, is_eliminated boolean DEFAULT false,
  hole_cards jsonb DEFAULT '[]'
);
CREATE TABLE public.hand_actions (
  id uuid PRIMARY KEY, hand_id uuid, player_id uuid, entry_number integer,
  action_type text, action_amount numeric, action_order integer, street text
);
CREATE TABLE public.tournament_chip_counts (
  id uuid PRIMARY KEY, tournament_id uuid, player_id uuid, entry_number integer,
  chip_count numeric, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.tournament_prizes (
  id uuid PRIMARY KEY, tournament_id uuid, position integer, amount numeric
);
CREATE TABLE public.tournament_eliminations (
  id uuid PRIMARY KEY, tournament_id uuid, player_id uuid, entry_number integer
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

INSERT INTO public.tournaments(id,current_level) VALUES
  ('10000000-0000-4000-8000-000000000001',1);
INSERT INTO public.tournament_levels(id,tournament_id,level_number,big_blind) VALUES
  ('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,200000);
INSERT INTO public.table_sessions(id,tournament_id) VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_name) VALUES
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Bàn 1'),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Bàn 2');
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no) VALUES
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',1);
INSERT INTO public.tournament_hands(id,tournament_id,tournament_table_id,table_session_id,hand_number,button_seat,community_cards,pot_size,tracker_big_blind,status) VALUES
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',11,1,'["AS","TH","7C"]',400000,200000,'in_progress'),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',21,2,'["4S","5H","6D"]',600000,200000,'in_progress');
INSERT INTO public.hand_players(id,hand_id,tournament_id,player_id,entry_number,seat_number,player_name,starting_stack,hole_cards) VALUES
  ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,1,'A',2000000,'["QS","QC"]'),
  ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',1,2,'B',3000000,'["8D","8H"]');
INSERT INTO public.tournament_chip_counts(id,tournament_id,player_id,entry_number,chip_count) VALUES
  ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,2000000),
  ('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',1,3000000);
