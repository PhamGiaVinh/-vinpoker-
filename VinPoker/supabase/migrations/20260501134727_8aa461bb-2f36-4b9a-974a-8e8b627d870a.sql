
-- 1) Fix marketplace visibility: include 'committing' (partial fills) and exclude full 'committed'
DROP POLICY IF EXISTS "Deals visible to participants and approved marketplace" ON public.staking_deals;

CREATE POLICY "Deals visible to participants and approved marketplace"
ON public.staking_deals
FOR SELECT
USING (
  (player_id = auth.uid())
  OR (backer_id = auth.uid())
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    admin_review_status = 'approved'::staking_admin_review_status
    AND status = ANY (ARRAY['listing'::staking_deal_status, 'committing'::staking_deal_status])
    AND early_closed = false
  )
);

-- 2) Improved auto-cancel: also reopens fully-committed deals when a commit drops off,
--    and downgrades committed -> committing if filled < sold.
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_commits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  cnt INTEGER := 0;
  d RECORD;
  total_committed INTEGER;
  total_funded INTEGER;
  v_filled INTEGER;
BEGIN
  FOR p IN
    SELECT id, deal_id, percent, backer_id
    FROM public.staking_purchases
    WHERE status = 'committed'
      AND committed_at < (now() - INTERVAL '30 minutes')
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.staking_purchases
    SET status = 'auto_cancelled',
        cancelled_at = now(),
        cancellation_reason = 'Backer did not complete bank transfer within 30 minutes'
    WHERE id = p.id AND status = 'committed';

    UPDATE public.staking_deals
    SET filled_percent = GREATEST(0, filled_percent - p.percent),
        updated_at = now()
    WHERE id = p.deal_id;

    INSERT INTO public.staking_audit_logs (deal_id, action, performed_by, old_status, new_status, metadata)
    VALUES (p.deal_id, 'auto_cancelled_timeout', NULL, 'committed', 'cancelled',
      jsonb_build_object('purchase_id', p.id, 'released_backer_id', p.backer_id, 'percent', p.percent));

    cnt := cnt + 1;
  END LOOP;

  -- Recompute deal status for any deal currently in committing/committed state
  FOR d IN
    SELECT sd.id, sd.status, sd.early_closed, sd.filled_percent, sd.percentage_sold
    FROM public.staking_deals sd
    WHERE sd.status IN ('committing'::staking_deal_status, 'committed'::staking_deal_status)
  LOOP
    SELECT
      COALESCE(SUM(percent) FILTER (WHERE status = 'committed'), 0),
      COALESCE(SUM(percent) FILTER (WHERE status = 'funded'), 0)
    INTO total_committed, total_funded
    FROM public.staking_purchases WHERE deal_id = d.id;

    v_filled := total_committed + total_funded;

    IF v_filled = 0 THEN
      IF d.early_closed THEN
        UPDATE public.staking_deals
        SET status = 'cancelled', cancellation_reason = 'early_closed_no_funded', updated_at = now()
        WHERE id = d.id;
      ELSE
        UPDATE public.staking_deals
        SET status = 'listing', filled_percent = 0, cancellation_reason = 'auto_cancelled_timeout', updated_at = now()
        WHERE id = d.id;
      END IF;
    ELSIF v_filled < d.percentage_sold THEN
      -- Partially filled: should be 'committing' (open to more backers)
      IF d.status <> 'committing'::staking_deal_status THEN
        UPDATE public.staking_deals
        SET status = 'committing', updated_at = now()
        WHERE id = d.id;
      END IF;
    END IF;
    -- v_filled = percentage_sold: leave as 'committed'
  END LOOP;

  RETURN cnt;
END;
$function$;
