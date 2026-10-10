import test from 'node:test';import assert from 'node:assert/strict';
import {validateContext,classifyPreflight,executePackage,psqlEnvironment} from './floor-37-47-protected-apply.mjs';
const sha='a'.repeat(40),base='b'.repeat(40),now=Date.now();
const env={RELEASE_SHA:sha,SOURCE_CHECKOUT_SHA:sha,GITHUB_SHA:base,GITHUB_REF:'refs/heads/main',GITHUB_ACTIONS:'true',INITIAL_ACTOR:'owner',TRIGGERING_ACTOR:'owner',REPOSITORY_OWNER:'owner',SUPABASE_PROJECT_REF:'orlesggcjamwuknxwcpk',PGHOST:'aws-1-ap-southeast-2.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.orlesggcjamwuknxwcpk',PGDATABASE:'postgres',PGSSLMODE:'require',PGPASSWORD:'local-test-only',RECOVERY_BASE_SHA:base};
const recovery={schemaVersion:1,kind:'vinpoker-restore-verification',sourceSha:base,isolatedRestore:'PASS',tableCountMatch:'PASS',productionMutation:false,ciphertextSha256:'c'.repeat(64),snapshotAt:new Date(now-1000).toISOString()};
test('exact source/owner/project/connection and fresh restore receipt required',()=>{
 validateContext(env,recovery,now);
 for(const delta of [{PGHOST:'localhost'},{PGUSER:'postgres'},{SOURCE_CHECKOUT_SHA:base},{GITHUB_SHA:'invalid'},{GITHUB_REF:'refs/heads/feature'},{TRIGGERING_ACTOR:'outsider'},{GITHUB_ACTIONS:'false'},{PGSSLMODE:'disable'},{PGPASSWORD:''}])assert.throws(()=>validateContext({...env,...delta},recovery,now));
 for(const delta of [{sourceSha:sha},{productionMutation:true},{isolatedRestore:'FAIL'},{ciphertextSha256:''},{snapshotAt:new Date(now-3600001).toISOString()},{snapshotAt:new Date(now+1).toISOString()}])assert.throws(()=>validateContext(env,{...recovery,...delta},now));
});
test('preflight never resumes partial package or accepts baseline drift',()=>{
 const row={database:'postgres',actor:'postgres',pending:0,names:0,baseline:true};classifyPreflight(row);
 for(const delta of [{pending:1},{names:1},{baseline:false},{actor:'service_role'},{database:'other'}])assert.throws(()=>classifyPreflight({...row,...delta}));
});
test('libpq alternate host/service/options cannot redirect the pinned target',()=>{
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.throws(()=>validateContext({...env,[key]:'override'},recovery,now),/Alternate libpq/);
 const controlled=psqlEnvironment({...env,PGHOSTADDR:'127.0.0.1',PGSERVICE:'other',PGOPTIONS:'override',PGAPPNAME:'other',PGPASSFILE:'other'});
 assert.deepEqual(Object.keys(controlled).filter(key=>key.startsWith('PG')).sort(),['PGDATABASE','PGHOST','PGPASSWORD','PGPORT','PGSSLMODE','PGUSER']);
 assert.equal(controlled.PGHOST,env.PGHOST);assert.equal(controlled.PGPASSWORD,env.PGPASSWORD);
});
test('committed response loss reconciles once and stops downstream without retry',()=>{
 let writes=0,reads=0;const messages=[];
 const transport={execute(){writes++;throw Error('response lost');},json(){reads++;return reads===1?{database:'postgres',actor:'postgres',pending:0,names:0,baseline:true}:{count:1,exact:true};}};
 assert.throws(()=>executePackage(transport,x=>messages.push(x)),/outcome requires review/);
 assert.equal(writes,1);assert.equal(reads,2);assert.match(messages[0],/committed-exact/);
});
test('eleven commits and per-entry receipt checks precede readonly object postcheck',()=>{
 const writes=[];let reads=0;
 executePackage({execute(sql){writes.push(sql);},json(){reads++;return reads===1?{database:'postgres',actor:'postgres',pending:0,names:0,baseline:true}:{count:1,exact:true};}});
 assert.equal(writes.length,12);assert.equal(reads,12);
 assert.match(writes.at(-1),/BEGIN READ ONLY/);
});
