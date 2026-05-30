-- 1. Add new status values to staking_deal_status enum
ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'result_entered';
ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'result_verified';
ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'result_disputed';
ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'release_requested';
ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'cosigned';
ALTER TYPE public.staking_deal_status ADD VALUE IF NOT EXISTS 'completed';

-- 2. Add new audit actions
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'result_verified';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'result_disputed';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'admin_override_applied';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'payout_executed';

-- 3. New columns on staking_deals
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS placement TEXT,
  ADD COLUMN IF NOT EXISTS result_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS result_data JSONB,
  ADD COLUMN IF NOT EXISTS result_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_entered_by UUID,
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS override_data JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 4. Refactor compute payouts to Formula A (markup not in split, fee = 0)
CREATE OR REPLACE FUNCTION public.fn_compute_staking_payouts(
  _prize_vnd bigint, _percentage integer, _markup numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  backer_share bigint;
  fee bigint := 0; -- MVP Formula A: no platform fee
  player_share bigint;
BEGIN
  IF _prize_vnd IS NULL OR _prize_vnd <= 0 THEN
    RETURN jsonb_build_object('player', 0, 'backer', 0, 'fee', 0);
  END IF;
  -- Formula A (StakeKings): backer = prize * (% / 100). Markup priced into escrow only.
  backer_share := ROUND(_prize_vnd::numeric * _percentage / 100.0);
  player_share := _prize_vnd - backer_share - fee;
  IF player_share < 0 THEN player_share := 0; END IF;
  RETURN jsonb_build_object('player', player_share, 'backer', backer_share, 'fee', fee);
END;
$$;

-- 5. staking_ledger (append-only)
CREATE TABLE IF NOT EXISTS public.staking_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  release_request_id UUID,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('escrow_out_backer','escrow_out_player','platform_fee')),
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd >= 0),
  user_id UUID,
  performed_by UUID NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staking_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ledger visible to participants and admin"
  ON public.staking_ledger FOR SELECT
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.staking_deals d
      WHERE d.id = staking_ledger.deal_id
        AND (d.player_id = auth.uid() OR d.backer_id = auth.uid())
    )
  );

-- Block all client-side writes; only service-role edge functions write
CREATE POLICY "Block client inserts on ledger"
  ON public.staking_ledger FOR INSERT WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_staking_ledger_deal_id ON public.staking_ledger(deal_id);
CREATE INDEX IF NOT EXISTS idx_staking_ledger_release_req ON public.staking_ledger(release_request_id);

-- Append-only enforcement
CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE ON public.staking_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();

CREATE TRIGGER trg_ledger_no_delete
  BEFORE DELETE ON public.staking_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();

-- 6. Storage bucket for tournament result proofs (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('tournament-results', 'tournament-results', false)
ON CONFLICT (id) DO NOTHING;

-- Player uploads to their own folder; admins read all
CREATE POLICY "Players upload tournament results"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'tournament-results'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Players read own tournament results"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'tournament-results'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

CREATE POLICY "Players update own tournament results"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'tournament-results'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Index for common admin lookups
CREATE INDEX IF NOT EXISTS idx_staking_deals_status ON public.staking_deals(status);