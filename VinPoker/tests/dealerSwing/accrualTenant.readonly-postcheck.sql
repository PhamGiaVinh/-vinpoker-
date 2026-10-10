\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $postcheck$
DECLARE v_oid oid := to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamptz,text)');
BEGIN
  IF v_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=v_oid
      AND md5(replace(p.prosrc,chr(13),''))='70839e7ef76e135897c445068e3b4085'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=public']::text[]
  ) THEN RAISE EXCEPTION 'POLICY57_OBJECT_DRIFT'; END IF;
  IF NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR has_function_privilege('anon',v_oid,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'POLICY57_EFFECTIVE_ACL_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=v_oid AND (
        a.grantee NOT IN ('postgres'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
        OR a.grantor <> 'postgres'::regrole::oid
        OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'POLICY57_EXPLICIT_ACL_DRIFT';
  END IF;
END;
$postcheck$;
COMMIT;
\echo POLICY57_READONLY_OBJECT_POSTCHECK_PASS
