-- CLI-created candidate assigned unused forward38 after catalog/live checks.
-- Restore the declared fill_lowest_table policy: table number, not occupancy.
-- Preserve exact session/tenant/capacity/seat-lock/pending-move filters and hash.
-- ROLLBACK: restore pinned previous helper body through reviewed forward SQL;
-- preserve already applied moves and receipts. Old plans must be re-previewed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 fn regprocedure:=to_regprocedure('floor_private.floor_break_plan_rows_v1(uuid,uuid)');
 body text;
 needle text:='ORDER BY occupied.count, gt.table_number, tt.id, seat_no';
BEGIN
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
   AND md5(replace(p.prosrc,chr(13),''))='07391e6efe45f579232af9a23263f9ff'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'break_plan_rows_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'break_plan_policy_patch_not_unique';
 END IF;
 EXECUTE replace(body,needle,'ORDER BY gt.table_number, tt.id, seat_no');
END $patch$;
COMMIT;
