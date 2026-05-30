-- Rollback USDT → VND bank transfer
ALTER TABLE public.profiles DROP COLUMN IF EXISTS usdt_tron_address;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;

ALTER TABLE public.staking_purchases DROP COLUMN IF EXISTS usdt_amount;
ALTER TABLE public.staking_purchases DROP COLUMN IF EXISTS rate_at_purchase;
ALTER TABLE public.staking_purchases DROP COLUMN IF EXISTS club_wallet_id;
ALTER TABLE public.staking_purchases DROP COLUMN IF EXISTS funding_tx_hash;
ALTER TABLE public.staking_purchases DROP COLUMN IF EXISTS usdt_address_at_purchase;