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
  status text NOT NULL DEFAULT 'registration',
  players_remaining integer NOT NULL DEFAULT 0
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
  assigned_at timestamptz
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

-- Exact-ID fixture mapping for the one historical assignment.  This models
-- the owner-gated prerequisite that must be true before PR2 can replace the
-- permanent legacy UNIQUE(table_id) constraint; no automatic backfill exists.
INSERT INTO public.table_sessions (
  id, club_id, game_table_id, session_type, tournament_id, control_mode,
  control_epoch, revision, opened_by, closed_at, closed_by
) VALUES (
  '00000000-0000-0000-0000-000000000600',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000504',
  'tournament',
  '00000000-0000-0000-0000-000000000100',
  'manual',
  1,
  1,
  '00000000-0000-0000-0000-000000000001',
  now(),
  '00000000-0000-0000-0000-000000000001'
);
UPDATE public.tournament_tables
SET game_table_id = '00000000-0000-0000-0000-000000000504',
    table_session_id = '00000000-0000-0000-0000-000000000600'
WHERE id = '00000000-0000-0000-0000-000000000700';

\ir ../../supabase/migrations/20270113000003_floor_table_control_v3_server_contract.sql

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
      ) = ARRAY['table_id']
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
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean AND (v_result ->> 'moved_count')::integer = 1, 'break atomically moves the active roster before closing its source session');
  PERFORM public.floor_table_v3_assert(
    (SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id = v_manual_session_id)
    AND (SELECT released_at IS NOT NULL FROM public.dealer_assignments WHERE table_session_id = v_manual_session_id),
    'break ends the dealer assignment and session history together'
  );

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
