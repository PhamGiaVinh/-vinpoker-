\set ON_ERROR_STOP on

-- Supplemental disposable schema for the current player-entry/re-entry chain.
-- The shared tracker baseline intentionally omits cashier/registration and seat
-- assignment domains. These definitions mirror the production columns needed by
-- the migrations under test; they do not define or stub any RPC under test.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS starting_stack INTEGER,
  ADD COLUMN IF NOT EXISTS players_remaining INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.game_tables
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS table_type TEXT,
  ADD COLUMN IF NOT EXISTS current_blind_level INTEGER;

ALTER TABLE public.tournament_tables
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF to_regtype('public.app_role') IS NULL THEN
    CREATE TYPE public.app_role AS ENUM ('player', 'club_admin', 'super_admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(p_user_id UUID, p_role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$$;

CREATE TABLE IF NOT EXISTS public.club_cashiers (
  club_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (club_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_club_cashier(p_user_id UUID, p_club_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_cashiers
    WHERE user_id = p_user_id AND club_id = p_club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = p_club_id AND owner_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_owner(p_user_id UUID, p_club_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs
      WHERE id = p_club_id AND owner_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.is_club_admin(p_user_id UUID, p_club_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = p_club_id AND owner_id = p_user_id
  );
$$;

CREATE TABLE IF NOT EXISTS public.club_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_card_id TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  cccd TEXT,
  player_user_id UUID,
  source TEXT NOT NULL DEFAULT 'csv',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, member_card_id)
);

CREATE TABLE IF NOT EXISTS public.club_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL UNIQUE REFERENCES public.clubs(id) ON DELETE CASCADE,
  player_history_enabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.tournament_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  club_id UUID,
  buy_in BIGINT NOT NULL,
  platform_fixed_fee BIGINT NOT NULL DEFAULT 0,
  total_pay BIGINT NOT NULL DEFAULT 0,
  reference_code TEXT NOT NULL UNIQUE,
  transfer_proof_image_url TEXT,
  transfer_proof_submitted BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treg_player ON public.tournament_registrations(player_id, status);
CREATE INDEX IF NOT EXISTS idx_treg_club ON public.tournament_registrations(club_id, status);
CREATE INDEX IF NOT EXISTS idx_treg_tournament ON public.tournament_registrations(tournament_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_treg_active
  ON public.tournament_registrations(tournament_id, player_id)
  WHERE status IN ('pending', 'confirmed');

ALTER TABLE public.tournament_entries
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS registration_id UUID,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS busted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bust_order INTEGER,
  ADD COLUMN IF NOT EXISTS finished_place INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.tournament_seats
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS assigned_by UUID,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.seat_draw_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  registration_id UUID,
  entry_id UUID,
  player_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  table_id UUID,
  table_number INTEGER,
  seat_id UUID,
  seat_number INTEGER NOT NULL,
  receipt_code TEXT NOT NULL UNIQUE,
  qr_payload JSONB NOT NULL DEFAULT '{}',
  draw_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued',
  issued_by UUID,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.seat_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  player_id UUID NOT NULL,
  from_table_id UUID,
  from_table_number INTEGER,
  from_seat_number INTEGER,
  to_table_id UUID,
  to_table_number INTEGER,
  to_seat_number INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'initial_draw',
  draw_type TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_close_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.tournament_prize_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID,
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.release_dealer_from_table(p_table_id UUID)
RETURNS VOID
LANGUAGE SQL
AS $$ SELECT; $$;
