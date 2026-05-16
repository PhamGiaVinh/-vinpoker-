GRANT SELECT ON TABLE public.clubs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.clubs TO authenticated;

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'club_admin'::public.app_role
FROM public.user_roles
WHERE role = 'super_admin'::public.app_role
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_super_admin_club_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'super_admin'::public.app_role THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, 'club_admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_super_admin_club_admin ON public.user_roles;
CREATE TRIGGER trg_sync_super_admin_club_admin
AFTER INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.sync_super_admin_club_admin();

CREATE OR REPLACE FUNCTION public.is_club_owner(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = _club_id
        AND c.owner_id = _user_id
    )
$$;