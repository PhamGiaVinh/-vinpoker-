import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadPackage,atomicSql,dependencyPredicate} from './restore-chip-52-53-release-plan.mjs';
export function preflightSql(){
 const items=loadPackage();
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('database',current_database(),'actor',current_user,
 'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${items.map(x=>`'${x.version}'`).join(',')}) OR name IN (${items.map(x=>`'${x.name}'`).join(',')})),
 'absent',${items.map(x=>`to_regprocedure('${x.signature}') IS NULL`).join(' AND ')},'baseline',(${dependencyPredicate()}))::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0||row.absent!==true||row.baseline!==true)throw Error('Exact52/53 precondition drift');
}
export function postcheckSql(item){
 const pinned=loadPackage().find(x=>x.version===item?.version);
 if(!pinned||Object.keys(pinned).some(k=>pinned[k]!==item[k]))throw Error('Exact52/53 postcheck allowlist mismatch');
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('function',COALESCE((SELECT
 md5(replace(pg_get_functiondef(p.oid),chr(13),''))='${item.bodyHash}' AND p.prosecdef AND p.provolatile='${item.volatility}'
 AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']::text[]
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
 FROM pg_proc p WHERE p.oid=to_regprocedure('${item.signature}')),false))::text;COMMIT;`;
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 for(const item of loadPackage()){
  try{transport.execute(atomicSql(item));}catch{
   let observed='unavailable';
   try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
   report(`STOP ${item.version} receipt=${observed}; no retry or downstream apply`);
   throw Error(`Exact52/53 apply outcome requires review at ${item.version}`);
  }
  const receipt=transport.json(receiptSql(item));
  if(receipt.count!==1||receipt.exact!==true||transport.json(postcheckSql(item)).function!==true)throw Error(`Exact52/53 postcheck failed at ${item.version}; stop`);
  report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
  report(`RESTORE_CHIP_${item.version}_OBJECT_POSTCHECK_PASS`);
 }
}
function main(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Protected plan|apply only');
 validateContext(process.env,JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8')));
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==process.env.RELEASE_SHA)throw Error('Checkout SHA differs');
 const query=sql=>{
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(process.env),maxBuffer:2*1024*1024});
  if(r.status!==0)throw Error('psql failed; raw output withheld');return r.stdout.trim();
 };
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT_MIGRATIONS_PENDING 52 53 54 55');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_RESTORE_CHIP_52_55_${process.env.RELEASE_SHA}`)throw Error('Exact52–55 confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
