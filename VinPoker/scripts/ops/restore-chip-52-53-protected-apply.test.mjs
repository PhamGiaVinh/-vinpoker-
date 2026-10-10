import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyPreflight,executePackage,postcheckSql} from './restore-chip-52-53-protected-apply.mjs';
import {loadPackage} from './restore-chip-52-53-release-plan.mjs';
const ready={database:'postgres',actor:'postgres',existing:0,absent:true,baseline:true};
test('workflow preserves exact owner/source/checks/recovery/protected release gates',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/restore-chip-52-53-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ["github.ref == 'refs/heads/main'",'APPLY_RESTORE_CHIP_52_53_',
  'environment: dealer-swing-production-critical','vinpoker-production-database-release','cancel-in-progress: false',
  'floor-v3-recovery-backup.yml','floor-v3-restore-verification-',
  'test "$INITIAL_ACTOR" = "$GITHUB_REPOSITORY_OWNER"',
  'test "$(jq -r .head.sha <<<"$pr")" = "$RELEASE_SHA"',
  'restore-chip-52-53-protected-apply.mjs apply','restore-chip-52-53-atomic-pg.test.mjs'])assert.ok(yaml.includes(required),required);
 assert.ok(!yaml.includes('dealer-checkin-51-protected-apply.mjs'));
});
test('every wrong target/collision/baseline fails preflight',()=>{
 classifyPreflight(ready);
 for(const change of [{database:'other'},{actor:'service_role'},{existing:1},{absent:false},{baseline:false}])assert.throws(()=>classifyPreflight({...ready,...change}),/precondition drift/);
});
test('both commits require exact receipts and object postchecks',()=>{
 const writes=[],reports=[];
 executePackage({execute:sql=>writes.push(sql),json:sql=>sql.includes("'existing'")?ready:sql.includes("'count'")?{count:1,exact:true}:{function:true}},x=>reports.push(x));
 assert.equal(writes.length,2);assert.equal(reports.filter(x=>x.startsWith('COMMITTED_EXACT')).length,2);
});
test('unknown outcome stops without retry or downstream mutation',()=>{
 for(const receipt of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false}]){
  let writes=0;const reports=[];
  assert.throws(()=>executePackage({execute:()=>{writes++;throw Error('lost');},json:sql=>sql.includes("'existing'")?ready:receipt},x=>reports.push(x)),/requires review/);
  assert.equal(writes,1);assert.match(reports[0],/no retry or downstream apply/);
 }
});
test('receipt and function failures stop before53',()=>{
 for(const failed of ['receipt','function']){
  let writes=0;
  assert.throws(()=>executePackage({execute:()=>writes++,json:sql=>sql.includes("'existing'")?ready:sql.includes("'count'")?{count:1,exact:failed!=='receipt'}:{function:false}}),/postcheck failed/);
  assert.equal(writes,1);
 }
});
test('postchecks pin body, owner, volatility, search path and denied roles',()=>{
 for(const item of loadPackage()){
  const sql=postcheckSql(item);
  for(const expected of [item.bodyHash,"p.provolatile='s'","pg_get_userbyid(p.proowner)='postgres'","NOT has_function_privilege('anon'","NOT has_function_privilege('service_role'"])assert.ok(sql.includes(expected));
 }
 assert.throws(()=>postcheckSql({version:'other'}),/allowlist mismatch/);
});
