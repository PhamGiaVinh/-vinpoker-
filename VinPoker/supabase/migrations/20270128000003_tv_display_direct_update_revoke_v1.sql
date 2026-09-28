-- TV display management hardening, Stage B (source-only; DO NOT APPLY until
-- the guarded-RPC frontend has been proven compatible).
-- Removes the legacy authenticated direct UPDATE surface. Service-role and
-- SECURITY DEFINER server workflows retain their intended authority.
--
-- ROLLBACK: use a separately reviewed forward migration to restore only the
-- exact column privileges required by a reviewed compatible client.
BEGIN;

DROP POLICY IF EXISTS tv_displays_staff_update ON public.tv_displays;
REVOKE UPDATE ON TABLE public.tv_displays FROM authenticated;

COMMIT;
