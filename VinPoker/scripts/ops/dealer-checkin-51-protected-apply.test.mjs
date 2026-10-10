import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMigration,atomicSql,classifyPreflight,executePackage,postcheckSql} from './dealer-checkin-51-protected-apply.mjs';
import {scanMigrationSource} from './ops-1359-release-gate.mjs';
import {readFileSync} from 'node:fs';
const ready={database:'postgres',actor:'postgres',existing:0,function_absent:true,baseline:true};
test('exact51 rejects target, existing receipt/function and dependency drift',()=>{
 classifyPreflight(ready);
 for(const change of [{database:'other'},{actor:'service_role'},{existing:1},{function_absent:false},{baseline:false},{baseline:null}])
  assert.throws(()=>classifyPreflight({...ready,...change}));
});
test('atomic51 rejects any changed identity or SQL and retains one transaction',()=>{
 const item=loadMigration();
 for(const key of ['version','name','hash','filename','sql'])assert.throws(()=>atomicSql({...item,[key]:'other'}));
 const sql=atomicSql(item);
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/dealer51_precondition_drift/);
 assert.match(sql,/INSERT INTO supabase_migrations.schema_migrations/);
 assert.equal(scanMigrationSource(sql).mode,'outer-transaction');
});
test('success verifies exact receipt and restricted function before reporting',()=>{
 const writes=[],reports=[];
 executePackage({execute:s=>writes.push(s),json:s=>s.includes("'existing'")?ready:s.includes("'count'")?{count:1,exact:true}:{function:true}},s=>reports.push(s));
 assert.equal(writes.length,1);assert.match(reports[1],/OBJECT_POSTCHECK_PASS/);
});
test('lost apply response never retries even when receipt committed',()=>{
 for(const receipt of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false}]){
  let writes=0;const reports=[];
  assert.throws(()=>executePackage({execute:()=>{writes++;throw Error('lost');},json:s=>s.includes("'existing'")?ready:receipt},s=>reports.push(s)),/requires review/);
  assert.equal(writes,1);assert.match(reports[0],/no retry/);
 }
});
test('postcheck rejects object and receipt failures',()=>{
 for(const failed of ['receipt','function'])assert.throws(()=>executePackage({execute:()=>{},json:s=>s.includes("'existing'")?ready:s.includes("'count'")?{count:1,exact:failed!=='receipt'}:{function:failed!=='function'}}));
 assert.match(postcheckSql(),/provolatile='s'/);assert.match(postcheckSql(),/NOT has_function_privilege\('anon'/);
});
test('workflow preserves exact source checks, recovery, normal protected approval and no broad apply',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/dealer-checkin-51-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ["github.ref == 'refs/heads/main'",'APPLY_DEALER_51_',
 'environment: dealer-swing-production-critical','vinpoker-production-database-release',
 'cancel-in-progress: false','floor-v3-recovery-backup.yml','floor-v3-restore-verification-',
 'test "$INITIAL_ACTOR" = "$GITHUB_REPOSITORY_OWNER"',
 'test "$(jq -r .head.sha <<<"$pr")" = "$RELEASE_SHA"',
 'dealer-checkin-51-protected-apply.mjs apply'])assert.ok(yaml.includes(required),required);
 assert.ok(!/db push|db reset|functions deploy|floor-49-50-protected-apply/.test(yaml));
});
