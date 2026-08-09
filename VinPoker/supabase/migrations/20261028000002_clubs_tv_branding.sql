-- ============================================================================
-- Clubs TV branding — per-club logo + brand name for the broadcast clock
-- ============================================================================
-- SOURCE-ONLY. Three ADDITIVE nullable columns so each club can brand its TV
-- tournament clock independently of its public cover: logo emblem, brand name, and a
-- TV-only background (tv_bg_url; the clock falls back to clubs.cover_url when unset).
-- Existing rows: all NULL → the clock falls back to ♠ + the club name (or "VINPOKER")
-- + cover_url. Zero behaviour change. RLS unchanged — club owners/admins already
-- UPDATE their own clubs row (see the media-center / super-admin flows), so the
-- TV-branding editor writes through the existing policy with no new grant.
--
-- ROLLBACK: docs/emergency_rollbacks/CLUBS_tv_branding_rollback.sql
-- Controlled apply only (BEGIN..COMMIT). NO db push / deploy_db / schema_migrations.
-- ============================================================================

ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS tv_logo_url   text;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS tv_brand_name text;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS tv_bg_url     text;
