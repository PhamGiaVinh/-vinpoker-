CREATE OR REPLACE FUNCTION public.cashier_club_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Super admin: all clubs
  SELECT id FROM public.clubs
  WHERE public.has_role(_user_id, 'super_admin'::app_role)

  UNION

  -- Assigned cashier
  SELECT club_id FROM public.club_cashiers WHERE user_id = _user_id

  UNION

  -- Club owner
  SELECT id FROM public.clubs WHERE owner_id = _user_id
$function$;