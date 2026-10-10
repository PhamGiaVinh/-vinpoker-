import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadPackage,atomicSql} from './floor-37-47-release-plan.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
test('exact eleven-entry ordered allowlist, no historical replay',()=>{
 const items=loadPackage();
 assert.equal(items.length,11);
 assert.deepEqual(items.map(x=>x.version),Array.from({length:11},(_,i)=>`202701280000${37+i}`));
 for(const item of items){
  const sql=atomicSql(item),shape=scanMigrationSource(sql);
  assert.equal(shape.mode,'outer-transaction');
  assert.equal((sql.match(/INSERT INTO supabase_migrations.schema_migrations/g)||[]).length,1);
  assert.ok(sql.indexOf('floor_package_receipt_exists_stop')<sql.indexOf('INSERT INTO supabase_migrations'));
  assert.match(sql,/cardinality\(statements\)=1/);
  assert.match(sql,/floor_package_predecessor_drift/);
  assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
  assert.ok(sql.slice(shape.insertAfterBegin,shape.insertBeforeCommit).includes('INSERT INTO supabase_migrations'));
 }
});
test('reject tampered SQL, hash, identity and outside-package entry',()=>{
 const item=loadPackage()[0];
 for(const delta of [{sql:item.sql+'\nSELECT 1;'},{hash:'0'.repeat(64)},{name:'other_name'},{version:'20270128000028'}]){
  assert.throws(()=>atomicSql({...item,...delta}),/Not exact allowlist entry/);
 }
});
test('CLI cannot apply, export SQL or accept unknown arguments',()=>{
 const filename=fileURLToPath(new URL('./floor-37-47-release-plan.mjs',import.meta.url));
 for(const mode of ['apply','postcheck','--sql']){
  const result=spawnSync(process.execPath,[filename,mode],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/Offline plan only/);
 }
});
test('PG17 missing/different predecessor and existing receipt deny before DDL',
 {skip:process.env.FLOOR_RELEASE_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
 const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 const probe=query("SELECT inet_server_addr()='127.0.0.1' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AND to_regclass('supabase_migrations.schema_migrations') IS NULL;");
 assert.equal(probe.status,0,probe.stderr);assert.equal(probe.stdout.trim(),'t','isolated schema-only database required');
 const before=query('SELECT count(*) FROM pg_proc;');assert.equal(before.status,0,before.stderr);
 const item=loadPackage().at(-1);
 for(const [seed,expected] of [
  ['', 'floor_package_predecessor_drift'],
  ["INSERT INTO supabase_migrations.schema_migrations VALUES('20270128000046','wrong_name',ARRAY['wrong SQL']);",'floor_package_predecessor_drift'],
  [`INSERT INTO supabase_migrations.schema_migrations VALUES('${item.version}','${item.name}',ARRAY['wrong SQL']);`,'floor_package_receipt_exists_stop']
 ]){
  // Setup and attempted apply share one transaction; failure rolls back the
  // synthetic ledger as well. No existing ledger is modified or removed.
  const result=query(`BEGIN;CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);${seed}\n${atomicSql(item)}`);
  assert.notEqual(result.status,0);assert.ok(result.stderr.includes(expected),result.stderr);
  const after=query("SELECT count(*) FROM pg_proc;SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;");
  assert.equal(after.status,0,after.stderr);assert.equal(after.stdout.trim(),`${before.stdout.trim()}\nt`);
 }
});
test('PG17 exact 46/47 commit SQL and matching ledger; replay stops',
 {skip:process.env.FLOOR_RELEASE_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGDATABASE,'vinpoker_ops_legacy_full36','owned through-45 template only');
 const database=`vinpoker_ops_release_${randomUUID().replaceAll('-','').slice(0,12)}`;
 const created=spawnSync('createdb',['--template',process.env.PGDATABASE,database],{encoding:'utf8'});
 assert.equal(created.status,0,created.stderr);
 const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:{...process.env,PGDATABASE:database}});
 const items=loadPackage(),prior=items.find(x=>x.version.endsWith('45'));
 const seeded=query(`BEGIN;CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);INSERT INTO supabase_migrations.schema_migrations VALUES('${prior.version}','${prior.name}',ARRAY[$seed45$${prior.sql}$seed45$]);COMMIT;`);
 assert.equal(seeded.status,0,seeded.stderr);
 for(const item of items.slice(-2)){
  const applied=query(atomicSql(item));assert.equal(applied.status,0,applied.stderr);
  const receipt=query(`SELECT name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${item.hash}' FROM supabase_migrations.schema_migrations WHERE version='${item.version}';`);
  assert.equal(receipt.status,0,receipt.stderr);assert.equal(receipt.stdout.trim(),'t');
  const replay=query(atomicSql(item));assert.notEqual(replay.status,0);
  assert.ok(replay.stderr.includes('floor_package_receipt_exists_stop'),replay.stderr);
 }
 const postcheck=readFileSync(new URL('../../tests/floorProduction/package37_47.readonly-postcheck.sql',import.meta.url),'utf8');
 const checked=query(postcheck);assert.equal(checked.status,0,checked.stderr);
 const count=query('SELECT count(*) FROM supabase_migrations.schema_migrations;');
 assert.equal(count.stdout.trim(),'3');
 console.log(`LOCAL_ATOMIC_46_47_POSTCHECK_PASS database=${database}; retained for inspection, not production evidence`);
});
