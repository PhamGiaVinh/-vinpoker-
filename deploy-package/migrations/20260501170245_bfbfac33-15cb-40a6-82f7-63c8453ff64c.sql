ALTER TABLE public.staking_purchases ADD COLUMN IF NOT EXISTS usdt_address_at_purchase TEXT;

UPDATE public.staking_purchases sp
SET usdt_address_at_purchase = p.usdt_tron_address
FROM public.profiles p
WHERE sp.usdt_address_at_purchase IS NULL
  AND p.user_id = sp.backer_id
  AND p.usdt_tron_address IS NOT NULL;

ALTER TABLE public.staking_ledger DISABLE TRIGGER trg_ledger_no_update;

WITH ranked AS (
  SELECT id, tx_hash,
         ROW_NUMBER() OVER (PARTITION BY tx_hash ORDER BY created_at) AS rn
  FROM public.staking_ledger
  WHERE payout_method = 'usdt_tron' AND tx_hash IS NOT NULL
)
UPDATE public.staking_ledger sl
SET tx_hash = sl.tx_hash || '_dup' || ranked.rn
FROM ranked
WHERE sl.id = ranked.id AND ranked.rn > 1;

ALTER TABLE public.staking_ledger ENABLE TRIGGER trg_ledger_no_update;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_usdt_tx_hash
  ON public.staking_ledger(tx_hash)
  WHERE payout_method = 'usdt_tron' AND tx_hash IS NOT NULL;