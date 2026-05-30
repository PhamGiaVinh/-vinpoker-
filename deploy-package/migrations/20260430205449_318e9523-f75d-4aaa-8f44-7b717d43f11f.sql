-- 1. Create platform_bank_accounts table
CREATE TABLE public.platform_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'escrow',
  is_active BOOLEAN NOT NULL DEFAULT true,
  qr_code_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active bank accounts public read"
  ON public.platform_bank_accounts
  FOR SELECT
  USING (is_active = true OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin manage bank accounts"
  ON public.platform_bank_accounts
  FOR ALL
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_platform_bank_accounts_updated_at
  BEFORE UPDATE ON public.platform_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add tracking columns to staking_deals
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS transfer_proof_submitted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_proof_image_url TEXT,
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ;

-- 3. Backfill committed_at for existing committed/funded deals using updated_at
UPDATE public.staking_deals
   SET committed_at = updated_at
 WHERE committed_at IS NULL
   AND status IN ('committed', 'funded', 'locked', 'released');

-- 4. Trigger to auto-set committed_at when status flips to 'committed'
CREATE OR REPLACE FUNCTION public.trg_staking_set_committed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'committed' AND (OLD.status IS DISTINCT FROM 'committed') AND NEW.committed_at IS NULL THEN
    NEW.committed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staking_deals_committed_at ON public.staking_deals;
CREATE TRIGGER trg_staking_deals_committed_at
  BEFORE UPDATE ON public.staking_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_staking_set_committed_at();

-- 5. Seed placeholder bank account (admin to replace with real one)
INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, notes)
VALUES ('MBBank', '0123456789', 'NGUYEN VAN A', 'escrow', 'Tài khoản Escrow chính cho VinPoker Staking — vui lòng cập nhật thông tin thật trong Admin Panel.');