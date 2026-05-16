-- 1) New table
CREATE TABLE IF NOT EXISTS public.staking_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.staking_deals(id) ON DELETE CASCADE,
  backer_id UUID NOT NULL,
  percent INTEGER NOT NULL CHECK (percent >= 1 AND percent <= 100),
  markup NUMERIC NOT NULL,
  amount_vnd BIGINT NOT NULL,
  reference_code TEXT NOT NULL UNIQUE,
  transfer_proof_url TEXT,
  transfer_proof_submitted BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'committed', -- committed | funded | cancelled | auto_cancelled
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_deal_status ON public.staking_purchases(deal_id, status);
CREATE INDEX IF NOT EXISTS idx_purchases_backer ON public.staking_purchases(backer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_committed_at ON public.staking_purchases(committed_at) WHERE status = 'committed';

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_staking_purchases_touch ON public.staking_purchases;
CREATE TRIGGER trg_staking_purchases_touch
BEFORE UPDATE ON public.staking_purchases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) New columns on staking_deals
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS filled_percent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_purchase_percent INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS early_closed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_closed_at TIMESTAMPTZ;

-- 3) RLS
ALTER TABLE public.staking_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Backer or player or admin reads purchases" ON public.staking_purchases;
CREATE POLICY "Backer or player or admin reads purchases"
ON public.staking_purchases FOR SELECT
USING (
  backer_id = auth.uid()
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.staking_deals d WHERE d.id = staking_purchases.deal_id AND d.player_id = auth.uid())
);

DROP POLICY IF EXISTS "Block client inserts on purchases" ON public.staking_purchases;
CREATE POLICY "Block client inserts on purchases"
ON public.staking_purchases FOR INSERT
WITH CHECK (false);

DROP POLICY IF EXISTS "Admin manages purchases" ON public.staking_purchases;
CREATE POLICY "Admin manages purchases"
ON public.staking_purchases FOR UPDATE
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Backer may upload their own transfer proof (limited fields enforced by edge function;
-- here we just gate the row, edge functions are the canonical mutators)
DROP POLICY IF EXISTS "Backer updates own purchase proof" ON public.staking_purchases;
CREATE POLICY "Backer updates own purchase proof"
ON public.staking_purchases FOR UPDATE
USING (backer_id = auth.uid())
WITH CHECK (backer_id = auth.uid());

-- 4) Backfill from legacy 1-1 deals
INSERT INTO public.staking_purchases (
  deal_id, backer_id, percent, markup, amount_vnd, reference_code,
  transfer_proof_url, transfer_proof_submitted, status, committed_at, funded_at
)
SELECT
  d.id,
  d.backer_id,
  d.percentage_sold,
  d.markup,
  COALESCE(d.escrow_amount_vnd, ROUND(d.buy_in_amount_vnd * d.percentage_sold / 100.0 * d.markup)),
  'VINLEGACY' || UPPER(SUBSTRING(replace(d.id::text, '-', ''), 1, 10)),
  d.transfer_proof_image_url,
  COALESCE(d.transfer_proof_submitted, false),
  CASE
    WHEN d.status::text = 'committed' THEN 'committed'
    WHEN d.status::text IN ('funded','locked','result_entered','result_verified','result_disputed','release_requested','cosigned','completed') THEN 'funded'
    WHEN d.status::text = 'cancelled' THEN 'cancelled'
    ELSE 'cancelled'
  END,
  COALESCE(d.committed_at, d.created_at),
  d.escrow_locked_at
FROM public.staking_deals d
WHERE d.backer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.staking_purchases p WHERE p.deal_id = d.id);

-- 5) Set filled_percent for legacy deals
UPDATE public.staking_deals d
SET filled_percent = d.percentage_sold
WHERE d.backer_id IS NOT NULL AND d.filled_percent = 0;

-- 6) Replace auto_cancel function: cancel expired *purchases* and recompute deal state
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

    -- Decrement filled_percent
    UPDATE public.staking_deals
    SET filled_percent = GREATEST(0, filled_percent - p.percent),
        updated_at = now()
    WHERE id = p.deal_id;

    INSERT INTO public.staking_audit_logs (deal_id, action, performed_by, old_status, new_status, metadata)
    VALUES (p.deal_id, 'auto_cancelled_timeout', NULL, 'committed', 'cancelled',
      jsonb_build_object('purchase_id', p.id, 'released_backer_id', p.backer_id, 'percent', p.percent));

    cnt := cnt + 1;
  END LOOP;

  -- Recompute deal status for affected deals
  FOR d IN
    SELECT DISTINCT sd.id, sd.status, sd.early_closed, sd.filled_percent
    FROM public.staking_deals sd
    WHERE sd.status IN ('committing'::staking_deal_status, 'committed'::staking_deal_status)
  LOOP
    SELECT
      COALESCE(SUM(percent) FILTER (WHERE status = 'committed'), 0),
      COALESCE(SUM(percent) FILTER (WHERE status = 'funded'), 0)
    INTO total_committed, total_funded
    FROM public.staking_purchases WHERE deal_id = d.id;

    IF total_committed = 0 AND total_funded = 0 THEN
      -- All purchases fell off
      IF d.early_closed THEN
        UPDATE public.staking_deals
        SET status = 'cancelled', cancellation_reason = 'early_closed_no_funded', updated_at = now()
        WHERE id = d.id;
      ELSE
        UPDATE public.staking_deals
        SET status = 'listing', filled_percent = 0, cancellation_reason = 'auto_cancelled_timeout', updated_at = now()
        WHERE id = d.id;
      END IF;
    END IF;
  END LOOP;

  RETURN cnt;
END;
$function$;

-- 7) Add staking_purchases to realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.staking_purchases;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8) Allow new statuses on enum if not present
DO $$ BEGIN
  ALTER TYPE staking_deal_status ADD VALUE IF NOT EXISTS 'committing';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE staking_deal_status ADD VALUE IF NOT EXISTS 'cancelled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;