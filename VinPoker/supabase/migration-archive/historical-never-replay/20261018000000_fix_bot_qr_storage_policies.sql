-- ============================================================================
-- Fix bot-QR storage policies (chat-uploads / club-bot/<clubId>/...)
-- ============================================================================
-- Bug: uploading the chat-bot QR errored "new row violates row-level security
-- policy" for every club owner. The 3 bot-QR policies on storage.objects checked
--   (c.id)::text = (storage.foldername(c.name))[2]
-- where c.name is the CLUBS.NAME column (the club's display name), not the
-- uploaded object's path. storage.foldername('Some Club Name') has no '/' so [2]
-- is NULL → the EXISTS is always false → club owners are denied. (super_admin
-- passed via the has_role branch, which is why it wasn't caught.)
--
-- Fix: compare against the OBJECT path's 2nd folder — storage.foldername(
-- storage.objects.name)[2] — which is the club id in 'club-bot/<clubId>/<file>'.
-- The name is explicitly qualified as storage.objects.name because inside the
-- EXISTS subquery (FROM clubs c) a bare `name` would bind to clubs.name.
-- super_admin branch + everything else unchanged.
--
-- ROLLBACK: re-create the 3 policies with the original (buggy) c.name form.
-- Controlled apply only (BEGIN..COMMIT). NO db push / deploy_db / schema_migrations.
-- ============================================================================

DROP POLICY IF EXISTS "Club owners upload bot QR" ON storage.objects;
CREATE POLICY "Club owners upload bot QR" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'chat-uploads'
    AND (storage.foldername(name))[1] = 'club-bot'
    AND (
      has_role(auth.uid(), 'super_admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.clubs c
        WHERE (c.id)::text = (storage.foldername(storage.objects.name))[2]
          AND c.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Club owners update bot QR" ON storage.objects;
CREATE POLICY "Club owners update bot QR" ON storage.objects
  FOR UPDATE TO public
  USING (
    bucket_id = 'chat-uploads'
    AND (storage.foldername(name))[1] = 'club-bot'
    AND (
      has_role(auth.uid(), 'super_admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.clubs c
        WHERE (c.id)::text = (storage.foldername(storage.objects.name))[2]
          AND c.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Club owners delete bot QR" ON storage.objects;
CREATE POLICY "Club owners delete bot QR" ON storage.objects
  FOR DELETE TO public
  USING (
    bucket_id = 'chat-uploads'
    AND (storage.foldername(name))[1] = 'club-bot'
    AND (
      has_role(auth.uid(), 'super_admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.clubs c
        WHERE (c.id)::text = (storage.foldername(storage.objects.name))[2]
          AND c.owner_id = auth.uid()
      )
    )
  );
