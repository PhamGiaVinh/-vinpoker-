-- ============================================================================
-- club_series_images — per-club "Lịch series" gallery (many images, swipeable)
-- ============================================================================
-- SOURCE-ONLY. NOT applied here. The UI is gated behind FEATURES.clubSeriesSchedule
-- (false) until this table is applied in a controlled DB session.
--
-- Unlike the single daily/weekly schedule image columns on clubs, a club's series
-- schedule has MANY images (posters + match schedules), shown as a swipeable
-- carousel on the public ClubDetail page and managed by admins in Media Center.
--
-- Images live in the existing public `app-assets` bucket under
-- series-schedules/<clubId>/<ts>.<ext>; this table just holds the URLs + order.
--
-- ROLLBACK: DROP TABLE public.club_series_images;
-- Controlled apply only (BEGIN..COMMIT). NO db push / deploy_db / schema_migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.club_series_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  caption    text,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_club_series_images_club
  ON public.club_series_images (club_id, position);

ALTER TABLE public.club_series_images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Public read: the club detail page is public (mirrors the always-visible
  -- daily/weekly schedule images on clubs).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_series_images' AND policyname = 'club_series_images public read'
  ) THEN
    CREATE POLICY "club_series_images public read" ON public.club_series_images
      FOR SELECT USING (true);
  END IF;

  -- Manage (insert/update/delete): super_admin OR the club's owner.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_series_images' AND policyname = 'club_series_images manage'
  ) THEN
    CREATE POLICY "club_series_images manage" ON public.club_series_images
      FOR ALL TO authenticated
      USING (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c
                   WHERE c.id = club_series_images.club_id AND c.owner_id = auth.uid())
      )
      WITH CHECK (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c
                   WHERE c.id = club_series_images.club_id AND c.owner_id = auth.uid())
      );
  END IF;
END $$;
