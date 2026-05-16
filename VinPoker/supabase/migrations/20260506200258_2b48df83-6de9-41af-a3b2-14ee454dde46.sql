GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_deal_club_owner(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_club_owner(uuid, uuid) TO anon, authenticated;