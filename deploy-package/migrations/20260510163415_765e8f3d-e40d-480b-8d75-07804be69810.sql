CREATE POLICY "Media upload app assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'app-assets' AND has_role(auth.uid(), 'media'::app_role));

CREATE POLICY "Media update app assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'app-assets' AND has_role(auth.uid(), 'media'::app_role));

CREATE POLICY "Media delete app assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'app-assets' AND has_role(auth.uid(), 'media'::app_role));