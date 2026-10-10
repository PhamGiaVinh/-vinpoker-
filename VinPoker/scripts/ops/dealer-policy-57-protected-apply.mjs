import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function loadMigration(){
 const version='20270128000057',name='dealer_pt_policy_tenant_integrity_v1';
 const filename=`${version}_${name}.sql`,hash='0b5c774899b6e933049a74be985b1f72e96b2501e5daf15a087e6fc784e80d20';
 const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',filename),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact57 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){
 return `(SELECT count(*)=1 AND bool_and(COALESCE(md5(replace(p.prosrc,chr(13),''))='3384c36a062fa1b1faca1c9b66b3c39b'
 AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=public']::text[],false))
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamptz,text)'))`;
}
export function preflightSql(){
 const item=loadMigration();
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('database',current_database(),
 'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}'),
 'baseline',(${dependencyPredicate()}))::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0||row.baseline!==true)throw Error('Exact57 precondition drift');
}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();
 if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact57 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$policy57_receipt$';
 if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $policy57_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'policy57_precondition_drift';END IF;END $policy57_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP57 receipt=${observed}; no retry`);throw Error('Exact57 apply outcome requires review');
 }
 const receipt=transport.json(receiptSql(item));
 if(receipt.count!==1||receipt.exact!==true)throw Error('Exact57 receipt postcheck failed; stop');
 transport.execute(readFileSync(resolve(root,'tests/dealerSwing/accrualTenant.readonly-postcheck.sql'),'utf8'));
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);report('POLICY57_OBJECT_POSTCHECK_PASS');
}
function main(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Protected plan|apply only');
 validateContext(process.env,JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8')));
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==process.env.RELEASE_SHA)throw Error('Checkout SHA differs');
 const query=sql=>{const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(process.env),maxBuffer:2*1024*1024});
  if(r.status!==0)throw Error('psql failed; raw output withheld');return r.stdout.trim();};
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT57_PENDING');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_DEALER_POLICY_57_${process.env.RELEASE_SHA}`)throw Error('Exact57 confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
