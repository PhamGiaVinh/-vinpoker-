-- Scope A: Auto-cancel expired commits + columns

ALTER TABLE public.staking_deals ADD COLUMN IF NOT EXISTS escrow_locked_at TIMESTAMPTZ;
ALTER TABLE public.staking_deals ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Extend audit action enum with new ops
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'auto_cancelled_timeout';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'admin_confirmed_funded';
ALTER TYPE public.staking_audit_action ADD VALUE IF NOT EXISTS 'admin_cancelled_deal';

-- Bank QR storage bucket (for admin Tab 2)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-qr-codes', 'bank-qr-codes', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Bank QR public read') THEN
    CREATE POLICY "Bank QR public read" ON storage.objects FOR SELECT USING (bucket_id = 'bank-qr-codes');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Super admin manage bank QR') THEN
    CREATE POLICY "Super admin manage bank QR" ON storage.objects FOR ALL
      USING (bucket_id = 'bank-qr-codes' AND public.has_role(auth.uid(), 'super_admin'))
      WITH CHECK (bucket_id = 'bank-qr-codes' AND public.has_role(auth.uid(), 'super_admin'));
  END IF;
END$$;