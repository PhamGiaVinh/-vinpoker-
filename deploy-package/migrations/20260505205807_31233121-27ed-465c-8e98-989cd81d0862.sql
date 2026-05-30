REVOKE ALL ON FUNCTION public.sync_super_admin_club_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_club_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_owner(uuid, uuid) TO authenticated;