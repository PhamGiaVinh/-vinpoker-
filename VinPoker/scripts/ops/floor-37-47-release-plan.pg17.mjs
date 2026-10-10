// Local-only full-chain atomic receipt test, never a production apply command.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonicalSqlText} from './ops-1359-release-gate.mjs';
import {loadPackage,atomicSql,baseline36ArraySql} from './floor-37-47-release-plan.mjs';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const database=`vinpoker_ops_atomic_${randomUUID().replaceAll('-','').slice(0,12)}`;
const env={...process.env,PGDATABASE:database};
function run(binary,args,input){
 const result=spawnSync(binary,args,{input,encoding:'utf8',env,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
run('createdb',[database]);
run(process.execPath,['scripts/ops/restore-schema-test-baseline.mjs']);
assert.equal(run('psql',['-X','-qAt','-c',"SELECT inet_server_addr()='127.0.0.1' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999;"]),'t');
const query=sql=>run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],sql);
for(const filename of readdirSync('supabase/migrations').filter(f=>/^202701280000\d{2}_/.test(f)).sort()){
 const n=Number(filename.slice(12,14));
 if(n<13||n>36||[20,21].includes(n))continue;
 query(canonicalSqlText(readFileSync(`supabase/migrations/${filename}`,'utf8')));
}
query(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);INSERT INTO supabase_migrations.schema_migrations VALUES('20270128000036','floor_manual_entry_roundtrip_v1',${baseline36ArraySql()});`);
const items=loadPackage();
// Receipt failure must roll back the function mutation in the same transaction.
const before=query("SELECT md5(pg_get_functiondef('public.close_tournament_table(uuid,text,text)'::regprocedure));");
for(const mutation of [
 "name='wrong_name'",
 "statements=ARRAY['wrong hash']::text[]",
 "statements=statements[1:5]",
 "statements=ARRAY(SELECT s FROM unnest(statements) WITH ORDINALITY AS x(s,n) ORDER BY n DESC)",
 "statements[4]=statements[4]||E'\\n-- different source'"
]){
 query(`UPDATE supabase_migrations.schema_migrations SET ${mutation} WHERE version='20270128000036';`);
 const denied=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:atomicSql(items[0]),encoding:'utf8',env});
 assert.notEqual(denied.status,0);assert.match(denied.stderr,/floor_package_predecessor_drift/);
 assert.equal(query("SELECT md5(pg_get_functiondef('public.close_tournament_table(uuid,text,text)'::regprocedure));"),before);
 assert.equal(query('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'1');
 query(`UPDATE supabase_migrations.schema_migrations SET name='floor_manual_entry_roundtrip_v1',statements=${baseline36ArraySql()} WHERE version='20270128000036';`);
}
console.log('BASELINE36_NAME_HASH_CARDINALITY_ORDER_DENIAL_PASS');
query("ALTER TABLE supabase_migrations.schema_migrations ADD CONSTRAINT injected_receipt_failure CHECK(version<>'20270128000037');");
const failed=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:atomicSql(items[0]),encoding:'utf8',env});
assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected_receipt_failure/);
assert.equal(query("SELECT md5(pg_get_functiondef('public.close_tournament_table(uuid,text,text)'::regprocedure));"),before);
assert.equal(query('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'1');
query('ALTER TABLE supabase_migrations.schema_migrations DROP CONSTRAINT injected_receipt_failure;');
console.log('ATOMIC_DDL_RECEIPT_FAILURE_ROLLBACK_PASS');
for(const item of items){
 query(atomicSql(item));
 assert.equal(query(`SELECT name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${item.hash}' FROM supabase_migrations.schema_migrations WHERE version='${item.version}';`),'t');
 console.log(`ATOMIC_APPLY_RECEIPT_PASS ${item.version}`);
}
query(readFileSync('tests/floorProduction/package37_47.readonly-postcheck.sql','utf8'));
assert.equal(query('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'12');
console.log(`FULL_37_47_ATOMIC_POSTCHECK_PASS database=${database}; local retained, network20/21 omitted, not live proof`);
