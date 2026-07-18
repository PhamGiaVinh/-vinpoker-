-- Floor V3 operator scope: the caller is always auth.uid(); membership stays
-- club-scoped. Do not infer Floor/Cashier capability from a global app_role.

CREATE OR REPLACE FUNCTION public.get_my_floor_operator_scope()
RETURNS TABLE (
  club_id uuid,
  can_owner boolean,
  can_cashier boolean,
  can_floor boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH actor AS (
    SELECT auth.uid() AS user_id
  ), scope_rows AS (
    SELECT c.id AS club_id, true AS can_owner, false AS can_cashier, false AS can_floor
    FROM public.clubs c
    CROSS JOIN actor a
    WHERE c.owner_id = a.user_id

    UNION ALL

    SELECT cc.club_id, false, true, false
    FROM public.club_cashiers cc
    CROSS JOIN actor a
    WHERE cc.user_id = a.user_id

    UNION ALL

    SELECT cf.club_id, false, false, true
    FROM public.club_floors cf
    CROSS JOIN actor a
    WHERE cf.user_id = a.user_id
  )
  SELECT
    club_id,
    bool_or(can_owner) AS can_owner,
    bool_or(can_cashier) AS can_cashier,
    bool_or(can_floor) AS can_floor
  FROM scope_rows
  GROUP BY club_id
$fn$;

REVOKE ALL ON FUNCTION public.get_my_floor_operator_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_floor_operator_scope() TO authenticated;

COMMENT ON FUNCTION public.get_my_floor_operator_scope() IS
  'Caller-bound Floor operator scope from clubs.owner_id, club_cashiers, and club_floors.';
