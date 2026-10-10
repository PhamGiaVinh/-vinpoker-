import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function loadMigration(){
 const version='20270128000056',name='tracker_card_batch_integrity_v1';
 const filename=`${version}_${name}.sql`,hash='bfdd54961f66da91b54fafa825926c9f6b362917fb8b7b315c897c676d4bf4e1';
 const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',filename),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact56 SQL drift');
 return {version,name,filename,hash,sql};
}
export function dependencyPredicate(){
 return `(SELECT count(*)=2 AND bool_and(COALESCE(md5(replace(p.prosrc,chr(13),''))=e.hash
 AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
 AND p.proconfig=ARRAY['search_path=public']::text[],false))
 FROM (VALUES ('public.show_hole_cards(uuid,jsonb,uuid)','4f73608ff9d408b20be72dc4f88d6189'),
 ('public.update_community_cards(uuid,jsonb,uuid)','64734d09453c95918299ca3f6e3cc339'))e(signature,hash)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.signature))`;
}
export function preflightSql(){
 const item=loadMigration();
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('database',current_database(),
 'actor',current_user,'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}'),
 'baseline',(${dependencyPredicate()}))::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0||row.baseline!==true)throw Error('Exact56 precondition drift');
}
export function atomicSql(item=loadMigration()){
 const pinned=loadMigration();
 if(['version','name','filename','hash','sql'].some(k=>item[k]!==pinned[k]))throw Error('Exact56 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$card56_receipt$';
 if(item.sql.includes(tag))throw Error('Delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $card56_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR NOT COALESCE((${dependencyPredicate()}),false) THEN RAISE EXCEPTION 'card56_precondition_drift';END IF;END $card56_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
export function postcheckSql(){
 return readFileSync(resolve(root,'tests/trackerVoice/cardBatchIntegrity.readonly-postcheck.sql'),'utf8');
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));const item=loadMigration();
 try{transport.execute(atomicSql(item));}catch{
  let observed='unavailable';try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP56 receipt=${observed}; no retry`);throw Error('Exact56 apply outcome requires review');
 }
 const receipt=transport.json(receiptSql(item));
 if(receipt.count!==1||receipt.exact!==true)throw Error('Exact56 receipt postcheck failed; stop');
 transport.execute(postcheckSql());
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);report('CARD56_OBJECT_POSTCHECK_PASS');
}
function main(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Protected plan|apply only');
 validateContext(process.env,JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8')));
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==process.env.RELEASE_SHA)throw Error('Checkout SHA differs');
 const query=sql=>{const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(process.env),maxBuffer:2*1024*1024});
  if(r.status!==0)throw Error('psql failed; raw output withheld');return r.stdout.trim();};
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT56_PENDING');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_TRACKER_CARD_56_${process.env.RELEASE_SHA}`)throw Error('Exact56 confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
