ALTER TABLE public.staking_deals
ADD COLUMN IF NOT EXISTS result_verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS result_verified_by UUID;