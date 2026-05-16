UPDATE public.staking_deals
SET backer_payout_vnd = 2400000,
    player_payout_vnd = 17600000,
    updated_at = now()
WHERE id = '1cedd831-d3e3-441e-ab8a-8f8f6e1255ae'
  AND status = 'cosigned';