-- Minimal PostgreSQL 17 baseline for Ops V3 capability scope.
-- This fixture is local/CI only and never connects to Supabase production.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TYPE public.app_role AS ENUM ('player', 'club_admin', 'super_admin');
CREATE TYPE public.fnb_role_kind AS ENUM ('cashier', 'server', 'kitchen');

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = _role) $$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES auth.users(id),
  name text NOT NULL
);
CREATE TABLE public.club_floors (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_cashiers (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_trackers (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_dealer_controls (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_accountants (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), UNIQUE (club_id, user_id));
CREATE TABLE public.club_chip_masters (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_marketers (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_fnb_staff (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), kind public.fnb_role_kind NOT NULL, PRIMARY KEY (club_id, user_id, kind));

INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005');

INSERT INTO public.user_roles(user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000005', 'super_admin');

INSERT INTO public.clubs(id, owner_id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Alpha'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'Bravo'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'Charlie'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', 'Delta');

-- Actor 3 is deliberately cross-club and multi-facet.
INSERT INTO public.club_floors VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_cashiers VALUES ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_trackers VALUES ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_dealer_controls VALUES ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_accountants VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_chip_masters VALUES ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_marketers VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.club_fnb_staff VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'cashier'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'kitchen'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'server');
