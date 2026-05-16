CREATE OR REPLACE FUNCTION public.trg_snapshot_deal_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staking_deal_fee_snapshot ON public.staking_deals;
CREATE TRIGGER trg_staking_deal_fee_snapshot
  BEFORE INSERT ON public.staking_deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_snapshot_deal_fee();
