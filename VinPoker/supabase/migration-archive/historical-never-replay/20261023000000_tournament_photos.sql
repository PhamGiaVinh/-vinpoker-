-- Tournament photos — club-scoped "media" staff upload public event photos onto a
-- tournament; the public viewer shows them in the "Hình ảnh" tab.
--
-- SOURCE-ONLY: apply via the controlled Management-API runbook
-- (docs/tournament/TOURNAMENT_PHOTOS_ROLLOUT.md) — NOT via `db push`. Idempotent.
-- Mirrors the club_trackers / club_cashiers club-scoped-role precedent
-- (20260611000001) exactly. `media` is already an app_role enum value.

-- ── 1. club_media — per-club media assignment (like club_trackers) ───────────
CREATE TABLE IF NOT EXISTS public.club_media (
  club_id    uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_media_pkey PRIMARY KEY (club_id, user_id),
  CONSTRAINT club_media_club_id_fkey    FOREIGN KEY (club_id)    REFERENCES public.clubs(id) ON DELETE CASCADE,
  CONSTRAINT club_media_user_id_fkey    FOREIGN KEY (user_id)    REFERENCES auth.users(id)   ON DELETE CASCADE,
  CONSTRAINT club_media_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id)   ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_club_media_user ON public.club_media (user_id);
CREATE INDEX IF NOT EXISTS idx_club_media_club ON public.club_media (club_id);
ALTER TABLE public.club_media ENABLE ROW LEVEL SECURITY;

-- ── 2. Helpers (SECURITY INVOKER sql/STABLE; precede the policies) ────────────
CREATE OR REPLACE FUNCTION public.is_club_media(_user_id uuid, _club_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.club_media cm WHERE cm.user_id = _user_id AND cm.club_id = _club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = _club_id AND c.owner_id = _user_id
  ) OR public.has_role(_user_id, 'super_admin')
$fn$;

CREATE OR REPLACE FUNCTION public.media_club_ids(_user_id uuid)
  RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  SELECT club_id FROM public.club_media WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE public.has_role(_user_id, 'super_admin')
$fn$;

GRANT EXECUTE ON FUNCTION public.is_club_media(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.media_club_ids(uuid)      TO authenticated;

-- ── 3. tournament_photos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournament_photos (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL,
  photo_url     text        NOT NULL,
  storage_path  text,
  uploaded_by   uuid,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_photos_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_photos_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT tournament_photos_uploaded_by_fkey   FOREIGN KEY (uploaded_by)   REFERENCES auth.users(id)        ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tournament_photos_tour ON public.tournament_photos (tournament_id, sort_order, created_at);
ALTER TABLE public.tournament_photos ENABLE ROW LEVEL SECURITY;

-- ── 4. RLS: club_media — assign by super_admin or the club owner ─────────────
DO $$ BEGIN CREATE POLICY "club_media_select_self"  ON public.club_media FOR SELECT TO authenticated USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_media_select_owner" ON public.club_media FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.clubs WHERE clubs.id = club_media.club_id AND clubs.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_media_select_super" ON public.club_media FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_media_insert_super_owner" ON public.club_media FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.clubs WHERE clubs.id = club_media.club_id AND clubs.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_media_delete_super_owner" ON public.club_media FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.clubs WHERE clubs.id = club_media.club_id AND clubs.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. RLS: tournament_photos — public read, club-media write ─────────────────
DO $$ BEGIN CREATE POLICY "tournament_photos_public_read" ON public.tournament_photos FOR SELECT TO anon, authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_insert_media" ON public.tournament_photos FOR INSERT TO authenticated
    WITH CHECK (uploaded_by = auth.uid()
      AND public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = tournament_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_delete_media" ON public.tournament_photos FOR DELETE TO authenticated
    USING (public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = tournament_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT                 ON public.tournament_photos TO anon, authenticated;
GRANT INSERT, DELETE, UPDATE ON public.tournament_photos TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.club_media        TO authenticated;

-- ── 6. Storage bucket (public read) + object RLS gated by the tour's club ────
INSERT INTO storage.buckets (id, name, public)
VALUES ('tournament-photos', 'tournament-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {tournament_id}/{uuid}.{ext} → foldername(name)[1] = tournament_id.
DO $$ BEGIN CREATE POLICY "tournament_photos_obj_read" ON storage.objects FOR SELECT USING (bucket_id = 'tournament-photos'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_obj_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'tournament-photos'
      AND public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = ((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tournament_photos_obj_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'tournament-photos'
      AND public.is_club_media(auth.uid(), (SELECT t.club_id FROM public.tournaments t WHERE t.id = ((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
