-- Minimal PostgreSQL 17 fixture for Ops Quant Data Health Q0.
-- Synthetic data only; never connects to or copies production data.
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

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles AS role_row
    WHERE role_row.user_id = p_user_id AND role_row.role = p_role
  )
$$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL
);
CREATE TABLE public.club_floors (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_cashiers (club_id uuid NOT NULL REFERENCES public.clubs(id), user_id uuid NOT NULL REFERENCES auth.users(id), PRIMARY KEY (club_id, user_id));

CREATE OR REPLACE FUNCTION public.is_club_owner(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clubs AS club
    WHERE club.id = p_club_id AND club.owner_id = p_user_id
  ) OR public.has_role(p_user_id, 'super_admin'::public.app_role)
$$;

CREATE TABLE public.platform_bank_accounts (
  id uuid PRIMARY KEY,
  account_number text NOT NULL,
  club_id uuid REFERENCES public.clubs(id),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.club_payment_config (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id),
  provider text NOT NULL DEFAULT 'sepay',
  master_account_number text,
  is_active boolean NOT NULL DEFAULT false
);

CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_txn_id text NOT NULL,
  account_number text NOT NULL,
  club_id uuid REFERENCES public.clubs(id),
  amount bigint,
  transfer_type text,
  occurred_at timestamptz,
  status text NOT NULL CHECK (status IN ('unmatched', 'matched', 'ignored', 'quarantined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_bank_txn ON public.bank_transactions(provider, account_number, provider_txn_id);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  name text NOT NULL,
  status text NOT NULL,
  start_time timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE public.tournament_registrations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  player_id uuid NOT NULL,
  club_id uuid REFERENCES public.clubs(id),
  status text NOT NULL,
  confirmed_at timestamptz,
  source_entry_id uuid
);

INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005'),
  ('00000000-0000-4000-8000-000000000006'),
  ('00000000-0000-4000-8000-000000000007');

INSERT INTO public.user_roles(user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000003', 'super_admin');

INSERT INTO public.clubs(id, owner_id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Center'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'Royal'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Other');

INSERT INTO public.club_floors(club_id, user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004');
INSERT INTO public.club_cashiers(club_id, user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005');

INSERT INTO public.platform_bank_accounts(id, account_number, club_id, is_active) VALUES
  ('20000000-0000-4000-8000-000000000001', 'CENTER-001', '10000000-0000-4000-8000-000000000001', true),
  ('20000000-0000-4000-8000-000000000002', 'ROYAL-001', '10000000-0000-4000-8000-000000000002', true);

INSERT INTO public.club_payment_config(club_id, provider, master_account_number, is_active) VALUES
  ('10000000-0000-4000-8000-000000000001', 'sepay', 'CENTER-001', true),
  ('10000000-0000-4000-8000-000000000002', 'sepay', 'ROYAL-001', true);

INSERT INTO public.bank_transactions(id, provider, provider_txn_id, account_number, club_id, amount, transfer_type, occurred_at, status, created_at) VALUES
  ('30000000-0000-4000-8000-000000000001', 'sepay', 'center-actionable', 'CENTER-001', NULL, 100000, 'in', now() - interval '1 hour', 'unmatched', now() - interval '1 hour'),
  ('30000000-0000-4000-8000-000000000002', 'sepay', 'center-matched', 'CENTER-001', '10000000-0000-4000-8000-000000000001', 200000, 'in', now() - interval '2 hours', 'matched', now() - interval '2 hours'),
  ('30000000-0000-4000-8000-000000000003', 'sepay', 'center-ignored-out', 'CENTER-001', '10000000-0000-4000-8000-000000000001', 999999, 'out', now() - interval '3 hours', 'ignored', now() - interval '3 hours'),
  ('30000000-0000-4000-8000-000000000004', 'sepay', 'center-quarantined', 'CENTER-001', NULL, NULL, 'in', now() - interval '4 hours', 'quarantined', now() - interval '4 hours'),
  ('30000000-0000-4000-8000-000000000005', 'other', 'not-sepay', 'CENTER-001', '10000000-0000-4000-8000-000000000001', 700000, 'in', now() - interval '30 minutes', 'matched', now() - interval '30 minutes'),
  ('30000000-0000-4000-8000-000000000006', 'sepay', 'future', 'CENTER-001', '10000000-0000-4000-8000-000000000001', 800000, 'in', now() + interval '1 hour', 'matched', now() + interval '1 hour'),
  ('30000000-0000-4000-8000-000000000007', 'sepay', 'too-old', 'CENTER-001', '10000000-0000-4000-8000-000000000001', 900000, 'in', now() - interval '25 hours', 'matched', now() - interval '25 hours');

INSERT INTO public.tournaments(id, club_id, name, status, start_time) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Center Main', 'scheduled', now() + interval '1 day');

INSERT INTO public.tournament_registrations(id, tournament_id, player_id, club_id, status, confirmed_at, source_entry_id) VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'confirmed', now() - interval '30 minutes', NULL),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'confirmed', now() - interval '2 hours', '70000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'confirmed', now() + interval '1 hour', NULL),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'confirmed', NULL, NULL),
  ('50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'pending', now() - interval '10 minutes', NULL);
