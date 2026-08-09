-- Preview replay-safe bootstrap for archived migration
-- 20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql.
--
-- The original mixed application and Realtime-managed-schema migration is kept
-- unchanged in migration-archive/removed-sensitive. This replacement retains
-- only its public/storage/audit contracts under the original migration version
-- so existing ledgers remain aligned and a fresh Preview never executes DDL on
-- realtime.messages.

-- 1. Profiles: hide phone from public, expose safe view.
DROP POLICY IF EXISTS "Profiles viewable by everyone" ON public.profiles;

CREATE POLICY "Profiles readable by self admin or related parties"
ON public.profiles
FOR SELECT
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.booking_chats bc
    JOIN public.clubs c ON c.id = bc.club_id
    WHERE bc.player_id = profiles.user_id AND c.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.backing_interests bi
    WHERE bi.player_id = profiles.user_id AND bi.interested_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.backing_interests bi
    WHERE bi.interested_user_id = profiles.user_id AND bi.player_id = auth.uid()
  )
);

DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public AS
SELECT id, user_id, display_name, region, avatar_url, created_at, updated_at
FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- 2. Clubs: hide bot QR, welcome, and enabled fields from public.
DROP POLICY IF EXISTS "Approved clubs viewable by everyone" ON public.clubs;

CREATE POLICY "Clubs readable by owner admin or paying player"
ON public.clubs
FOR SELECT
USING (
  owner_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.booking_chats bc
    WHERE bc.club_id = clubs.id AND bc.player_id = auth.uid()
  )
);

CREATE VIEW public.clubs_public AS
SELECT id, owner_id, name, description, region, address, schedule,
       cover_url, rating, status, created_at, updated_at
FROM public.clubs
WHERE status = 'approved';
GRANT SELECT ON public.clubs_public TO anon, authenticated;

-- 3. Storage: retain the club-bot ownership policies. Realtime policies from
-- the archived source are deliberately not replayed here.
DROP POLICY IF EXISTS "Club owners upload bot QR" ON storage.objects;
DROP POLICY IF EXISTS "Club owners update bot QR" ON storage.objects;
DROP POLICY IF EXISTS "Club owners delete bot QR" ON storage.objects;

CREATE POLICY "Club owners upload bot QR"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'chat-uploads'
  AND (storage.foldername(name))[1] = 'club-bot'
  AND (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.owner_id = auth.uid()
    )
  )
);

CREATE POLICY "Club owners update bot QR"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'chat-uploads'
  AND (storage.foldername(name))[1] = 'club-bot'
  AND (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.owner_id = auth.uid()
    )
  )
);

CREATE POLICY "Club owners delete bot QR"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'chat-uploads'
  AND (storage.foldername(name))[1] = 'club-bot'
  AND (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.owner_id = auth.uid()
    )
  )
);

-- 4. Audit columns.
ALTER TABLE public.stack_registrations
  ADD COLUMN IF NOT EXISTS checked_in_by uuid,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.booking_chats
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
