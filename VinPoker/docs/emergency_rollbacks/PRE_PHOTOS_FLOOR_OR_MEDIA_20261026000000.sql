-- Rollback for 20261026000000_tournament_photos_floor_or_media.sql
-- Restores the media-ONLY write policies and drops the floor-OR-media helpers.
DROP POLICY IF EXISTS "tournament_photos_insert_floor_media" ON public.tournament_photos;
DROP POLICY IF EXISTS "tournament_photos_delete_floor_media" ON public.tournament_photos;
DROP POLICY IF EXISTS "tournament_photos_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "tournament_photos_obj_delete" ON storage.objects;

CREATE POLICY "tournament_photos_insert_media" ON public.tournament_photos FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid()
    AND public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = tournament_id)));
CREATE POLICY "tournament_photos_delete_media" ON public.tournament_photos FOR DELETE TO authenticated
  USING (public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = tournament_id)));
CREATE POLICY "tournament_photos_obj_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tournament-photos'
    AND public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = ((storage.foldername(name))[1])::uuid)));
CREATE POLICY "tournament_photos_obj_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tournament-photos'
    AND public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = ((storage.foldername(name))[1])::uuid)));

DROP FUNCTION IF EXISTS public.is_club_floor_or_media(uuid, uuid);
DROP FUNCTION IF EXISTS public.safe_uuid_from_storage_folder(text);
