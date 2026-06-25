-- ROLLBACK — clubs TV branding (20261028000000_clubs_tv_branding)
-- Drops the two additive columns. Safe: they only hold the optional TV logo/brand
-- name; nothing else reads them, and the clock falls back to ♠ + the club name.
ALTER TABLE public.clubs DROP COLUMN IF EXISTS tv_bg_url;
ALTER TABLE public.clubs DROP COLUMN IF EXISTS tv_brand_name;
ALTER TABLE public.clubs DROP COLUMN IF EXISTS tv_logo_url;
