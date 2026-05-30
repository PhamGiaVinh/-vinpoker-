ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS player_checked_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_checkin_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_staking_deals_checked_in
  ON public.staking_deals (player_checked_in)
  WHERE player_checked_in = true;