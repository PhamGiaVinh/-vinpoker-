-- F&B menu images — a PUBLIC storage bucket for dish photos uploaded from the Thực đơn
-- (MenuManager) admin form. SOURCE-ONLY: apply in a controlled SQL Editor session (owner-gated).
-- NOT db push / not deploy_db.
--
-- WHY: fnb_menu_items.image_url already exists (shown on the guest QR order page + counter). Until
--   now the admin could only PASTE a URL. This bucket lets the owner UPLOAD a photo directly; the
--   FE compresses client-side then uploads to fnb-menu/<club_id>/<uuid>.jpg and stores the public URL.
--
-- SECURITY MODEL:
--   • PUBLIC READ — anon + authenticated (guests view the menu unauthenticated via the QR page).
--   • WRITE (insert/update/delete) — ONLY the club OWNER (or super_admin), and ONLY under a folder
--     named with a club they own: path first segment = <club_id>. Mirrors the owner-only authz of
--     fnb_upsert_menu_item. Uses clubs.owner_id + public.has_role (same predicates as tournament_photos).
--
-- Idempotent: ON CONFLICT / duplicate_object guards. Rollback: bottom of file.

-- ── 1. Bucket (public, 5 MB cap, image mime allowlist) ───────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fnb-menu', 'fnb-menu', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. Public read ───────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY "fnb_menu_public_read" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'fnb-menu');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Owner/super_admin write, scoped to <club_id>/ folder ───────────────────────────────────
DO $$ BEGIN
  CREATE POLICY "fnb_menu_owner_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'fnb-menu' AND (
        public.has_role(auth.uid(), 'super_admin')
        OR EXISTS (SELECT 1 FROM public.clubs c
                   WHERE c.id::text = (storage.foldername(name))[1] AND c.owner_id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "fnb_menu_owner_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'fnb-menu' AND (
        public.has_role(auth.uid(), 'super_admin')
        OR EXISTS (SELECT 1 FROM public.clubs c
                   WHERE c.id::text = (storage.foldername(name))[1] AND c.owner_id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "fnb_menu_owner_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'fnb-menu' AND (
        public.has_role(auth.uid(), 'super_admin')
        OR EXISTS (SELECT 1 FROM public.clubs c
                   WHERE c.id::text = (storage.foldername(name))[1] AND c.owner_id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Read-only VERIFY after apply ──────────────────────────────────────────────────────────────
--   SELECT id, public FROM storage.buckets WHERE id = 'fnb-menu';                       -- 1 row, public=t
--   SELECT policyname FROM pg_policies WHERE tablename='objects' AND schemaname='storage'
--     AND policyname LIKE 'fnb_menu_%';                                                  -- 4 rows
--
-- ── ROLLBACK (undo) ───────────────────────────────────────────────────────────────────────────
--   DROP POLICY IF EXISTS "fnb_menu_owner_delete" ON storage.objects;
--   DROP POLICY IF EXISTS "fnb_menu_owner_update" ON storage.objects;
--   DROP POLICY IF EXISTS "fnb_menu_owner_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "fnb_menu_public_read"  ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'fnb-menu';   -- only if abandoning the bucket
--   DELETE FROM storage.buckets WHERE id = 'fnb-menu';
