-- Minimal, isolated PostgreSQL 17 baseline for the Ops canonical migration.
-- This file never connects to Supabase or production.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.app_role AS ENUM ('owner', 'cashier', 'floor', 'super_admin');

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.actor', true), '')::uuid;
$$;

CREATE TABLE public.clubs (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id));
CREATE TABLE public.club_cashiers (club_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (club_id, user_id));
CREATE TABLE public.club_floors (club_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (club_id, user_id));
CREATE OR REPLACE FUNCTION public.is_club_cashier(p_user uuid, p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club AND c.owner_id = p_user)
      OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club AND cc.user_id = p_user);
$$;
CREATE OR REPLACE FUNCTION public.is_club_floor(p_user uuid, p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_floors cf WHERE cf.club_id = p_club AND cf.user_id = p_user);
$$;
CREATE OR REPLACE FUNCTION public.has_role(p_user uuid, p_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(btrim(p_phone), ''); $$;
CREATE OR REPLACE FUNCTION public.find_or_create_club_member(uuid, text, text, text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('member_id', NULL); $$;
CREATE TABLE public.club_settings (club_id uuid PRIMARY KEY, player_history_enabled boolean NOT NULL DEFAULT false);
CREATE TABLE public.player_history_link_errors (id bigserial PRIMARY KEY, club_id uuid, context text, detail text);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL REFERENCES public.clubs(id),
  name text NOT NULL, start_time timestamptz NOT NULL, buy_in integer NOT NULL,
  starting_stack integer NOT NULL, minutes_per_level integer NOT NULL DEFAULT 20,
  late_reg_close_level integer NOT NULL DEFAULT 6, game_type text NOT NULL DEFAULT 'nlh',
  rake_amount bigint NOT NULL DEFAULT 0, service_fee_amount bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  live_status text NOT NULL DEFAULT 'registering', current_level integer NOT NULL DEFAULT 1,
  current_blinds text, players_remaining integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.game_tables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, table_name text, status text);
CREATE TABLE public.tournament_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid REFERENCES public.game_tables(id), table_number integer, max_seats integer NOT NULL DEFAULT 9,
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.tournament_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL, player_id uuid NOT NULL,
  club_id uuid, buy_in bigint NOT NULL, platform_fixed_fee bigint NOT NULL DEFAULT 0,
  total_pay bigint NOT NULL DEFAULT 0, reference_code text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending',
  committed_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, confirmed_by uuid
);
CREATE UNIQUE INDEX uniq_test_active_reg ON public.tournament_registrations(tournament_id, player_id) WHERE status IN ('pending','confirmed');
CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL, registration_id uuid,
  player_id uuid NOT NULL, entry_no integer NOT NULL, source text NOT NULL CHECK (source IN ('online','manual','staff','offline')),
  status text NOT NULL, current_stack integer NOT NULL DEFAULT 0, table_id uuid, seat_id uuid, seat_number integer,
  seated_at timestamptz
);
CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL, player_id uuid NOT NULL,
  entry_number integer NOT NULL DEFAULT 1, table_id uuid NOT NULL, seat_number integer NOT NULL,
  chip_count integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, player_name text,
  status text NOT NULL DEFAULT 'active', entry_id uuid, assigned_by uuid, assigned_at timestamptz
);
CREATE UNIQUE INDEX test_active_seat ON public.tournament_seats(table_id, seat_number) WHERE is_active;
CREATE TABLE public.seat_draw_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL, registration_id uuid,
  entry_id uuid, player_id uuid NOT NULL, display_name text NOT NULL, table_id uuid, table_number integer,
  seat_id uuid, seat_number integer NOT NULL, receipt_code text NOT NULL UNIQUE, qr_payload jsonb NOT NULL,
  draw_type text NOT NULL, status text NOT NULL DEFAULT 'issued', issued_by uuid
);
CREATE TABLE public.seat_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL, entry_id uuid NOT NULL,
  player_id uuid NOT NULL, to_table_id uuid, to_table_number integer, to_seat_number integer NOT NULL,
  reason text NOT NULL, draw_type text NOT NULL, actor_user_id uuid NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE public.tournament_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL, previous_state text NOT NULL,
  new_state text NOT NULL, changed_by uuid, reason text
);
CREATE TABLE public.tournament_prize_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, status text);
CREATE TABLE public.non_fk_tournament_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, note text);

-- Browser-role read/write privileges needed only by the assertion script's
-- direct fixture setup. The migration under test revokes tournament DELETE and
-- all idempotency-table access before the ACL assertions run.
GRANT SELECT ON public.tournaments, public.tournament_registrations,
  public.tournament_entries, public.tournament_seats, public.seat_draw_receipts,
  public.seat_assignment_history, public.game_tables, public.tournament_tables,
  public.non_fk_tournament_evidence TO authenticated;
GRANT INSERT, UPDATE ON public.game_tables, public.tournament_tables TO authenticated;
GRANT INSERT, DELETE ON public.non_fk_tournament_evidence TO authenticated;

-- Existing legacy signature is present only to prove the migration revokes it;
-- the new Ops function must not call it.
CREATE OR REPLACE FUNCTION public.create_offline_buyin_and_seat(uuid, text, bigint, bigint, text, text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('ok', false, 'error', 'legacy_not_allowed'); $$;
GRANT EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(uuid, text, bigint, bigint, text, text) TO authenticated;

INSERT INTO auth.users(id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004');
INSERT INTO public.clubs(id, owner_id) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.club_cashiers(club_id, user_id) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.club_floors(club_id, user_id) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003');
