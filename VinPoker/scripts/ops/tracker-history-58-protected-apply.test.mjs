import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMigration,atomicSql,classifyPreflight,executePackage} from './tracker-history-58-protected-apply.mjs';
const baseline={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('workflow preserves owner exact source checks recovery and shared release gate',()=>{
 const yaml=readFileSync(new URL('../../../.github/workflows/tracker-history-58-protected-apply.yml',import.meta.url),'utf8');
 for(const required of ["github.ref == 'refs/heads/main'",'APPLY_TRACKER_HISTORY_58_',
 'INITIAL_ACTOR','TRIGGERING_ACTOR','GITHUB_REPOSITORY_OWNER','.head.sha','.state',
 'runtime postgres-17-integrated release-runner-postgres-17 collision-guard reject-sensitive-vars-context',
 'floor-v3-recovery-backup.yml','floor-v3-restore-verification-','RECOVERY_BASE_SHA',
 'dealer-swing-production-critical','vinpoker-production-database-release',
 'tracker-history-58-protected-apply.mjs plan','tracker-history-58-protected-apply.mjs apply'])assert.ok(yaml.includes(required),required);
 assert.ok(!yaml.includes('dealer-policy-57-protected-apply.mjs'));
});
test('exact58 rejects preflight and allowlist drift',()=>{
 classifyPreflight(baseline);
 for(const delta of [{database:'test'},{actor:'service_role'},{existing:1},{baseline:false},{baseline:null}])assert.throws(()=>classifyPreflight({...baseline,...delta}));
 for(const field of ['version','name','filename','hash','sql'])assert.throws(()=>atomicSql({...loadMigration(),[field]:'changed'}));
});
test('receipt follows all DDL inside outer transaction',()=>{
 const sql=atomicSql();
 assert.match(sql,/history58_precondition_drift/);
 assert.match(sql,/pg_advisory_xact_lock\(280000,3747\)/);
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')>sql.indexOf('EXECUTE FUNCTION floor_private.invalidate_new_hand_identity_chain_v1();'));
 assert.ok(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')<sql.lastIndexOf('COMMIT;'));
});
for(const observed of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null])test(`unknown commit stops without retry ${JSON.stringify(observed)}`,()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>{if(q.includes('current_database()'))return baseline;if(observed===null)throw Error('unavailable');return observed;},execute:()=>{writes++;throw Error('lost response');}},x=>reports.push(x)),/outcome requires review/);
 assert.equal(writes,1);assert.equal(reports.length,1);assert.match(reports[0],/no retry/);
});
test('PASS requires exact receipt and object postcheck',()=>{
 let writes=0;const reports=[];
 executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:true},execute:()=>writes++},x=>reports.push(x));
 assert.equal(writes,2);assert.equal(reports.at(-1),'HISTORY58_OBJECT_POSTCHECK_PASS');
});
test('wrong receipt stops before object check',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:false},execute:()=>writes++},x=>reports.push(x)),/receipt postcheck/);
 assert.equal(writes,1);assert.deepEqual(reports,[]);
});
test('failed postcheck cannot emit PASS',()=>{
 let writes=0;const reports=[];
 assert.throws(()=>executePackage({json:q=>q.includes('current_database()')?baseline:{count:1,exact:true},execute:()=>{if(++writes===2)throw Error('object drift');}},x=>reports.push(x)),/object drift/);
 assert.deepEqual(reports,[]);
});
