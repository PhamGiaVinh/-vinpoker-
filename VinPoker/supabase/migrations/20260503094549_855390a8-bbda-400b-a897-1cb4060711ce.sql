
-- Add fixed archive fee column (default 199K VND) to staking_deals
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS platform_archive_fee BIGINT NOT NULL DEFAULT 199000;

-- Update snapshot trigger to also set archive fee on insert
CREATE OR REPLACE FUNCTION public.trg_snapshot_deal_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fixed BIGINT := 49000;
  v_percent NUMERIC(5,2) := 1.0;
BEGIN
  SELECT fixed_fee, percent_fee
    INTO v_fixed, v_percent
  FROM public.platform_fee_config
  WHERE is_active = true
    AND NEW.buy_in_amount_vnd BETWEEN min_buy_in AND max_buy_in
  ORDER BY min_buy_in DESC
  LIMIT 1;

  NEW.platform_fixed_fee := COALESCE(v_fixed, 49000);
  NEW.platform_percent_fee := COALESCE(v_percent, 1.0);
  -- NEW: snapshot fixed archive fee (199K) per deal
  IF NEW.platform_archive_fee IS NULL OR NEW.platform_archive_fee = 0 THEN
    NEW.platform_archive_fee := 199000;
  END IF;
  RETURN NEW;
END;
$function$;
