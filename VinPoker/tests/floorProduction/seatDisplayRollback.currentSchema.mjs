import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// TEST ONLY: prove a forward rollback restores exact baseline bodies without
// rewriting seats, receipts or ledger. Always roll back this rehearsal itself.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const migration=readFileSync('supabase/migrations/20270128000032_tournament_seat_display_preservation_v1.sql','utf8').replaceAll('\r','');
const start=migration.indexOf(' FOR r IN SELECT * FROM (VALUES');
const end=migration.indexOf('\n LOOP',start);
assert.ok(start>=0 && end>start);
const changes=migration.slice(start,end);
const sql=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $rollback$
DECLARE r record; fn regprocedure; definition text; baseline text; body text;
BEGIN
${changes}
 LOOP
  fn:=to_regprocedure(r.signature);
  definition:=replace(pg_get_functiondef(fn),E'\\r','');
  IF length(definition)-length(replace(definition,r.new_text,''))<>length(r.new_text) THEN
   RAISE EXCEPTION 'rollback_patch_drift: %',r.signature; END IF;
  baseline:=replace(definition,r.new_text,r.old_text);
  IF r.new_text_2 IS NOT NULL THEN
   IF length(baseline)-length(replace(baseline,r.new_text_2,''))<>length(r.new_text_2) THEN
    RAISE EXCEPTION 'rollback_second_patch_drift: %',r.signature; END IF;
   baseline:=replace(baseline,r.new_text_2,r.old_text_2);
  END IF;
  EXECUTE baseline;
  SELECT replace(prosrc,E'\\r','') INTO body FROM pg_proc WHERE oid=fn;
  IF md5(body) IS DISTINCT FROM r.expected_md5 THEN
   RAISE EXCEPTION 'rollback_baseline_digest_mismatch: %',r.signature; END IF;
 END LOOP;
END $rollback$;
DROP TRIGGER trg_tournament_seat_display_preserve_v1 ON public.tournament_seats;
DROP FUNCTION floor_private.preserve_tournament_seat_display_v1();
DROP FUNCTION floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer);
ROLLBACK;`;
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('SEAT_DISPLAY_EIGHT_FUNCTION_ROLLBACK_REHEARSAL_PASS');
