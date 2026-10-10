\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ DECLARE v_signature text;v_expected text;v_actual text; BEGIN
 FOR v_signature,v_expected IN SELECT * FROM (VALUES
  ('public.show_hole_cards(uuid,jsonb,uuid)','8afab0698b5f9bba5c84b9318171990b'),
  ('public.update_community_cards(uuid,jsonb,uuid)','b29a4b0ba84cb967deb8276390b26ee4')) expected(signature,body_hash)
 LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO v_actual FROM pg_proc WHERE oid=v_signature::regprocedure;
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'CARD_POSTCHECK_BODY_MISMATCH: %',v_signature; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=v_signature::regprocedure
   AND pg_get_userbyid(p.proowner)='postgres' AND NOT p.prosecdef
   AND p.proconfig=ARRAY['search_path=public']) THEN
   RAISE EXCEPTION 'CARD_POSTCHECK_AUTHORITY_MISMATCH: %',v_signature;
  END IF;
  IF NOT has_function_privilege('authenticated',v_signature,'EXECUTE')
   OR has_function_privilege('anon',v_signature,'EXECUTE')
   OR has_function_privilege('service_role',v_signature,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=v_signature::regprocedure AND
     (a.grantee NOT IN ('postgres'::regrole::oid,'authenticated'::regrole::oid)
      OR a.grantor<>'postgres'::regrole::oid OR a.is_grantable)) THEN
   RAISE EXCEPTION 'CARD_POSTCHECK_ACL_MISMATCH: %',v_signature;
  END IF;
 END LOOP;
 RAISE NOTICE 'CARD56_READONLY_OBJECT_POSTCHECK_PASS';
END $$;
ROLLBACK;
