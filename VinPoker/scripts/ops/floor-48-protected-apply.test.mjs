import test from 'node:test';
import assert from 'node:assert/strict';
import {executeMigration,classifyPreflight,postcheckSql} from './floor-48-protected-apply.mjs';
const ready={database:'postgres',actor:'postgres',existing:0,baseline:true};
test('rejects existing, partial or drifted baseline before any mutation',()=>{
 for(const bad of [{existing:1},{baseline:false},{actor:'other'},{database:'other'}])assert.throws(()=>classifyPreflight({...ready,...bad}),/precondition/);
 let writes=0;
 assert.throws(()=>executeMigration({json:()=>({...ready,baseline:false}),execute:()=>writes++}),/precondition/);
 assert.equal(writes,0);
});
test('executes exactly once and requires exact receipt and object postcheck',()=>{
 const responses=[ready,{count:1,exact:true},{functions:true,column:true}],reports=[];let writes=0;
 executeMigration({json:()=>responses.shift(),execute:()=>writes++},x=>reports.push(x));
 assert.equal(writes,1);assert.equal(responses.length,0);assert.equal(reports.at(-1),'FLOOR48_OBJECT_POSTCHECK_PASS');
});
for(const receipt of [{count:1,exact:true},{count:0,exact:false},{count:1,exact:false},null]){
 test(`unknown outcome never retries: ${JSON.stringify(receipt)}`,()=>{
  let reads=0,writes=0;const reports=[];
  assert.throws(()=>executeMigration({json:()=>{if(reads++===0)return ready;if(receipt===null)throw Error('unavailable');return receipt;},execute:()=>{writes++;throw Error('lost response');}},x=>reports.push(x)),/requires review/);
  assert.equal(writes,1);assert.equal(reads,2);assert.match(reports[0],/no automatic retry/);
 });
}
test('object or receipt failures cannot report release success',()=>{
 for(const outcome of [{count:1,exact:false},{functions:false,column:true},{functions:true,column:false}]){
  const responses='count' in outcome?[ready,outcome]:[ready,{count:1,exact:true},outcome];const reports=[];
  assert.throws(()=>executeMigration({json:()=>responses.shift(),execute:()=>{}},x=>reports.push(x)),/drift|postcheck/);
  assert.equal(reports.length,0);
 }
 assert.match(postcheckSql(),/bool_and\(COALESCE/);
});
