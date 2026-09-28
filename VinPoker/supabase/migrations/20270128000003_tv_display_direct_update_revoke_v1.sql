-- TV display management hardening, Stage B (source-only; DO NOT APPLY until
-- the guarded-RPC frontend has been proven compatible).
-- Removes the legacy authenticated direct UPDATE surface and the legacy token
-- reader only after every public display caller is proven to use guarded V3.
-- Service-role and SECURITY DEFINER server workflows retain their intended
-- authority; V3 may still call the legacy core as the owning role.
--
-- ROLLBACK: use a separately reviewed forward migration to restore only the
-- exact column privileges required by a reviewed compatible client.
BEGIN;

DROP POLICY IF EXISTS tv_displays_staff_update ON public.tv_displays;
REVOKE UPDATE ON TABLE public.tv_displays FROM authenticated;
REVOKE ALL ON FUNCTION public.get_tv_display_state(text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
