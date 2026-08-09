\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.club_cashiers
    WHERE club_id = '10000000-0000-0000-0000-000000000010'::uuid
      AND user_id = '10000000-0000-0000-0000-000000000001'::uuid
  ) OR to_regclass('public.club_floors') IS NOT NULL THEN
    RAISE EXCEPTION 'incompatible baseline changed existing contract';
  END IF;
END;
$$;

SELECT 'incompatible canonical contract rolled back' AS result;
