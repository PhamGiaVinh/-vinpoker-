-- 1. Free Quads Poker Club
UPDATE public.clubs
SET owner_id = NULL, updated_at = now()
WHERE id = '0221db70-5545-4549-8993-85317519f456';

-- 2. Trigger-based uniqueness: skip if owner is super_admin or NULL
CREATE OR REPLACE FUNCTION public.enforce_single_club_per_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(NEW.owner_id, 'super_admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.clubs
    WHERE owner_id = NEW.owner_id
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'User % đã là chủ của 1 CLB khác. Mỗi tài khoản chỉ được làm chủ 1 CLB.', NEW.owner_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_club_per_owner ON public.clubs;
CREATE TRIGGER trg_enforce_single_club_per_owner
  BEFORE INSERT OR UPDATE OF owner_id ON public.clubs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_club_per_owner();