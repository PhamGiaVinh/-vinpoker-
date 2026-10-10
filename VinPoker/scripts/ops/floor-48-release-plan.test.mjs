import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,predecessorPredicate} from './floor-48-release-plan.mjs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadPackage} from './floor-37-47-release-plan.mjs';
import {postcheckSql} from './floor-48-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('pins exactly48 and preserves all37-47 predecessor receipts',()=>{
 const item=loadMigration(),sql=atomicSql(item);
 assert.equal(item.version,'20270128000048');
 assert.equal((predecessorPredicate().match(/EXISTS\(/g)||[]).length,11);
 const create=sql.indexOf('CREATE FUNCTION public.move_player_seat_v5');
 assert.ok(create>0&&sql.indexOf('floor48_predecessor_drift')<create);
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
 assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
 assert.match(sql,/floor48_receipt_exists_stop/);
});
test('rejects altered SQL, name, version and hash before execution',()=>{
 const item=loadMigration();
 for(const changed of [{sql:item.sql+'\n'},{name:'other'},{version:'20270128000049'},{hash:'0'.repeat(64)}]){
  assert.throws(()=>atomicSql({...item,...changed}),/Not exact/);
 }
});
test('PG17 atomic48 commit, replay rejection and failure rollback', {skip:process.env.FLOOR48_PG_TEST!=='1'},()=>{
 const database=`vinpoker_ops_release48_${randomUUID().replaceAll('-','').slice(0,12)}`;
 const command=(args,input)=>process.platform==='win32'
  ? spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--',...args],{input,encoding:'utf8',maxBuffer:2*1024*1024})
  : spawnSync(args[0],args.slice(1),{input,encoding:'utf8',maxBuffer:2*1024*1024});
 const template=process.platform==='win32'?'vinpoker_ops_v12_clean45':'vinpoker_ops_through47';
 const created=command(['createdb','-h','127.0.0.1','-p','55441','-U','postgres','--template',template,database]);
 assert.equal(created.status,0,created.stderr);
 const query=sql=>command(['psql','-h','127.0.0.1','-p','55441','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],sql);
 const probe=query("SELECT inet_server_addr()='127.0.0.1' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AND to_regclass('supabase_migrations.schema_migrations') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.floor_pending_tracker_moves'::regclass AND attname='requested_reason' AND NOT attisdropped);");
 assert.equal(probe.status,0,probe.stderr);assert.equal(probe.stdout.trim(),'t','isolated through47 schema-only template required');
 const item=loadMigration();
 const seed=()=>`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);${loadPackage().map((p,i)=>`INSERT INTO supabase_migrations.schema_migrations VALUES('${p.version}','${p.name}',ARRAY[$seed${i}$${p.sql}$seed${i}$]);`).join('\n')}`;
 for(const [setup,expected] of [
  ['', 'floor48_predecessor_drift'],
  [`${seed()}ALTER TABLE public.floor_pending_tracker_moves ADD COLUMN requested_reason integer;`,'move_or_queue_definition_drift'],
  [`${seed()}CREATE FUNCTION floor_private.reject48_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected48_receipt_failure'; END $$;CREATE TRIGGER reject48 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION floor_private.reject48_receipt();`,'injected48_receipt_failure'],
 ]){
  const minimal=setup||'CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);';
  const failed=query(`BEGIN;${minimal}\n${atomicSql(item)}`);
  assert.notEqual(failed.status,0);assert.ok(failed.stderr.includes(expected),failed.stderr);
  const intact=query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL AND to_regprocedure('public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.floor_pending_tracker_moves'::regclass AND attname='requested_reason' AND NOT attisdropped) AND md5(replace(prosrc,chr(13),''))='abe83b6d46e7209f4756c4e5f87f4e27' FROM pg_proc WHERE oid='floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure;");
  assert.equal(intact.status,0,intact.stderr);assert.equal(intact.stdout.trim(),'t');
 }
 assert.equal(query(`BEGIN;${seed()}COMMIT;`).status,0);
 const applied=query(atomicSql(item));assert.equal(applied.status,0,applied.stderr);
 const receipt=query(receiptSql(item));assert.equal(receipt.status,0,receipt.stderr);assert.deepEqual(JSON.parse(receipt.stdout.trim()),{count:1,exact:true});
 const checked=query(postcheckSql());assert.equal(checked.status,0,checked.stderr);assert.deepEqual(JSON.parse(checked.stdout.trim()),{functions:true,column:true});
 const replay=query(atomicSql(item));assert.notEqual(replay.status,0);assert.match(replay.stderr,/floor48_receipt_exists_stop/);
 console.log(`LOCAL_ATOMIC48_RECEIPT_ROLLBACK_POSTCHECK_PASS ${database}; retained, not production proof`);
});
