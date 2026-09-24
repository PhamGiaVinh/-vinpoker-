\set ON_ERROR_STOP on
-- Test-only columns and helpers required by the exact production record_hand
-- migration. This file runs only inside the disposable PostgreSQL CI service.
ALTER TABLE public.tournaments ADD COLUMN average_stack integer NOT NULL DEFAULT 0;
ALTER TABLE public.tournament_hands
  ADD COLUMN hand_number integer,
  ADD COLUMN hand_time timestamptz,
  ADD COLUMN community_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN pot_size integer NOT NULL DEFAULT 0,
  ADD COLUMN side_pots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN locked_by_user_id uuid,
  ADD COLUMN locked_at timestamptz;
ALTER TABLE public.hand_players
  ADD COLUMN side_pots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN hole_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN player_name text,
  ADD COLUMN avatar_url text;
ALTER TABLE public.hand_actions
  ADD COLUMN player_id uuid,
  ADD COLUMN entry_number integer,
  ADD COLUMN street text,
  ADD COLUMN action_type text,
  ADD COLUMN action_amount integer,
  ADD COLUMN action_order integer;
ALTER TABLE public.hand_actions ADD CONSTRAINT deferred_writer_action_order_unique UNIQUE (hand_id, action_order);
CREATE TABLE public.tournament_eliminations (
  tournament_id uuid NOT NULL, player_id uuid NOT NULL,
  entry_number integer NOT NULL, hand_id uuid NOT NULL,
  position integer NOT NULL, prize numeric NOT NULL
);
-- record_hand resolves the service-role dealer branch even for a normal
-- authenticated Tracker call, so provide its read-only join dependencies.
CREATE TABLE public.dealers (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, club_id uuid NOT NULL
);
CREATE TABLE public.dealer_assignments (
  dealer_id uuid NOT NULL REFERENCES public.dealers(id),
  table_id uuid NOT NULL,
  status text NOT NULL
);
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
AS $$ SELECT pg_catalog.jsonb_build_object('role', 'authenticated') $$;
CREATE OR REPLACE FUNCTION public.tracker_unified_ops_lock_tournament(p_tournament_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
END;
$$;

-- Load the unmodified production hand writer, not a test reimplementation.
\ir ../../supabase/migrations/20270114000002_tracker_voice_finish_atomic_commit_v0.sql
