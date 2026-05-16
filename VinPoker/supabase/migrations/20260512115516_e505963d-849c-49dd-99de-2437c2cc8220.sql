CREATE INDEX IF NOT EXISTS idx_staking_purchases_committed_at_pending
  ON public.staking_purchases (committed_at)
  WHERE status = 'committed';