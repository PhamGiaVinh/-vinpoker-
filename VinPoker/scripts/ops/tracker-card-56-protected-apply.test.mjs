import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,classifyPreflight,executePackage} from './tracker-card-56-protected-apply.mjs';
const baseline={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('exact56 refuses preflight drift and modified allowlist',()=>{
 classifyPreflight(baseline);
 for(const delta of [{database:'test'},{actor:'service_role'},{existing:1},{baseline:false},{baseline:null}])assert.throws(()=>classifyPreflight({...baseline,...delta}));
 for(const field of ['version','name','filename','hash','sql'])assert.throws(()=>atomicSql({...loadMigration(),[field]:'changed'}));
});
test('exact56 binds SQL and receipt inside one outer transaction',()=>{
 const sql=atomicSql();
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/card56_precondition_drift/);
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
 assert.match(sql,/bfdd|card56_receipt/);
});
test('unknown response never retries, even when receipt says committed',()=>{
 let writes=0;const reports=[];
 const transport={json:sql=>sql.includes('current_database()')?baseline:{count:1,exact:true},execute:()=>{writes++;throw Error('lost response');}};
 assert.throws(()=>executePackage(transport,x=>reports.push(x)),/outcome requires review/);
 assert.equal(writes,1);assert.deepEqual(reports,['STOP56 receipt=committed-exact; no retry']);
});
test('successful apply checks receipt and objects; wrong receipt stops',()=>{
 let writes=0;
 executePackage({json:sql=>sql.includes('current_database()')?baseline:{count:1,exact:true},execute:()=>{writes++;}});
 assert.equal(writes,2);
 assert.throws(()=>executePackage({json:sql=>sql.includes('current_database()')?baseline:{count:0,exact:false},execute:()=>{}}),/receipt postcheck/);
});
test('object postcheck transport failure cannot emit committed PASS markers',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:sql=>sql.includes('current_database()')?baseline:{count:1,exact:true},
  execute:()=>{if(++writes===2)throw Error('postcheck transport failed');}},x=>reports.push(x)),/postcheck transport failed/);
 assert.equal(writes,2);assert.deepEqual(reports,[]);
});
