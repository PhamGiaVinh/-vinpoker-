import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMigration,atomicSql,classifyPreflight,executePackage} from './dealer-policy-57-protected-apply.mjs';
const baseline={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('protected57 workflow binds owner exact source checks and recovery',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/dealer-policy-57-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ["github.ref == 'refs/heads/main'",'APPLY_DEALER_POLICY_57_',
  'INITIAL_ACTOR','TRIGGERING_ACTOR','GITHUB_REPOSITORY_OWNER','.head.sha','.state',
  'runtime postgres-17-integrated release-runner-postgres-17 collision-guard reject-sensitive-vars-context',
  'floor-v3-recovery-backup.yml','floor-v3-restore-verification-','RECOVERY_BASE_SHA',
  'dealer-swing-production-critical','vinpoker-production-database-release',
  'dealer-policy-57-protected-apply.mjs plan','dealer-policy-57-protected-apply.mjs apply'])
  assert.ok(yaml.includes(required),required);
 assert.ok(!yaml.includes('tracker-card-56-protected-apply.mjs'));
});
test('exact57 rejects drift and modified allowlist',()=>{
 classifyPreflight(baseline);
 for(const delta of [{database:'test'},{actor:'service_role'},{existing:1},{baseline:false},{baseline:null}])
  assert.throws(()=>classifyPreflight({...baseline,...delta}));
 for(const field of ['version','name','filename','hash','sql'])
  assert.throws(()=>atomicSql({...loadMigration(),[field]:'changed'}));
});
test('exact57 inserts receipt inside outer transaction after mutation',()=>{
 const sql=atomicSql();
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/policy57_precondition_drift/);
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')>sql.indexOf('$tenant57$;'));
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
});
for(const observed of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null]){
 test(`lost response stops without retry: ${JSON.stringify(observed)}`,()=>{
  let writes=0;const reports=[];
  const transport={json:sql=>{if(sql.includes('current_database()'))return baseline;
    if(observed===null)throw Error('unavailable');return observed;},
   execute:()=>{writes++;throw Error('lost response');}};
  assert.throws(()=>executePackage(transport,x=>reports.push(x)),/outcome requires review/);
  assert.equal(writes,1);assert.equal(reports.length,1);assert.match(reports[0],/no retry/);
 });
}
test('successful receipt and object postcheck precede PASS',()=>{
 let writes=0;const reports=[];
 executePackage({json:sql=>sql.includes('current_database()')?baseline:{count:1,exact:true},
  execute:()=>{writes++;}},x=>reports.push(x));
 assert.equal(writes,2);assert.equal(reports.at(-1),'POLICY57_OBJECT_POSTCHECK_PASS');
});
test('wrong receipt prevents object check and PASS',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:sql=>sql.includes('current_database()')?baseline:{count:0,exact:false},
  execute:()=>{writes++;}},x=>reports.push(x)),/receipt postcheck/);
 assert.equal(writes,1);assert.deepEqual(reports,[]);
});
test('failed object postcheck cannot emit PASS',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:sql=>sql.includes('current_database()')?baseline:{count:1,exact:true},
  execute:()=>{if(++writes===2)throw Error('object drift');}},x=>reports.push(x)),/object drift/);
 assert.equal(writes,2);assert.deepEqual(reports,[]);
});
