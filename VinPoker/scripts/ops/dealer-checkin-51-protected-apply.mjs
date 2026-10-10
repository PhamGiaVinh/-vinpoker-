import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function loadMigration(){
 const version='20270128000051',name='dealer_checkin_receipt_reconciliation_v1';
 const filename=`${version}_${name}.sql`,hash='d53efa3e45942142c0aaac8148e116272294b4b2ff1d871ae38f1a672642ff9d';
 const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',filename),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact51 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){
 return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000014'
 AND name='dealer_checkin_club_shift_receipt_v1' AND cardinality(statements)=8
 AND md5(array_to_string(statements,chr(10)))='5dda1a1cd93336752e08247fb1e98aaa')
 AND (SELECT count(*)=3 AND bool_and(COALESCE(md5(replace(pg_get_functiondef(p.oid),chr(13),''))=e.hash
 AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']::text[],false))
 FROM (VALUES ('public.operator_check_in_dealer_v1(uuid,uuid,uuid,uuid)','9c400ca0ee425f41e19cf98918fa7943'),
 ('floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','b36883a4b7e4249af756400c2849cffc'),
 ('floor_private.floor_table_v3_actor_is_dealer_operator(uuid,uuid)','da006f4312763a9fc1af9428e44fd9fd'))e(signature,hash)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.signature))`;
}
export function preflightSql(){
 const item=loadMigration();
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('database',current_database(),
 'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}'),
 'function_absent',to_regprocedure('public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid)') IS NULL,
 'baseline',(${dependencyPredicate()}))::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0||row.function_absent!==true||row.baseline!==true)throw Error('Exact51 precondition drift');
}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();
 if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact51 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$dealer51_receipt$';
 if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $dealer51_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR to_regprocedure('public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'dealer51_precondition_drift';END IF;END $dealer51_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function postcheckSql(){
 return `BEGIN READ ONLY;SELECT json_build_object('function',COALESCE((SELECT
 md5(replace(pg_get_functiondef(p.oid),chr(13),''))='f5e7bc883641807967b1044f64ab816e'
 AND p.prosecdef AND p.provolatile='s' AND pg_get_userbyid(p.proowner)='postgres'
 AND p.proconfig=ARRAY['search_path=""']::text[] AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid)')),false))::text;COMMIT;`;
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP51 receipt=${observed}; no retry`);throw Error('Exact51 apply outcome requires review');
 }
 const receipt=transport.json(receiptSql(item));
 if(receipt.count!==1||receipt.exact!==true||transport.json(postcheckSql()).function!==true)throw Error('Exact51 postcheck failed; stop');
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);report('DEALER51_OBJECT_POSTCHECK_PASS');
}
function main(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Protected plan|apply only');
 validateContext(process.env,JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8')));
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==process.env.RELEASE_SHA)throw Error('Checkout SHA differs');
 const query=sql=>{const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(process.env),maxBuffer:2*1024*1024});
  if(r.status!==0)throw Error('psql failed; raw output withheld');return r.stdout.trim();};
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT51_PENDING');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_DEALER_51_${process.env.RELEASE_SHA}`)throw Error('Exact51 confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
