-- Platform fee config (tier-based fixed fee)
CREATE TABLE IF NOT EXISTS public.platform_fee_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_buy_in BIGINT NOT NULL,
  max_buy_in BIGINT NOT NULL,
  fixed_fee BIGINT NOT NULL,
  percent_fee NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_fee_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fee_config_public_read" ON public.platform_fee_config
  FOR SELECT USING (true);
CREATE POLICY "fee_config_admin_manage" ON public.platform_fee_config
  FOR ALL USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_fee_config_updated_at
  BEFORE UPDATE ON public.platform_fee_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default tiers (only if empty)
INSERT INTO public.platform_fee_config (min_buy_in, max_buy_in, fixed_fee, percent_fee)
SELECT * FROM (VALUES
  (0::BIGINT,        3999999::BIGINT,      49000::BIGINT,   1.0::NUMERIC),
  (4000000::BIGINT,  9999999::BIGINT,      149000::BIGINT,  1.0::NUMERIC),
  (10000000::BIGINT, 19999999::BIGINT,     199000::BIGINT,  1.0::NUMERIC),
  (20000000::BIGINT, 29999999::BIGINT,     299000::BIGINT,  1.0::NUMERIC),
  (30000000::BIGINT, 39999999::BIGINT,     399000::BIGINT,  1.0::NUMERIC),
  (40000000::BIGINT, 49999999::BIGINT,     499000::BIGINT,  1.0::NUMERIC),
  (50000000::BIGINT, 999999999999::BIGINT, 1000000::BIGINT, 1.0::NUMERIC)
) AS v(min_buy_in, max_buy_in, fixed_fee, percent_fee)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_fee_config);

-- Add fee tracking columns to deals
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS platform_fixed_fee BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_percent_fee NUMERIC(5,2) NOT NULL DEFAULT 1.0;

-- Payout recipients checklist
CREATE TABLE IF NOT EXISTS public.payout_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.staking_deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player','backer')),
  purchase_id UUID,
  amount_vnd BIGINT NOT NULL,
  platform_fee_vnd BIGINT NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending',
  proof_image_url TEXT,
  paid_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_recipients_deal ON public.payout_recipients(deal_id);
CREATE INDEX IF NOT EXISTS idx_payout_recipients_user ON public.payout_recipients(user_id);

ALTER TABLE public.payout_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payout_recipients_admin" ON public.payout_recipients
  FOR ALL USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "payout_recipients_cashier_read" ON public.payout_recipients
  FOR SELECT USING (
    public.has_role(auth.uid(), 'cashier')
    AND public.is_deal_club_owner(auth.uid(), deal_id)
  );

CREATE POLICY "payout_recipients_cashier_update" ON public.payout_recipients
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'cashier')
    AND public.is_deal_club_owner(auth.uid(), deal_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'cashier')
    AND public.is_deal_club_owner(auth.uid(), deal_id)
  );

CREATE POLICY "payout_recipients_self_read" ON public.payout_recipients
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "payout_recipients_self_confirm" ON public.payout_recipients
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ensure player_checked_in columns exist (idempotent — already added previously)
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS player_checked_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_checkin_at TIMESTAMPTZ;
