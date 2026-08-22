\set ON_ERROR_STOP on

CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL
);
CREATE TABLE public.club_trackers (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL
);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role text NOT NULL
);
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  players_remaining integer NOT NULL DEFAULT 0,
  average_stack numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tournament_hands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid,
  hand_number integer,
  status text NOT NULL,
  is_voided boolean NOT NULL DEFAULT false,
  locked_by_user_id uuid,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hand_actions (
  id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  player_id uuid,
  entry_number integer,
  street text,
  action_type text,
  action_amount integer,
  action_order integer
);
CREATE TABLE public.hand_players (
  id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  starting_stack integer NOT NULL,
  ending_stack integer,
  is_eliminated boolean NOT NULL DEFAULT false,
  hole_cards jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE public.tournament_eliminations (
  id uuid PRIMARY KEY,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  tournament_id uuid NOT NULL
);
CREATE TABLE public.tournament_chip_counts (
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  chip_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id, entry_number)
);
CREATE TABLE public.tournament_seats (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL,
  chip_count integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = p_role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_club_tracker(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_trackers ct
    WHERE ct.user_id = p_user_id AND ct.club_id = p_club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = p_club_id AND c.owner_id = p_user_id
  ) OR public.has_role(p_user_id, 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_club_owner(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = p_club_id AND c.owner_id = p_user_id
  ) OR public.has_role(p_user_id, 'super_admin')
$$;

-- Pre-hotfix ABI stubs. The integration applies the exact migration over these
-- signatures, while the rollback job proves they are restored atomically.
CREATE OR REPLACE FUNCTION public.void_last_hand(p_hand_id uuid)
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('legacy', p_hand_id) $$;

CREATE OR REPLACE FUNCTION public.cleanup_orphan_hands(p_older_than interval DEFAULT '10 minutes')
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('legacy', p_older_than::text) $$;

CREATE OR REPLACE FUNCTION public.undo_last_action(p_hand_id uuid)
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('legacy', p_hand_id) $$;

GRANT EXECUTE ON FUNCTION public.void_last_hand(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_hands(interval) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_last_action(uuid) TO PUBLIC;
