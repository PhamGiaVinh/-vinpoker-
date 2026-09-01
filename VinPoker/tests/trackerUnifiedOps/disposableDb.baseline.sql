\set ON_ERROR_STOP on

-- Disposable PR2A baseline. This is local/GitHub-service PostgreSQL only.
-- Identity domains intentionally match production: seats point at
-- tournament_tables.id, entries point at game_tables.id, and new hands point
-- at tournament_tables.id.
-- canonical identities: seats point at tournament_tables.id; entries point at game_tables.id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

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

CREATE TABLE auth.users (
  id UUID PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION extensions.digest(p_payload BYTEA, p_algorithm TEXT)
RETURNS BYTEA
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT public.digest(p_payload, p_algorithm);
$$;

CREATE TABLE public.clubs (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL
);

CREATE TABLE public.club_trackers (
  club_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE public.club_floors (
  club_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (club_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_club_tracker(p_user_id UUID, p_club_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_trackers
    WHERE user_id = p_user_id AND club_id = p_club_id
  ) OR EXISTS (
    SELECT 1
    FROM public.clubs
    WHERE id = p_club_id AND owner_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_floor(p_user_id UUID, p_club_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_floors
    WHERE user_id = p_user_id AND club_id = p_club_id
  );
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  user_id UUID UNIQUE,
  display_name TEXT,
  avatar_url TEXT
);

CREATE TABLE public.tournaments (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  current_level INTEGER,
  current_level_id UUID,
  clock_paused_at TIMESTAMPTZ
);

CREATE TABLE public.game_tables (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL,
  table_name TEXT NOT NULL
);

CREATE TABLE public.tournament_tables (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  table_id UUID NOT NULL,
  table_number INTEGER NOT NULL,
  max_seats INTEGER NOT NULL DEFAULT 9,
  status TEXT NOT NULL DEFAULT 'active',
  table_name TEXT,
  floor_control_mode TEXT NOT NULL DEFAULT 'manual',
  floor_control_revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.tournament_entries (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  entry_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_stack INTEGER NOT NULL,
  table_id UUID,
  seat_id UUID,
  seat_number INTEGER
);

CREATE TABLE public.tournament_seats (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  entry_number INTEGER NOT NULL,
  table_id UUID NOT NULL,
  seat_number INTEGER NOT NULL,
  chip_count INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL,
  entry_id UUID,
  status TEXT NOT NULL,
  player_name TEXT,
  avatar_url TEXT
);

CREATE TABLE public.tournament_chip_counts (
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  entry_number INTEGER NOT NULL,
  chip_count INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, player_id, entry_number)
);

CREATE TABLE public.tournament_levels (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  level_number INTEGER NOT NULL,
  small_blind INTEGER NOT NULL,
  big_blind INTEGER NOT NULL,
  ante INTEGER NOT NULL,
  is_break BOOLEAN NOT NULL
);

CREATE TABLE public.tournament_chip_set (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL
);

CREATE TABLE public.stack_template (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  stack_value BIGINT NOT NULL
);

CREATE TABLE public.stack_template_issuance (
  stack_template_id UUID NOT NULL,
  issued_count INTEGER NOT NULL
);

CREATE TABLE public.stack_template_line (
  stack_template_id UUID NOT NULL,
  denomination_id UUID NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE public.chip_set_denomination (
  id UUID PRIMARY KEY,
  value BIGINT NOT NULL
);

CREATE TABLE public.tournament_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  table_id UUID NOT NULL,
  hand_number INTEGER NOT NULL,
  hand_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  community_cards JSONB NOT NULL DEFAULT '[]'::JSONB,
  pot_size INTEGER NOT NULL DEFAULT 0,
  side_pots JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL,
  created_by UUID,
  locked_by_user_id UUID,
  locked_at TIMESTAMPTZ,
  button_seat INTEGER,
  is_voided BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, table_id, hand_number)
);

CREATE TABLE public.hand_players (
  hand_id UUID NOT NULL,
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  entry_number INTEGER,
  seat_number INTEGER,
  starting_stack INTEGER,
  ending_stack INTEGER,
  is_eliminated BOOLEAN NOT NULL DEFAULT false,
  side_pots JSONB NOT NULL DEFAULT '[]'::JSONB,
  hole_cards JSONB NOT NULL DEFAULT '[]'::JSONB,
  player_name TEXT,
  avatar_url TEXT
);

CREATE TABLE public.hand_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id UUID NOT NULL,
  player_id UUID,
  action_order INTEGER,
  action_type TEXT
);

CREATE OR REPLACE FUNCTION public._series_canonical_json_v1(p_value JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_value::TEXT;
$$;

CREATE OR REPLACE FUNCTION public._series_sha256_jsonb_v1(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(public._series_canonical_json_v1(p_payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'tracker PR2A disposable assertion failed: %', p_message;
  END IF;
END;
$$;
