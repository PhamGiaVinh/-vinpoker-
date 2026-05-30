-- Allow club owners to manage their own club's bank account/QR
CREATE POLICY "Club owner manage own club bank account"
  ON public.platform_bank_accounts
  FOR ALL
  USING (
    club_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = platform_bank_accounts.club_id AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    club_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = platform_bank_accounts.club_id AND c.owner_id = auth.uid()
    )
  );

-- Allow club owners to upload/update/delete QR codes in bank-qr-codes bucket
DROP POLICY IF EXISTS "Bank QR club owner write" ON storage.objects;
CREATE POLICY "Bank QR club owner write"
  ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'bank-qr-codes'
    AND auth.uid() IN (SELECT owner_id FROM public.clubs WHERE owner_id IS NOT NULL)
  )
  WITH CHECK (
    bucket_id = 'bank-qr-codes'
    AND auth.uid() IN (SELECT owner_id FROM public.clubs WHERE owner_id IS NOT NULL)
  );