\set ON_ERROR_STOP on

-- Supplemental objects for the Tracker Voice V0 disposable database. The
-- shared Tracker PR2A baseline owns canonical tournament/hand identities; this
-- file only supplies the current Dealer, audit, action and JWT seams consumed
-- by the exact Voice migration.

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')
  )::JSONB;
$$;

-- This legacy production helper is a prerequisite of the canonical Board
-- writer. Keep its actual format and duplicate-card semantics in the fixture.
CREATE OR REPLACE FUNCTION public.validate_cards(p_cards JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_cards IS NULL OR p_cards = '[]'::jsonb THEN
    RETURN 'ok';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_cards) AS c
    WHERE c !~ '^[AKQJT2-9][shdc]$'
  ) THEN
    RETURN 'Invalid card format';
  END IF;
  IF jsonb_array_length(p_cards) != (
    SELECT COUNT(DISTINCT val) FROM jsonb_array_elements_text(p_cards) AS val
  ) THEN
    RETURN 'Duplicate cards in array';
  END IF;
  RETURN 'ok';
END;
$$;

-- The shared PR2A baseline intentionally uses lightweight invoker stubs. Voice
-- RLS exercises the production helper shape, where club membership checks run
-- as fixed-search-path SECURITY DEFINER functions and include the club owner.
CREATE OR REPLACE FUNCTION public.is_club_tracker(
  p_user_id UUID,
  p_club_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_trackers
    WHERE user_id = p_user_id AND club_id = p_club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = p_club_id AND owner_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_floor(
  p_user_id UUID,
  p_club_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_floors
    WHERE user_id = p_user_id AND club_id = p_club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = p_club_id AND owner_id = p_user_id
  );
$$;

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS source_revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.hand_actions
  ADD COLUMN IF NOT EXISTS entry_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS street TEXT NOT NULL DEFAULT 'preflop',
  ADD COLUMN IF NOT EXISTS action_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_disposable_action_order
  ON public.hand_actions(hand_id, action_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_disposable_action_idempotency
  ON public.hand_actions(hand_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE public.dealers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.dealer_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'assigned'
);

-- Production Dealer relations are browser-readable only through their own RLS
-- contracts. The disposable fixture has no Dealer RLS suite, but Voice policy
-- predicates still need the same base SELECT grants to resolve assignments.
GRANT SELECT ON public.dealers, public.dealer_assignments TO authenticated;

-- Current P0 Tracker writers are SECURITY INVOKER functions. Mirror the
-- authenticated runtime's narrow schema/table grants so their direct writer
-- path, including show_hole_cards, is exercised under the real role boundary.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT, UPDATE ON public.tournament_hands TO authenticated;
GRANT SELECT, UPDATE ON public.hand_players TO authenticated;
GRANT SELECT ON public.tournaments TO authenticated;

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tracker_lock_ttl()
RETURNS INTERVAL
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT INTERVAL '5 minutes';
$$;

CREATE OR REPLACE FUNCTION public.tracker_lock_blocks(
  p_locked_by UUID,
  p_locked_at TIMESTAMPTZ,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT p_user_id IS NOT NULL
     AND p_locked_by IS NOT NULL
     AND p_locked_by <> p_user_id
     AND p_locked_at IS NOT NULL
     AND p_locked_at > now() - public.tracker_lock_ttl();
$$;

-- The production catalog already contained this retired legacy RPC when the
-- P0 terminal migration revoked its browser access. The disposable baseline
-- needs its ABI only so that the exact REVOKE statement can execute; no Voice
-- test calls this implementation.
CREATE OR REPLACE FUNCTION public.undo_last_action(p_hand_id UUID)
RETURNS JSONB
LANGUAGE SQL
AS $$
  SELECT jsonb_build_object('error', 'legacy_fixture_only', 'hand_id', p_hand_id);
$$;

CREATE OR REPLACE FUNCTION public.tracker_voice_test_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Tracker Voice disposable assertion failed: %', p_message;
  END IF;
END;
$$;

SELECT 'TRACKER_VOICE_DEPENDENCIES_READY' AS result;
