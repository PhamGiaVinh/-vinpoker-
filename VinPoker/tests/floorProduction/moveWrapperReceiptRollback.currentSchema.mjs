import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const migration=readFileSync('supabase/migrations/20270128000034_floor_move_wrapper_receipt_v1.sql','utf8').replaceAll('\r','');
const replacement=migration.match(/new_clause text := \$replacement\$([\s\S]*?)\$replacement\$/)?.[1];
assert.ok(replacement);
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`BEGIN;
DO $rollback$
DECLARE fn regprocedure := 'public.move_player_seat_v3(uuid,uuid,integer,bigint,bigint,uuid)'::regprocedure;
 body text; replacement text := $replacement$${replacement}$replacement$;
BEGIN
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 IF length(body)-length(replace(body,replacement,''))<>length(replacement) THEN
  RAISE EXCEPTION 'wrapper_rollback_patch_drift'; END IF;
 EXECUTE replace(body,replacement,'IF FOUND THEN RETURN v_receipt.result; END IF;');
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=fn)<>'fba82420a2586c9a1d45f70905b71a97' THEN
  RAISE EXCEPTION 'wrapper_rollback_baseline_digest_mismatch'; END IF;
END $rollback$;
ROLLBACK;`});
assert.equal(result.status,0,result.stderr);
console.log('MOVE_WRAPPER_RECEIPT_ROLLBACK_REHEARSAL_PASS');
