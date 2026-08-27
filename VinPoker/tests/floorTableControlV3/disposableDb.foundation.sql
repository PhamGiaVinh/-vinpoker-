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
  status text NOT NULL DEFAULT 'registration'
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
  table_number integer,
  max_seats integer NOT NULL DEFAULT 9,
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid,
  status text NOT NULL DEFAULT 'registered'
);
CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid,
  seat_number integer NOT NULL,
  entry_id uuid,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress'
);
CREATE TABLE public.dealer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.game_tables(id),
  released_at timestamptz
);
CREATE TABLE public.club_floors (club_id uuid NOT NULL, user_id uuid NOT NULL);
CREATE TABLE public.club_dealer_controls (club_id uuid NOT NULL, user_id uuid NOT NULL);

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

-- Pre-migration fixtures deliberately model the legacy physical-table state:
-- table 7 is in maintenance and its tournament assignment still uses the
-- permanent UNIQUE(table_id) contract that PR2 must transition safely.
INSERT INTO public.clubs (id, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099');
INSERT INTO public.tournaments (id, club_id) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010');
INSERT INTO public.game_tables (id, club_id, table_name, status) VALUES
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000010', 'Bàn 7', 'maintenance');
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

\ir ../../supabase/migrations/20270113000002_floor_table_control_v3_foundation.sql

INSERT INTO public.tournaments (id, club_id) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000020');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000010', 'Bàn 5', 5, 'available'),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000010', 'Bàn 6', 6, 'available'),
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
    INSERT INTO public.tournament_tables (
      tournament_id, table_id, game_table_id, table_session_id, table_number
    ) VALUES (
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000503',
      '00000000-0000-0000-0000-000000000503',
      '00000000-0000-0000-0000-000000000601',
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

INSERT INTO public.tournament_entries (id, tournament_id, status) VALUES
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000100', 'seated'),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000100', 'seated');
INSERT INTO public.tournament_seats (
  id, tournament_id, table_id, tournament_table_id, table_session_id, seat_number, entry_id, is_active
) VALUES (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000601',
  1,
  '00000000-0000-0000-0000-000000000801',
  true
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, tournament_table_id, table_session_id, seat_number, entry_id, is_active
    ) VALUES (
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000701',
      '00000000-0000-0000-0000-000000000601',
      1,
      '00000000-0000-0000-0000-000000000802',
      true
    );
    RAISE EXCEPTION 'expected active explicit seat constraint';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, tournament_table_id, table_session_id, seat_number, entry_id, is_active
    ) VALUES (
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000701',
      '00000000-0000-0000-0000-000000000601',
      2,
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

DO $$
BEGIN
  BEGIN
    INSERT INTO public.tournament_tables (
      tournament_id, table_id, game_table_id, table_session_id, table_number
    ) VALUES (
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000501',
      '00000000-0000-0000-0000-000000000501',
      '00000000-0000-0000-0000-000000000602',
      5
    );
    RAISE EXCEPTION 'expected legacy tournament_tables table_id unique prerequisite';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

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
  EXISTS (
    SELECT 1 FROM public.get_floor_table_v3_preflight('00000000-0000-0000-0000-000000000010')
    WHERE finding_code = 'LEGACY_TOURNAMENT_TABLE_UNIQUE_TABLE_ID_PREREQUISITE'
  ),
  'owner sees the PR2 assignment-reuse prerequisite without data mutation'
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

SELECT 'FLOOR_TABLE_CONTROL_V3_FOUNDATION_DISPOSABLE_PASS' AS result;
