-- Extend tournament-photo upload to the `floor` role too (was media-only): a
-- combined helper `is_club_floor_or_media` + a SAFE storage-path UUID parse (P0-4:
-- a policy must never throw on a malformed object name) + repoint the 4 photo
-- write policies.
--
-- DEPENDS ON (apply order): 20261023000000_tournament_photos.sql (#500) applied
-- first (the table + the media-only policies must exist) and 20261025000001
-- (is_club_floor). SOURCE-ONLY — owner-gated apply. Idempotent.

-- P0-4: parse the {tournament_id} path segment as UUID, returning NULL (not an
-- error) for any non-UUID object name so the storage policy can never throw.
CREATE OR REPLACE FUNCTION public.safe_uuid_from_storage_folder(_name text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT CASE
    WHEN (storage.foldername(_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN ((storage.foldername(_name))[1])::uuid
    ELSE NULL
  END
$fn$;

CREATE OR REPLACE FUNCTION public.is_club_floor_or_media(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT public.is_club_media(_user_id, _club_id) OR public.is_club_floor(_user_id, _club_id)
$fn$;

GRANT EXECUTE ON FUNCTION public.safe_uuid_from_storage_folder(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_club_floor_or_media(uuid, uuid)  TO authenticated;

-- Repoint tournament_photos write policies (media → floor OR media).
DROP POLICY IF EXISTS "tournament_photos_insert_media" ON public.tournament_photos;
DROP POLICY IF EXISTS "tournament_photos_delete_media" ON public.tournament_photos;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_insert_floor_media" ON public.tournament_photos FOR INSERT TO authenticated
    WITH CHECK (uploaded_by = auth.uid()
      AND public.is_club_floor_or_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = tournament_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_delete_floor_media" ON public.tournament_photos FOR DELETE TO authenticated
    USING (public.is_club_floor_or_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = tournament_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Repoint storage.objects write policies (media → floor OR media; safe path parse).
DROP POLICY IF EXISTS "tournament_photos_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "tournament_photos_obj_delete" ON storage.objects;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_obj_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'tournament-photos'
      AND public.is_club_floor_or_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = public.safe_uuid_from_storage_folder(name))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_obj_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'tournament-photos'
      AND public.is_club_floor_or_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = public.safe_uuid_from_storage_folder(name))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
