import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyPreflight,executePackage,postcheckSql} from './floor-49-50-protected-apply.mjs';
const ready={database:'postgres',actor:'postgres',existing:0,baseline:true,cron:true,jobs:0};
test('preflight rejects every wrong target, predecessor, collision or missing scheduler',()=>{
 classifyPreflight(ready);
 for(const changed of [{database:'other'},{actor:'service_role'},{existing:1},{baseline:false},{cron:false},{jobs:1}])assert.throws(()=>classifyPreflight({...ready,...changed}),/precondition drift/);
});
test('successful package verifies both receipts and objects before continuing',()=>{
 const writes=[],reports=[];
 executePackage({execute:sql=>writes.push(sql),json:sql=>sql.includes("'existing'")?ready:sql.includes("'count'")?{count:1,exact:true}:{functions:true,cursor:true,cursor_row:true,trigger:true,scheduler:true}},x=>reports.push(x));
 assert.equal(writes.length,2);assert.equal(reports.filter(x=>x.startsWith('COMMITTED_EXACT')).length,2);
 assert.match(writes[1],/20270128000049/);
});
test('lost response at49 reconciles receipt but never retries or applies50',()=>{
 for(const receipt of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false}]){
  let writes=0;const reports=[];
  assert.throws(()=>executePackage({execute:()=>{writes++;throw Error('response lost');},json:sql=>sql.includes("'existing'")?ready:receipt},x=>reports.push(x)),/requires review/);
  assert.equal(writes,1);assert.match(reports[0],/no retry or downstream apply/);
 }
});
test('receipt or object failure stops before scheduler mutation',()=>{
 for(const failed of ['receipt','functions','cursor','cursor_row','trigger','scheduler']){
  let writes=0;
  assert.throws(()=>executePackage({execute:()=>writes++,json:sql=>sql.includes("'existing'")?ready:sql.includes("'count'")?{count:1,exact:failed!=='receipt'}:{functions:true,cursor:true,cursor_row:true,trigger:true,scheduler:true,[failed]:false}}),/drift|postcheck/);
  assert.equal(writes,1);
 }
});
test('postcheck pins exact schedule/owner/command and browser denials',()=>{
 assert.throws(()=>postcheckSql('other'),/Unknown/);
 const sql=postcheckSql('20270128000050');
 assert.match(sql,/count\(\*\)=1 AND bool_and/);
 assert.match(sql,/username='postgres'/);
 assert.match(sql,/NOT has_function_privilege\('anon'/);
 assert.match(sql,/NOT has_table_privilege\('service_role'/);
});
test('workflow preserves owner, exact SHA checks, recovery and protected environment',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/floor-49-50-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ['github.ref == \'refs/heads/main\'','APPLY_FLOOR_49_50_','environment: dealer-swing-production-critical',
  'vinpoker-production-database-release','cancel-in-progress: false','floor-v3-recovery-backup.yml',
  'floor-v3-restore-verification-','test "$INITIAL_ACTOR" = "$GITHUB_REPOSITORY_OWNER"',
  'test "$(jq -r .head.sha <<<"$pr")" = "$RELEASE_SHA"','floor-49-50-protected-apply.mjs apply'])assert.ok(yaml.includes(required),required);
 assert.ok(!yaml.includes('floor-48-protected-apply.mjs'));
});
