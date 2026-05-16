
-- 1) Profiles: revoke bank columns from anon
REVOKE SELECT (bank_account_number, bank_account_holder, bank_name) ON public.profiles FROM anon;

-- 2) Storage bank-qr-codes: tighten write policy to caller's club folder
DROP POLICY IF EXISTS "Bank QR club owner write" ON storage.objects;
CREATE POLICY "Bank QR club owner write"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'bank-qr-codes'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.clubs WHERE owner_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'bank-qr-codes'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.clubs WHERE owner_id = auth.uid()
  )
);

-- 3) staking_deals: remove permissive third OR branch
DROP POLICY IF EXISTS "Player updates own listing or admin updates" ON public.staking_deals;
CREATE POLICY "Player updates own listing or admin updates"
ON public.staking_deals
FOR UPDATE
USING (
  ((auth.uid() = player_id) AND (status = 'listing'::staking_deal_status))
  OR has_role(auth.uid(), 'super_admin'::app_role)
);
