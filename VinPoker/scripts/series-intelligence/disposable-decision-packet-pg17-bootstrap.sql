-- Disposable PostgreSQL 17 prerequisites for the D2A source-only migration probe.
-- This file is only for a throwaway database created by probe-decision-packet-pg17.mjs.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.gen_random_uuid()
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$
  SELECT pg_catalog.gen_random_uuid()
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL
);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  start_time timestamptz NOT NULL,
  status text NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE public.series_forecast_snapshots (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  event_id uuid NOT NULL REFERENCES public.tournaments(id),
  forecast_issued_at timestamptz,
  as_of_ts timestamptz,
  target_event_ts timestamptz,
  forecast_identity_eligible boolean,
  provenance_completeness text
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
      SELECT 1
      FROM public.clubs
      WHERE id = p_club_id
        AND owner_id = p_user
    )
$$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_club_owner(uuid, uuid) TO anon, authenticated, service_role;
