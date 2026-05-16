DROP POLICY IF EXISTS "Staking proofs upload by participants or admin" ON storage.objects;
DROP POLICY IF EXISTS "Staking proofs read by participants" ON storage.objects;

CREATE POLICY "Staking proofs upload by owner or admin"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'staking-proofs'
  AND (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);

CREATE POLICY "Staking proofs read by owner or admin"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'staking-proofs'
  AND (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);

CREATE POLICY "Staking proofs update by owner"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'staking-proofs'
  AND (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);