-- Phase 6 PR B: keep staking_deals.filled_percent in sync whenever a
-- purchase is created/updated/deleted. This makes Backer-initiated cancel
-- (status=cancelled) automatically free up the % so others can buy.
CREATE OR REPLACE FUNCTION public.recompute_deal_filled_percent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_total int;
BEGIN
  v_deal_id := COALESCE(NEW.deal_id, OLD.deal_id);
  SELECT COALESCE(SUM(percent), 0)::int INTO v_total
  FROM public.staking_purchases
  WHERE deal_id = v_deal_id
    AND status IN ('committed', 'funded');
  UPDATE public.staking_deals
  SET filled_percent = v_total
  WHERE id = v_deal_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staking_purchases_recompute ON public.staking_purchases;
CREATE TRIGGER trg_staking_purchases_recompute
AFTER INSERT OR UPDATE OF status OR DELETE ON public.staking_purchases
FOR EACH ROW EXECUTE FUNCTION public.recompute_deal_filled_percent();

-- Restrict Backer self-update of own purchase to safe columns only.
-- We rely on a column-level safety trigger because RLS WITH CHECK alone
-- cannot block changes to specific columns.
CREATE OR REPLACE FUNCTION public.guard_purchase_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- super_admin path bypasses (admin updates everything via service role anyway)
  IF public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  -- Backer can only edit their own and only specific fields:
  --  transfer_proof_url, transfer_proof_submitted, status (only -> cancelled)
  IF NEW.backer_id <> OLD.backer_id THEN
    RAISE EXCEPTION 'Cannot change backer_id';
  END IF;
  IF NEW.deal_id <> OLD.deal_id THEN
    RAISE EXCEPTION 'Cannot change deal_id';
  END IF;
  IF NEW.percent <> OLD.percent OR NEW.amount_vnd <> OLD.amount_vnd OR NEW.markup <> OLD.markup THEN
    RAISE EXCEPTION 'Cannot change financial fields';
  END IF;
  IF NEW.reference_code <> OLD.reference_code THEN
    RAISE EXCEPTION 'Cannot change reference_code';
  END IF;
  IF NEW.status <> OLD.status THEN
    -- Backer may only cancel from committed
    IF NOT (OLD.status = 'committed' AND NEW.status = 'cancelled') THEN
      RAISE EXCEPTION 'Backer can only cancel a committed purchase';
    END IF;
    NEW.cancelled_at := now();
    IF NEW.cancellation_reason IS NULL THEN
      NEW.cancellation_reason := 'backer_cancelled';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staking_purchases_guard ON public.staking_purchases;
CREATE TRIGGER trg_staking_purchases_guard
BEFORE UPDATE ON public.staking_purchases
FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_self_update();