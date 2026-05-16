
-- USDT payout fields
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS usdt_tron_address TEXT;

ALTER TABLE public.staking_ledger ADD COLUMN IF NOT EXISTS payout_method TEXT;
ALTER TABLE public.staking_ledger ADD COLUMN IF NOT EXISTS usdt_amount NUMERIC;
ALTER TABLE public.staking_ledger ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE public.staking_ledger ADD COLUMN IF NOT EXISTS proof_url TEXT;
