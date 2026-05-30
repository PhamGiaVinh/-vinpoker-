
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-uploads', 'chat-uploads', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Chat uploads are publicly viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-uploads');

CREATE POLICY "Authenticated users can upload chat files to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own chat uploads"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'chat-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own chat uploads"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'chat-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
