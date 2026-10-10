import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage,atomicSql,predecessorPredicate} from './floor-49-50-release-plan.mjs';
test('pins only49/50;50 requires exact49 as well as37-48',()=>{
 const items=loadPackage();
 assert.deepEqual(items.map(x=>x.version),['20270128000049','20270128000050']);
 assert.equal((predecessorPredicate(items[0]).match(/EXISTS\(/g)||[]).length,12);
 assert.equal((predecessorPredicate(items[1]).match(/EXISTS\(/g)||[]).length,13);
 for(const item of items){
  const sql=atomicSql(item);
  const firstMutationSeam=sql.indexOf(item.version.endsWith('49')?'DO $guard$':'DO $schedule$');
  assert.ok(firstMutationSeam>0&&sql.indexOf('floor49_50_predecessor_drift')<firstMutationSeam);
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
  assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
  assert.match(sql,/floor49_50_receipt_exists_stop/);
 }
});
test('rejects altered payload and out-of-package versions',()=>{
 for(const item of loadPackage())for(const changed of [{sql:item.sql+'\n'},{name:'other'},{version:'20270128000051'},{hash:'0'.repeat(64)},{filename:'other.sql'}]){
  assert.throws(()=>atomicSql({...item,...changed}),/Not exact49\/50/);
 }
});
