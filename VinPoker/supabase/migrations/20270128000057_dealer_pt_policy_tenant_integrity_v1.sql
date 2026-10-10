-- Restrict the existing policy writer to exact club owner or super_admin.
-- No policy values, wage computation, timestamps, history or grants change.
-- ROLLBACK: transaction failure is atomic. A live compensation requires a new
-- reviewed forward migration; do not erase receipts or restore the unsafe
-- global club_admin branch as normal operation.
BEGIN;
DO $tenant57$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)');
  v_definition text;
  v_metadata jsonb;
  v_after jsonb;
  v_anchor text := E'    or public.has_role(v_actor, ''club_admin''::app_role)\n';
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'policy57_missing_dependency'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
    AND pg_catalog.md5(pg_catalog.replace(p.prosrc,pg_catalog.chr(13),''))='3384c36a062fa1b1faca1c9b66b3c39b'
    AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=public']::text[]) THEN
    RAISE EXCEPTION 'policy57_predecessor_drift';
  END IF;
  SELECT pg_catalog.jsonb_build_object('owner',p.proowner,'acl',p.proacl,
    'config',p.proconfig,'definer',p.prosecdef,'volatile',p.provolatile)
  INTO v_metadata FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  v_definition := pg_catalog.replace(pg_catalog.pg_get_functiondef(v_oid),pg_catalog.chr(13),'');
  IF (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_anchor,'')))
      /pg_catalog.length(v_anchor) <> 1 THEN RAISE EXCEPTION 'policy57_anchor_drift'; END IF;
  EXECUTE pg_catalog.replace(v_definition,v_anchor,'');
  SELECT pg_catalog.jsonb_build_object('owner',p.proowner,'acl',p.proacl,
    'config',p.proconfig,'definer',p.prosecdef,'volatile',p.provolatile)
  INTO v_after FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  IF v_after IS DISTINCT FROM v_metadata OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
      AND pg_catalog.md5(pg_catalog.replace(p.prosrc,pg_catalog.chr(13),''))='70839e7ef76e135897c445068e3b4085'
  ) THEN RAISE EXCEPTION 'policy57_postcondition_drift'; END IF;
END;
$tenant57$;
COMMIT;
