ALTER TABLE public.tournament_streams
  ADD COLUMN IF NOT EXISTS match_title TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS custom_tournament_name TEXT;

ALTER TABLE public.tournament_streams
  ALTER COLUMN tournament_id DROP NOT NULL;