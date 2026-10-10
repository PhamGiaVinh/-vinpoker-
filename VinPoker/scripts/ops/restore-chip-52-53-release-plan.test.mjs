import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage,atomicSql,dependencyPredicate} from './restore-chip-52-53-release-plan.mjs';
test('only reviewed52/53 exact SQL can enter atomic package',()=>{
 const items=loadPackage();
 assert.deepEqual(items.map(x=>x.version),['20270128000052','20270128000053','20270128000054','20270128000055']);
 for(const item of items){
  for(const field of Object.keys(item)) assert.throws(()=>atomicSql({...item,[field]:item[field]+'changed'}),/allowlist mismatch/);
  const sql=atomicSql(item);
  assert.ok(sql.indexOf('pg_advisory_xact_lock')<sql.indexOf('CREATE FUNCTION'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')>sql.indexOf('CREATE FUNCTION'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
  assert.match(sql,/lock_timeout='5s'/);
  assert.match(sql,/statement_timeout='120s'/);
  assert.match(sql,/to_regprocedure\(/);
 }
 assert.throws(()=>atomicSql({version:'20270128000016'}),/allowlist mismatch/);
});
test('dependency fence requires all reviewed functions and private receipt protections',()=>{
 const sql=dependencyPredicate();
 assert.match(sql,/count\(\*\)=9/);
 assert.match(sql,/LEFT JOIN pg_proc/);
 assert.match(sql,/c.relrowsecurity/);
 for(const role of ['authenticated','anon','service_role'])assert.ok(sql.includes(`NOT has_table_privilege('${role}'`));
 assert.match(sql,/public\.chip_ops_reverse_color_up/);
 assert.match(sql,/floor_private\.restore_busted_player_to_seat/);
});
