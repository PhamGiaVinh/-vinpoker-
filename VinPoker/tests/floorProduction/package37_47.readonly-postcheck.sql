\set ON_ERROR_STOP on
-- Read-only object checks for the newly introduced public seams/private trigger.
-- Not a substitute for migration ledger, existing-function fingerprints or UAT.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
WITH expected(signature,digest,browser_callable) AS (VALUES
 ('floor_private.reconcile_closed_session_attendance_v1()','50b63ccc70293c1a09ab0be1181f12d2',false),
 ('public.can_read_floor_seat_tickets_v1(uuid)','9a95c61c2408a41b723bf0c0f5753fee',true),
 ('public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid)','564330fd262fb9fb7a6c1a1e4d71503f',true),
 ('public.get_floor_seat_ticket_v1(uuid,uuid,text)','93ae64cde6bbcb70394deb3984a8937d',true),
 ('public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)','b09dce8aff87b23e2a5572ebf66433ae',true)
), checks AS (
 SELECT e.signature,COALESCE(
   md5(pg_get_functiondef(p.oid))=e.digest AND p.prosecdef
   AND pg_get_userbyid(p.proowner)='postgres'
   AND p.proconfig=ARRAY['search_path=""']::text[]
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')=e.browser_callable
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'),false) AS passed
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
)
SELECT bool_and(passed) AS all_pass,
 jsonb_agg(jsonb_build_object('signature',signature,'passed',passed) ORDER BY signature) AS function_checks
FROM checks \gset
\echo :function_checks
\if :all_pass
\echo PACKAGE_NEW_FUNCTION_CHECKS_PASS
\else
\echo PACKAGE_NEW_FUNCTION_CHECKS_FAIL
SELECT 1 / 0 AS postcheck_mismatch;
\endif
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE tgrelid='public.table_sessions'::regclass
 AND tgname='trg_reconcile_closed_session_attendance_v1' AND NOT tgisinternal;
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='seat_draw_receipts' ORDER BY policyname;
SELECT (
 (SELECT count(*)=1 FROM pg_trigger
  WHERE tgrelid='public.table_sessions'::regclass
   AND tgname='trg_reconcile_closed_session_attendance_v1' AND NOT tgisinternal
   AND tgenabled='O' AND md5(pg_get_triggerdef(oid))='1c1db07479f0601e0c498c43154c3c04')
 AND (SELECT count(*)=2 FROM pg_policies WHERE schemaname='public' AND tablename='seat_draw_receipts')
 AND EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='seat_draw_receipts'
  AND policyname='seat_draw_receipts_select_authenticated' AND cmd='SELECT'
  AND roles=ARRAY['authenticated']::name[] AND permissive='PERMISSIVE'
  AND md5(qual)='92061bae76705208fdece8edf9cc95fc' AND with_check IS NULL)
 AND EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='seat_draw_receipts'
  AND policyname='seat_draw_receipts_write_club_admin' AND cmd='ALL'
  AND roles=ARRAY['authenticated']::name[] AND permissive='PERMISSIVE'
  AND md5(qual)='0c07c7ebd7970aac3e882b085a6e7a9f' AND with_check IS NULL)
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.seat_draw_receipts'::regclass)
) AS trigger_policy_pass \gset
\if :trigger_policy_pass
\echo PACKAGE_TRIGGER_POLICY_CHECKS_PASS
\else
\echo PACKAGE_TRIGGER_POLICY_CHECKS_FAIL
SELECT 1 / 0 AS postcheck_mismatch;
\endif
ROLLBACK;
