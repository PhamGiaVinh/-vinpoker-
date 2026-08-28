\set ON_ERROR_STOP on

-- This isolated database deliberately supplies a noncanonical pre-existing
-- membership object. The baseline must stop rather than alter or replace it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TYPE public.app_role AS ENUM ('super_admin', 'player');
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL, email_confirmed_at timestamptz);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid; $$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE TABLE public.clubs (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id));

-- Missing the reviewed columns, index, policies, and constraints by design.
CREATE TABLE public.club_cashiers (club_id uuid PRIMARY KEY, user_id uuid NOT NULL);
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('10000000-0000-0000-0000-000000000001', 'owner@example.com', now());
INSERT INTO public.clubs (id, owner_id)
VALUES ('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.club_cashiers (club_id, user_id)
VALUES ('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001');

\ir ../../supabase/migration-archive/superseded/remote-alias/20270108000000_ops_operator_membership_baseline.sql
