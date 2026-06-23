-- Rollback for 20261023000000_tournament_photos.sql
-- Drops everything the migration created. Run only if the photos feature must be
-- fully removed. (Object rows in the bucket are NOT deleted by this — empty the
-- bucket first if you also want the files gone.)

DROP POLICY IF EXISTS "tournament_photos_obj_read"   ON storage.objects;
DROP POLICY IF EXISTS "tournament_photos_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "tournament_photos_obj_delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'tournament-photos';  -- only if bucket is empty

DROP TABLE IF EXISTS public.tournament_photos;
DROP TABLE IF EXISTS public.club_media;
DROP FUNCTION IF EXISTS public.is_club_media(uuid, uuid);
DROP FUNCTION IF EXISTS public.media_club_ids(uuid);
