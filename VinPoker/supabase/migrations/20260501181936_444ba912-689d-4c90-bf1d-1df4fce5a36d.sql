-- =========================================
-- 1. USDT EXCHANGE RATES
-- =========================================
CREATE TABLE public.usdt_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_vnd_per_usdt NUMERIC(12,2) NOT NULL CHECK (rate_vnd_per_usdt > 0),
  spread_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (spread_percent >= 0 AND spread_percent <= 20),
  buy_rate NUMERIC(14,4) GENERATED ALWAYS AS (rate_vnd_per_usdt * (1 + spread_percent/100)) STORED,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  set_by UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chỉ 1 rate active tại 1 thời điểm
CREATE UNIQUE INDEX idx_one_active_rate ON public.usdt_exchange_rates(is_active) WHERE is_active = true;

ALTER TABLE public.usdt_exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active rate public read"
  ON public.usdt_exchange_rates FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin manage rates"
  ON public.usdt_exchange_rates FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Trigger: khi insert rate mới active=true, tự deactivate rate active cũ
CREATE OR REPLACE FUNCTION public.trg_deactivate_old_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE public.usdt_exchange_rates
    SET is_active = false,
        effective_until = NEW.effective_from
    WHERE is_active = true AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deactivate_old_rate_on_insert
  BEFORE INSERT ON public.usdt_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.trg_deactivate_old_rate();

-- =========================================
-- 2. CLUB WALLETS (Binance USDT TRC-20)
-- =========================================
CREATE TABLE public.club_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  wallet_label TEXT NOT NULL DEFAULT 'Binance Main',
  network TEXT NOT NULL DEFAULT 'trc20' CHECK (network = 'trc20'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mỗi CLB chỉ 1 ví active
CREATE UNIQUE INDEX idx_one_active_wallet_per_club
  ON public.club_wallets(club_id) WHERE is_active = true;

CREATE INDEX idx_club_wallets_club ON public.club_wallets(club_id);

ALTER TABLE public.club_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active wallets public read"
  ON public.club_wallets FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin manage wallets"
  ON public.club_wallets FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_club_wallets_updated_at
  BEFORE UPDATE ON public.club_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 3. STAKING_DEALS: thêm club_id
-- =========================================
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id);

CREATE INDEX IF NOT EXISTS idx_staking_deals_club ON public.staking_deals(club_id);

-- Backfill club_id từ tournaments cho deal cũ có tournament_id
UPDATE public.staking_deals d
SET club_id = t.club_id
FROM public.tournaments t
WHERE d.tournament_id = t.id
  AND d.club_id IS NULL
  AND t.club_id IS NOT NULL;

-- Trigger: deal mới TẠO sau migration buộc phải có club_id
CREATE OR REPLACE FUNCTION public.trg_require_deal_club()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.club_id IS NULL THEN
    RAISE EXCEPTION 'Deal phải gắn với 1 câu lạc bộ (club_id) để xác định ví nhận USDT' USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_require_deal_club_on_insert
  BEFORE INSERT ON public.staking_deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_require_deal_club();

-- =========================================
-- 4. STAKING_PURCHASES: thêm USDT fields
-- =========================================
ALTER TABLE public.staking_purchases
  ADD COLUMN IF NOT EXISTS usdt_amount NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS rate_at_purchase NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS club_wallet_id UUID REFERENCES public.club_wallets(id),
  ADD COLUMN IF NOT EXISTS funding_tx_hash TEXT;

-- Tx hash nếu có phải đúng 64 hex (theo memory anti-reuse)
ALTER TABLE public.staking_purchases
  ADD CONSTRAINT chk_funding_tx_hash_format
  CHECK (funding_tx_hash IS NULL OR funding_tx_hash ~ '^[0-9a-fA-F]{64}$');

-- Tx hash unique trong purchases (anti-reuse cho funding)
CREATE UNIQUE INDEX idx_purchases_funding_tx_unique
  ON public.staking_purchases(funding_tx_hash)
  WHERE funding_tx_hash IS NOT NULL;