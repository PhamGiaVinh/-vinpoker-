-- Ops-only dependency baseline. It owns the club-scoped membership contracts
-- required by the independent Ops application and the caller-bound scope RPC.
-- Existing canonical objects are validated and left unchanged; incompatible
-- objects stop this migration before any replacement is attempted.

BEGIN;

CREATE TEMP TABLE pg_temp.ops_membership_baseline_state (
  cashiers_existed boolean NOT NULL,
  floors_existed boolean NOT NULL,
  scope_existed boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.ops_membership_baseline_state (
  cashiers_existed,
  floors_existed,
  scope_existed
)
SELECT
  to_regclass('public.club_cashiers') IS NOT NULL,
  to_regclass('public.club_floors') IS NOT NULL,
  to_regprocedure('public.get_my_floor_operator_scope()') IS NOT NULL;

DO $baseline$
DECLARE
  v_clubs_id_ok boolean;
  v_clubs_owner_ok boolean;
  v_has_role_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = 'public.clubs'::regclass
      AND a.attname = 'id'
      AND a.atttypid = 'uuid'::regtype
      AND a.attnotnull
      AND NOT a.attisdropped
  ) INTO v_clubs_id_ok;

  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = 'public.clubs'::regclass
      AND a.attname = 'owner_id'
      AND a.atttypid = 'uuid'::regtype
      AND NOT a.attisdropped
  ) INTO v_clubs_owner_ok;

  SELECT to_regprocedure('public.has_role(uuid,public.app_role)') IS NOT NULL
  INTO v_has_role_ok;

  IF NOT v_clubs_id_ok OR NOT v_clubs_owner_ok OR NOT v_has_role_ok
    OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'OPS_MEMBERSHIP_BASELINE_PRECONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$baseline$;

CREATE TABLE IF NOT EXISTS public.club_cashiers (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.club_floors (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

DO $baseline$
DECLARE
  v_cashiers_existed boolean;
  v_floors_existed boolean;
  v_cashiers_ok boolean;
  v_floors_ok boolean;
  v_cashier_indexes_ok boolean;
  v_floor_indexes_ok boolean;
  v_cashier_rls boolean;
  v_floor_rls boolean;
  v_cashier_policies_ok boolean;
  v_floor_policies_ok boolean;
BEGIN
  SELECT cashiers_existed, floors_existed
  INTO v_cashiers_existed, v_floors_existed
  FROM pg_temp.ops_membership_baseline_state;

  SELECT
    (SELECT count(*) = 4 FROM pg_attribute
      WHERE attrelid = 'public.club_cashiers'::regclass AND attname IN ('club_id', 'user_id', 'granted_by', 'created_at') AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_cashiers'::regclass AND attname = 'club_id' AND atttypid = 'uuid'::regtype AND attnotnull)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_cashiers'::regclass AND attname = 'user_id' AND atttypid = 'uuid'::regtype AND attnotnull)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_cashiers'::regclass AND attname = 'granted_by' AND atttypid = 'uuid'::regtype)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_cashiers'::regclass AND attname = 'created_at' AND atttypid = 'timestamp with time zone'::regtype AND attnotnull)
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_cashiers'::regclass AND contype = 'p' AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.club_cashiers'::regclass AND attname = 'club_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.club_cashiers'::regclass AND attname = 'user_id')
    ])
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_cashiers'::regclass AND contype = 'f' AND confrelid = 'public.clubs'::regclass AND confdeltype = 'c')
  INTO v_cashiers_ok;

  SELECT
    (SELECT count(*) = 4 FROM pg_attribute
      WHERE attrelid = 'public.club_floors'::regclass AND attname IN ('club_id', 'user_id', 'granted_by', 'created_at') AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_floors'::regclass AND attname = 'club_id' AND atttypid = 'uuid'::regtype AND attnotnull)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_floors'::regclass AND attname = 'user_id' AND atttypid = 'uuid'::regtype AND attnotnull)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_floors'::regclass AND attname = 'granted_by' AND atttypid = 'uuid'::regtype)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.club_floors'::regclass AND attname = 'created_at' AND atttypid = 'timestamp with time zone'::regtype AND attnotnull)
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_floors'::regclass AND contype = 'p' AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.club_floors'::regclass AND attname = 'club_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.club_floors'::regclass AND attname = 'user_id')
    ])
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_floors'::regclass AND contype = 'f' AND confrelid = 'public.clubs'::regclass AND confdeltype = 'c')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_floors'::regclass AND contype = 'f' AND confrelid = 'auth.users'::regclass AND confdeltype = 'c')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.club_floors'::regclass AND contype = 'f' AND confrelid = 'auth.users'::regclass AND confdeltype = 'n')
  INTO v_floors_ok;

  SELECT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.club_cashiers'::regclass AND relrowsecurity)
  INTO v_cashier_rls;
  SELECT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.club_floors'::regclass AND relrowsecurity)
  INTO v_floor_rls;

  SELECT count(*) = 5
  INTO v_cashier_policies_ok
  FROM pg_policy
  WHERE polrelid = 'public.club_cashiers'::regclass
    AND polname IN (
      'club_cashiers_select_super',
      'club_cashiers_select_self',
      'club_cashiers_select_club_owner',
      'club_cashiers_insert_super',
      'club_cashiers_delete_super'
    );

  SELECT count(*) = 5
  INTO v_floor_policies_ok
  FROM pg_policy
  WHERE polrelid = 'public.club_floors'::regclass
    AND polname IN (
      'club_floors_select_self',
      'club_floors_select_owner',
      'club_floors_select_super',
      'club_floors_insert_super_owner',
      'club_floors_delete_super_owner'
    );

  IF v_cashiers_existed AND (NOT v_cashiers_ok OR NOT v_cashier_rls OR NOT v_cashier_policies_ok) THEN
    RAISE EXCEPTION 'OPS_CASHIER_CONTRACT_INCOMPATIBLE' USING ERRCODE = '55000';
  END IF;
  IF v_floors_existed AND (NOT v_floors_ok OR NOT v_floor_rls OR NOT v_floor_policies_ok) THEN
    RAISE EXCEPTION 'OPS_FLOOR_CONTRACT_INCOMPATIBLE' USING ERRCODE = '55000';
  END IF;

  IF NOT v_cashiers_existed THEN
    EXECUTE 'CREATE INDEX idx_club_cashiers_user ON public.club_cashiers(user_id)';
    EXECUTE 'CREATE INDEX idx_club_cashiers_club ON public.club_cashiers(club_id)';
    EXECUTE 'ALTER TABLE public.club_cashiers ENABLE ROW LEVEL SECURITY';
    EXECUTE $policy$
      CREATE POLICY club_cashiers_select_super ON public.club_cashiers FOR SELECT
      USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
    $policy$;
    EXECUTE 'CREATE POLICY club_cashiers_select_self ON public.club_cashiers FOR SELECT USING (auth.uid() = user_id)';
    EXECUTE $policy$
      CREATE POLICY club_cashiers_select_club_owner ON public.club_cashiers FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_cashiers.club_id AND c.owner_id = auth.uid()))
    $policy$;
    EXECUTE $policy$
      CREATE POLICY club_cashiers_insert_super ON public.club_cashiers FOR INSERT
      WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role))
    $policy$;
    EXECUTE $policy$
      CREATE POLICY club_cashiers_delete_super ON public.club_cashiers FOR DELETE
      USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
    $policy$;
  END IF;

  IF NOT v_floors_existed THEN
    EXECUTE 'CREATE INDEX idx_club_floors_user ON public.club_floors(user_id)';
    EXECUTE 'CREATE INDEX idx_club_floors_club ON public.club_floors(club_id)';
    EXECUTE 'ALTER TABLE public.club_floors ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY club_floors_select_self ON public.club_floors FOR SELECT TO authenticated USING (auth.uid() = user_id)';
    EXECUTE $policy$
      CREATE POLICY club_floors_select_owner ON public.club_floors FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_floors.club_id AND c.owner_id = auth.uid()))
    $policy$;
    EXECUTE $policy$
      CREATE POLICY club_floors_select_super ON public.club_floors FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
    $policy$;
    EXECUTE $policy$
      CREATE POLICY club_floors_insert_super_owner ON public.club_floors FOR INSERT TO authenticated
      WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR EXISTS (
        SELECT 1 FROM public.clubs c WHERE c.id = club_floors.club_id AND c.owner_id = auth.uid()
      ))
    $policy$;
    EXECUTE $policy$
      CREATE POLICY club_floors_delete_super_owner ON public.club_floors FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR EXISTS (
        SELECT 1 FROM public.clubs c WHERE c.id = club_floors.club_id AND c.owner_id = auth.uid()
      ))
    $policy$;
  END IF;
END;
$baseline$;

DO $baseline$
DECLARE
  v_scope_existed boolean;
  v_scope_ok boolean;
BEGIN
  SELECT scope_existed INTO v_scope_existed FROM pg_temp.ops_membership_baseline_state;

  IF v_scope_existed THEN
    SELECT p.prosecdef
      AND pg_get_function_result(p.oid) = 'TABLE(club_id uuid, can_owner boolean, can_cashier boolean, can_floor boolean)'
      AND coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=public%'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      -- This also detects an unintended PUBLIC grant because anon inherits it.
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    INTO v_scope_ok
    FROM pg_proc p
    WHERE p.oid = 'public.get_my_floor_operator_scope()'::regprocedure;

    IF NOT coalesce(v_scope_ok, false) THEN
      RAISE EXCEPTION 'OPS_SCOPE_CONTRACT_INCOMPATIBLE' USING ERRCODE = '55000';
    END IF;
  ELSE
    EXECUTE $function$
      CREATE FUNCTION public.get_my_floor_operator_scope()
      RETURNS TABLE (club_id uuid, can_owner boolean, can_cashier boolean, can_floor boolean)
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = public
      AS $fn$
        WITH actor AS (SELECT auth.uid() AS user_id), scope_rows AS (
          SELECT c.id, true, false, false
          FROM public.clubs c CROSS JOIN actor a
          WHERE c.owner_id = a.user_id
          UNION ALL
          SELECT cc.club_id, false, true, false
          FROM public.club_cashiers cc CROSS JOIN actor a WHERE cc.user_id = a.user_id
          UNION ALL
          SELECT cf.club_id, false, false, true
          FROM public.club_floors cf CROSS JOIN actor a WHERE cf.user_id = a.user_id
        )
        SELECT club_id, bool_or(can_owner), bool_or(can_cashier), bool_or(can_floor)
        FROM scope_rows GROUP BY club_id
      $fn$
    $function$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_my_floor_operator_scope() FROM PUBLIC, anon, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_my_floor_operator_scope() TO authenticated';
  END IF;
END;
$baseline$;

-- ROLLBACK: owner-gated forward migration only. Do not remove membership data
-- until every deployed consumer has been retired.

COMMIT;
