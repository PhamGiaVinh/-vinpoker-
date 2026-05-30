CREATE POLICY "Club owners upload bot QR"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-uploads'
  AND (storage.foldername(name))[1] = 'club-bot'
  AND (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.owner_id = auth.uid()
    )
  )
);

CREATE POLICY "Club owners update bot QR"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'chat-uploads'
  AND (storage.foldername(name))[1] = 'club-bot'
  AND (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.owner_id = auth.uid()
    )
  )
);

CREATE POLICY "Club owners delete bot QR"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-uploads'
  AND (storage.foldername(name))[1] = 'club-bot'
  AND (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.owner_id = auth.uid()
    )
  )
);