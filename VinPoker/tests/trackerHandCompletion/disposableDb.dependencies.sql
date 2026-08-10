\set ON_ERROR_STOP on

-- Supplemental schema for the exact Tracker hand-completion migration. Run only
-- after trackerUnifiedOps/disposableDb.baseline.sql and
-- trackerUnifiedOps/reentryHelper.dependencies.sql in a disposable PostgreSQL DB.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS starting_stack INTEGER,
  ADD COLUMN IF NOT EXISTS players_remaining INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_stack INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS registration_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.tournament_chip_counts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.hand_actions
  ADD COLUMN IF NOT EXISTS entry_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS street TEXT DEFAULT 'preflop',
  ADD COLUMN IF NOT EXISTS action_amount INTEGER DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hand_players'::regclass
      AND conname = 'hand_players_unique_entry'
  ) THEN
    ALTER TABLE public.hand_players
      ADD CONSTRAINT hand_players_unique_entry
      UNIQUE (hand_id, player_id, entry_number);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hand_actions'::regclass
      AND conname = 'uk_hand_action_order'
  ) THEN
    ALTER TABLE public.hand_actions
      ADD CONSTRAINT uk_hand_action_order UNIQUE (hand_id, action_order);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tournament_eliminations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  entry_number INTEGER NOT NULL DEFAULT 1,
  hand_id UUID,
  position INTEGER NOT NULL,
  prize NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_history_link_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID,
  context TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disposable_finalize_calls (
  tournament_id UUID NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.finalize_tournament_results(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.disposable_finalize_calls(tournament_id)
  VALUES (p_tournament_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- The production trigger already exists. This disposable predecessor proves
-- CREATE OR REPLACE keeps that trigger wired to the hardened final body.
CREATE OR REPLACE FUNCTION public.auto_finalize_on_last_bust()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_finalize_on_last_bust ON public.tournament_entries;
CREATE TRIGGER trg_auto_finalize_on_last_bust
  AFTER UPDATE ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.auto_finalize_on_last_bust();
