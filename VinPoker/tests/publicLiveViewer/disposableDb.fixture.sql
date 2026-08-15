CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL,
  deleted_at timestamptz,
  current_level integer,
  clock_started_at timestamptz,
  clock_paused_at timestamptz,
  pause_accumulated integer NOT NULL DEFAULT 0,
  players_remaining integer,
  average_stack integer
);

CREATE TABLE public.tournament_levels (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  level_number integer NOT NULL,
  small_blind integer NOT NULL,
  big_blind integer NOT NULL,
  ante integer NOT NULL,
  duration_minutes integer NOT NULL,
  is_break boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.game_tables (
  id uuid PRIMARY KEY,
  table_name text NOT NULL
);

CREATE TABLE public.tournament_tables (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid REFERENCES public.game_tables(id),
  table_number integer,
  table_name text NOT NULL,
  max_seats integer NOT NULL DEFAULT 9,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id)
);

CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid NOT NULL,
  seat_number integer NOT NULL,
  player_id uuid NOT NULL,
  player_name text NOT NULL,
  chip_count integer NOT NULL,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

INSERT INTO public.tournaments (
  id, name, status, current_level, clock_started_at, players_remaining, average_stack
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'CODEX_PUBLIC_LIVE_EVENT',
  'live',
  14,
  statement_timestamp() - interval '5 minutes',
  3,
  30000
);

INSERT INTO public.tournament_levels (
  id, tournament_id, level_number, small_blind, big_blind, ante,
  duration_minutes, is_break, created_at
) VALUES
  ('11000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 14, 50000, 100000, 100000, 30, false, '2026-08-16T00:00:00Z'),
  ('11000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 15, 0, 0, 0, 15, true, '2026-08-16T00:01:00Z'),
  ('11000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 16, 75000, 150000, 150000, 30, false, '2026-08-16T00:02:00Z');

INSERT INTO public.game_tables (id, table_name) VALUES
  ('20000000-0000-4000-8000-000000000055', 'Physical 55'),
  ('20000000-0000-4000-8000-000000000056', 'Physical 56'),
  ('20000000-0000-4000-8000-000000000057', 'Physical 57');

INSERT INTO public.tournament_tables (
  id, tournament_id, table_id, table_number, table_name, max_seats, status
) VALUES
  ('30000000-0000-4000-8000-000000000055', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000055', 55, 'Bàn 55', 9, 'active'),
  ('30000000-0000-4000-8000-000000000056', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000056', 56, 'Bàn 56', 9, 'active'),
  ('30000000-0000-4000-8000-000000000057', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000057', 57, 'Bàn 57', 9, 'closed');

INSERT INTO public.tournament_entries (id, tournament_id) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');

-- The first two rows reproduce the live identity: seat.table_id is
-- tournament_tables.id while the public URL must expose game_tables.id.
INSERT INTO public.tournament_seats (
  id, tournament_id, table_id, seat_number, player_id, player_name,
  chip_count, avatar_url, is_active, assigned_at
) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000055', 1, '60000000-0000-4000-8000-000000000001', 'Player One', 40000, 'https://example.invalid/one.png', true, '2026-08-16T00:00:00Z'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000055', 9, '60000000-0000-4000-8000-000000000002', 'Player Nine', 50000, NULL, true, '2026-08-16T00:01:00Z'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000099', 4, '60000000-0000-4000-8000-000000000003', 'Orphan Player', 0, NULL, true, '2026-08-16T00:02:00Z');
