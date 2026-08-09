
-- =========================================================
-- 1. PROFILES: hide phone from public, expose safe view
-- =========================================================
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

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = on) AS
SELECT id, user_id, display_name, region, avatar_url, created_at, updated_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- The view needs an underlying SELECT permission. Add a permissive policy
-- restricted to non-phone columns is impossible in PG, so we add a second
-- policy allowing minimal SELECT for everyone but rely on the view for column hiding.
-- Actually: views with security_invoker still require the caller to have SELECT
-- on the base table. We need a public policy too — but that re-exposes phone.
-- Solution: switch the view to security_definer (default) so it runs as owner.
DROP VIEW public.profiles_public;
CREATE VIEW public.profiles_public AS
SELECT id, user_id, display_name, region, avatar_url, created_at, updated_at
FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- =========================================================
-- 2. CLUBS: hide bot QR / welcome / enabled from public
-- =========================================================
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

-- =========================================================
-- 3. REALTIME: scope channel subscriptions
-- =========================================================
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read public realtime topics" ON realtime.messages;
CREATE POLICY "Authenticated can read public realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'tournament:%'
  OR realtime.topic() LIKE 'leaderboard:%'
  OR realtime.topic() = 'tournaments'
  OR realtime.topic() = 'leaderboard_entries'
);

DROP POLICY IF EXISTS "Chat participants read chat topics" ON realtime.messages;
CREATE POLICY "Chat participants read chat topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'chat:%' OR realtime.topic() LIKE 'booking_chat:%')
  AND EXISTS (
    SELECT 1 FROM public.booking_chats bc
    LEFT JOIN public.clubs c ON c.id = bc.club_id
    WHERE bc.id::text = split_part(realtime.topic(), ':', 2)
      AND (bc.player_id = auth.uid() OR c.owner_id = auth.uid()
           OR public.has_role(auth.uid(), 'super_admin'::app_role))
  )
);

DROP POLICY IF EXISTS "Authenticated can broadcast" ON realtime.messages;
CREATE POLICY "Authenticated can broadcast"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (true);

-- =========================================================
-- 4. STORAGE: fix broken club-bot ownership check
-- =========================================================
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

-- =========================================================
-- 5. AUDIT COLUMNS
-- =========================================================
ALTER TABLE public.stack_registrations
  ADD COLUMN IF NOT EXISTS checked_in_by uuid,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.booking_chats
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
