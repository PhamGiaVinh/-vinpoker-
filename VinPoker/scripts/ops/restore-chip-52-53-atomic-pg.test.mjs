import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadPackage,dependencyPredicate} from './restore-chip-52-53-release-plan.mjs';
import {postcheckSql} from './restore-chip-52-53-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 exact52/53 DDL and ledger rollback together, preserve partial receipt, reject replay',
 {skip:process.env.RESTORE_CHIP_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.match(process.env.PGDATABASE??'',/^vinpoker_ops_/);
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_database()<>'postgres' AND inet_server_addr()='127.0.0.1'::inet AND current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
 const items=loadPackage();
 assert.equal(check(`SELECT ${dependencyPredicate()};`),'t','exact predecessor definitions required; never substitute hash');
 assert.equal(check(`SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL AND ${items.map(x=>`to_regprocedure('${x.signature}') IS NULL`).join(' AND ')};`),'t','fresh isolated schema clone required');
 check(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION public.reject_restore_chip_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.version=current_setting('test.reject_version',true) THEN RAISE EXCEPTION 'injected_restore_chip_receipt_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject_restore_chip BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject_restore_chip_receipt();`);
 for(const [index,item] of items.entries()){
  const failed=query(`SET test.reject_version='${item.version}';${atomicSql(item)}`);
  assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected_restore_chip_receipt_failure/);
  assert.equal(check(`SELECT to_regprocedure('${item.signature}') IS NULL;`),'t','failed receipt rolls back RPC creation');
  assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:0,exact:false});
  for(const prior of items.slice(0,index)){
   assert.deepEqual(JSON.parse(check(receiptSql(prior))),{count:1,exact:true},'failure preserves every predecessor receipt');
   assert.deepEqual(JSON.parse(check(postcheckSql(prior))),{function:true});
  }
  check(atomicSql(item));
  assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
  assert.deepEqual(JSON.parse(check(postcheckSql(item))),{function:true});
  const replay=query(atomicSql(item));assert.notEqual(replay.status,0);assert.match(replay.stderr,/restore_chip_precondition_drift/);
  assert.deepEqual(JSON.parse(check(receiptSql(item))),{count:1,exact:true});
 }
 check('DROP TRIGGER reject_restore_chip ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject_restore_chip_receipt();');
 console.log('RESTORE_CHIP52_55_ATOMIC_ROLLBACK_RECEIPT_OBJECT_REPLAY_PASS');
});
