-- Disposable PostgreSQL 17 prerequisites for the Series Club Pulse V1 probe.
-- This file is applied only inside a throwaway local database.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL
);

CREATE TABLE public.club_settings (
  club_id uuid PRIMARY KEY,
  timezone text
);

CREATE TABLE public.club_members (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL
);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  status text NOT NULL,
  start_time timestamptz,
  deleted_at timestamptz
);

CREATE TABLE public.tournament_registrations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  status text NOT NULL,
  confirmed_at timestamptz
);

CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  registration_id uuid,
  player_id uuid NOT NULL,
  member_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_id uuid,
  is_active boolean NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.tournament_tables (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.dealers (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE public.dealer_attendance (
  id uuid PRIMARY KEY,
  dealer_id uuid NOT NULL,
  status text NOT NULL,
  check_out_time timestamptz
);

CREATE OR REPLACE FUNCTION public.is_club_owner(p_user uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.clubs AS c
      WHERE c.id = p_club_id AND c.owner_id = p_user
    )
$$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_club_owner(uuid, uuid) TO anon, authenticated, service_role;
