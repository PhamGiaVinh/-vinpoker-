import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Local-only rehearsal of a forward rollback; no seat/receipt/ledger rewrites.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const migration=readFileSync('supabase/migrations/20270128000033_tournament_seat_move_tuple_v1.sql','utf8').replaceAll('\r','');
const start=migration.indexOf(' FOR r IN SELECT * FROM (VALUES');
const end=migration.indexOf('\n LOOP',start);
assert.ok(start>=0 && end>start);
const changes=migration.slice(start,end);
const sql=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $rollback$
DECLARE r record; fn regprocedure; definition text; baseline text;
BEGIN
${changes}
 LOOP
  fn:=to_regprocedure(r.signature);
  definition:=replace(pg_get_functiondef(fn),E'\\r','');
  IF length(definition)-length(replace(definition,r.new_text,''))<>length(r.new_text)
   OR length(definition)-length(replace(definition,r.new_text2,''))<>length(r.new_text2) THEN
   RAISE EXCEPTION 'tuple_rollback_patch_drift: %',r.signature; END IF;
  baseline:=replace(replace(definition,r.new_text,r.old_text),r.new_text2,r.old_text2);
  EXECUTE baseline;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn
    AND md5(replace(prosrc,E'\\r',''))=r.expected_md5) THEN
   RAISE EXCEPTION 'tuple_rollback_baseline_digest_mismatch: %',r.signature; END IF;
 END LOOP;
END $rollback$;
ROLLBACK;`;
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('SEAT_MOVE_TUPLE_TWO_FUNCTION_ROLLBACK_REHEARSAL_PASS');
