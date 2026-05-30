
-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.escrow_type AS ENUM ('manual_bank_vnd','smart_contract_usdt');
CREATE TYPE public.staking_deal_status AS ENUM ('listing','committed','funded','locked','released','disputed','cancelled');
CREATE TYPE public.release_condition_type AS ENUM ('both_confirm','admin_override');
CREATE TYPE public.escrow_tx_type AS ENUM ('fund_lock','payout_player','payout_backer','platform_fee','refund');
CREATE TYPE public.staking_audit_action AS ENUM ('created','reviewed','committed','funded','result_entered','release_requested','release_cosigned','released','disputed','admin_override','cancelled','updated');
CREATE TYPE public.staking_admin_review_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.release_request_status AS ENUM ('pending_cosign','approved','executed','cancelled');

-- ============================================================
-- HELPER: short reference generator
-- ============================================================
CREATE OR REPLACE FUNCTION public.gen_escrow_reference()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := 'DEAL';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- ============================================================
-- TABLE: staking_deals
-- ============================================================
CREATE TABLE public.staking_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  custom_event_name text,
  custom_event_date timestamptz,
  custom_event_venue text,

  percentage_sold int NOT NULL CHECK (percentage_sold BETWEEN 5 AND 50),
  markup numeric(4,2) NOT NULL CHECK (markup BETWEEN 1.0 AND 2.0),
  buy_in_amount_vnd bigint NOT NULL CHECK (buy_in_amount_vnd > 0),
  asking_price_vnd bigint NOT NULL DEFAULT 0,

  backer_id uuid,
  status public.staking_deal_status NOT NULL DEFAULT 'listing',

  escrow_type public.escrow_type NOT NULL DEFAULT 'manual_bank_vnd',
  escrow_contract_address text,
  escrow_bank_reference text NOT NULL DEFAULT public.gen_escrow_reference(),
  escrow_amount_vnd bigint NOT NULL DEFAULT 0,

  release_condition_type public.release_condition_type NOT NULL DEFAULT 'both_confirm',
  player_confirmed_release boolean NOT NULL DEFAULT false,
  backer_confirmed_release boolean NOT NULL DEFAULT false,
  admin_override_approved boolean NOT NULL DEFAULT false,
  admin_override_reason text,

  result_prize_vnd bigint,
  player_payout_vnd bigint,
  backer_payout_vnd bigint,
  platform_fee_vnd bigint,

  admin_review_status public.staking_admin_review_status NOT NULL DEFAULT 'pending',
  admin_review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,

  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staking_deals_event_required CHECK (
    tournament_id IS NOT NULL OR (custom_event_name IS NOT NULL AND custom_event_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX staking_deals_reference_uidx ON public.staking_deals(escrow_bank_reference);
CREATE INDEX staking_deals_player_idx ON public.staking_deals(player_id);
CREATE INDEX staking_deals_backer_idx ON public.staking_deals(backer_id);
CREATE INDEX staking_deals_status_idx ON public.staking_deals(status);
CREATE INDEX staking_deals_review_idx ON public.staking_deals(admin_review_status);

-- ============================================================
-- TABLE: escrow_transactions (append-only ledger)
-- ============================================================
CREATE TABLE public.escrow_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.staking_deals(id) ON DELETE CASCADE,
  transaction_type public.escrow_tx_type NOT NULL,
  amount_vnd bigint NOT NULL,
  bank_tx_id text,
  proof_image_url text,
  performed_by_admin_id uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escrow_tx_deal_idx ON public.escrow_transactions(deal_id);

-- ============================================================
-- TABLE: staking_release_requests
-- ============================================================
CREATE TABLE public.staking_release_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL UNIQUE REFERENCES public.staking_deals(id) ON DELETE CASCADE,
  requested_by_admin_id uuid NOT NULL,
  cosigned_by_admin_id uuid,
  status public.release_request_status NOT NULL DEFAULT 'pending_cosign',
  note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  cosigned_at timestamptz,
  executed_at timestamptz,
  CONSTRAINT cosign_must_differ CHECK (
    cosigned_by_admin_id IS NULL OR cosigned_by_admin_id <> requested_by_admin_id
  )
);
CREATE INDEX release_req_status_idx ON public.staking_release_requests(status);

-- ============================================================
-- TABLE: staking_audit_logs (append-only)
-- ============================================================
CREATE TABLE public.staking_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES public.staking_deals(id) ON DELETE SET NULL,
  action public.staking_audit_action NOT NULL,
  performed_by uuid,
  old_status text,
  new_status text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staking_audit_deal_idx ON public.staking_audit_logs(deal_id);
CREATE INDEX staking_audit_created_idx ON public.staking_audit_logs(created_at DESC);

-- ============================================================
-- TABLE: escrow_funding_proofs
-- ============================================================
CREATE TABLE public.escrow_funding_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.staking_deals(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  image_url text NOT NULL,
  bank_tx_id text,
  amount_vnd bigint,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX funding_proof_deal_idx ON public.escrow_funding_proofs(deal_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Compute asking price + escrow amount before insert
CREATE OR REPLACE FUNCTION public.trg_staking_deal_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    NEW.asking_price_vnd := ROUND(NEW.buy_in_amount_vnd * NEW.percentage_sold / 100.0 * NEW.markup);
    NEW.escrow_amount_vnd := NEW.asking_price_vnd;
    IF NEW.escrow_bank_reference IS NULL OR NEW.escrow_bank_reference = '' THEN
      NEW.escrow_bank_reference := public.gen_escrow_reference();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER staking_deal_compute_trg
BEFORE INSERT OR UPDATE ON public.staking_deals
FOR EACH ROW EXECUTE FUNCTION public.trg_staking_deal_compute();

-- Audit log trigger
CREATE OR REPLACE FUNCTION public.trg_staking_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.staking_audit_logs(deal_id, action, performed_by, old_status, new_status, metadata)
    VALUES (NEW.id, 'created', auth.uid(), NULL, NEW.status::text, jsonb_build_object('asking_price_vnd', NEW.asking_price_vnd));
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.staking_audit_logs(deal_id, action, performed_by, old_status, new_status)
      VALUES (NEW.id, 'updated', auth.uid(), OLD.status::text, NEW.status::text);
    END IF;
    IF NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status THEN
      INSERT INTO public.staking_audit_logs(deal_id, action, performed_by, old_status, new_status, metadata)
      VALUES (NEW.id, 'reviewed', auth.uid(), OLD.admin_review_status::text, NEW.admin_review_status::text, jsonb_build_object('note', NEW.admin_review_note));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staking_deal_audit_trg
AFTER INSERT OR UPDATE ON public.staking_deals
FOR EACH ROW EXECUTE FUNCTION public.trg_staking_audit();

-- Block delete on ledger tables
CREATE OR REPLACE FUNCTION public.trg_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'This table is append-only';
END;
$$;

CREATE TRIGGER escrow_tx_no_update BEFORE UPDATE ON public.escrow_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();
CREATE TRIGGER escrow_tx_no_delete BEFORE DELETE ON public.escrow_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();
CREATE TRIGGER staking_audit_no_update BEFORE UPDATE ON public.staking_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();
CREATE TRIGGER staking_audit_no_delete BEFORE DELETE ON public.staking_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();

-- updated_at trigger for release requests
CREATE OR REPLACE FUNCTION public.trg_release_req_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cosigned_by_admin_id IS NOT NULL AND OLD.cosigned_by_admin_id IS NULL THEN
    NEW.cosigned_at := now();
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER release_req_touch_trg
BEFORE UPDATE ON public.staking_release_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_release_req_touch();

-- ============================================================
-- COMPUTE PAYOUTS FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_compute_staking_payouts(_prize_vnd bigint, _percentage int, _markup numeric)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  backer_share bigint;
  fee bigint;
  player_share bigint;
BEGIN
  IF _prize_vnd IS NULL OR _prize_vnd <= 0 THEN
    RETURN jsonb_build_object('player', 0, 'backer', 0, 'fee', 0);
  END IF;
  backer_share := ROUND( (_prize_vnd::numeric * _percentage / 100.0) / _markup );
  fee := ROUND(_prize_vnd::numeric * 0.02);
  player_share := _prize_vnd - backer_share - fee;
  IF player_share < 0 THEN player_share := 0; END IF;
  RETURN jsonb_build_object('player', player_share, 'backer', backer_share, 'fee', fee);
END;
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.staking_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staking_release_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staking_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_funding_proofs ENABLE ROW LEVEL SECURITY;

-- staking_deals
CREATE POLICY "Deals visible to participants and approved marketplace"
ON public.staking_deals FOR SELECT
USING (
  player_id = auth.uid()
  OR backer_id = auth.uid()
  OR has_role(auth.uid(), 'super_admin')
  OR (admin_review_status = 'approved' AND status IN ('listing','committed') AND backer_id IS NULL)
);

CREATE POLICY "Player creates own deal"
ON public.staking_deals FOR INSERT
WITH CHECK (auth.uid() = player_id);

CREATE POLICY "Player updates own listing or admin updates"
ON public.staking_deals FOR UPDATE
USING (
  (auth.uid() = player_id AND status = 'listing')
  OR has_role(auth.uid(), 'super_admin')
  OR (auth.uid() IS NOT NULL AND backer_id IS NULL AND status = 'listing' AND admin_review_status = 'approved')
);

CREATE POLICY "Super admin or owner deletes draft"
ON public.staking_deals FOR DELETE
USING (
  (auth.uid() = player_id AND status = 'listing' AND backer_id IS NULL)
  OR has_role(auth.uid(), 'super_admin')
);

-- escrow_transactions
CREATE POLICY "Tx visible to participants"
ON public.escrow_transactions FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin')
  OR EXISTS (SELECT 1 FROM public.staking_deals d WHERE d.id = deal_id AND (d.player_id = auth.uid() OR d.backer_id = auth.uid()))
);

CREATE POLICY "Only admin inserts tx"
ON public.escrow_transactions FOR INSERT
WITH CHECK (has_role(auth.uid(), 'super_admin') AND performed_by_admin_id = auth.uid());

-- staking_release_requests
CREATE POLICY "Release req visible to participants and admin"
ON public.staking_release_requests FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin')
  OR EXISTS (SELECT 1 FROM public.staking_deals d WHERE d.id = deal_id AND (d.player_id = auth.uid() OR d.backer_id = auth.uid()))
);

CREATE POLICY "Admin creates release req"
ON public.staking_release_requests FOR INSERT
WITH CHECK (has_role(auth.uid(), 'super_admin') AND requested_by_admin_id = auth.uid());

CREATE POLICY "Admin updates release req (cosign different)"
ON public.staking_release_requests FOR UPDATE
USING (has_role(auth.uid(), 'super_admin'))
WITH CHECK (
  has_role(auth.uid(), 'super_admin')
  AND (cosigned_by_admin_id IS NULL OR cosigned_by_admin_id <> requested_by_admin_id)
);

-- staking_audit_logs
CREATE POLICY "Audit visible to participants and admin"
ON public.staking_audit_logs FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin')
  OR EXISTS (SELECT 1 FROM public.staking_deals d WHERE d.id = deal_id AND (d.player_id = auth.uid() OR d.backer_id = auth.uid()))
);

-- escrow_funding_proofs
CREATE POLICY "Proofs visible to participants and admin"
ON public.escrow_funding_proofs FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin')
  OR EXISTS (SELECT 1 FROM public.staking_deals d WHERE d.id = deal_id AND (d.player_id = auth.uid() OR d.backer_id = auth.uid()))
);

CREATE POLICY "Backer or admin uploads proof"
ON public.escrow_funding_proofs FOR INSERT
WITH CHECK (
  uploaded_by = auth.uid()
  AND (
    has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM public.staking_deals d WHERE d.id = deal_id AND d.backer_id = auth.uid())
  )
);

-- ============================================================
-- STORAGE BUCKET: staking-proofs (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('staking-proofs','staking-proofs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staking proofs read by participants"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'staking-proofs' AND (
    has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.staking_deals d
      WHERE (storage.foldername(name))[1] = d.id::text
        AND (d.player_id = auth.uid() OR d.backer_id = auth.uid())
    )
  )
);

CREATE POLICY "Staking proofs upload by participants or admin"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'staking-proofs' AND (
    has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.staking_deals d
      WHERE (storage.foldername(name))[1] = d.id::text
        AND (d.player_id = auth.uid() OR d.backer_id = auth.uid())
    )
  )
);

-- ============================================================
-- SEED app_settings.staking_bank_account
-- ============================================================
INSERT INTO public.app_settings(key, value)
VALUES ('staking_bank_account', '{"bank_name":"","account_number":"","holder_name":"","note":"Vui lòng nhập cú pháp đúng để được ghi nhận."}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.staking_deals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staking_release_requests;
