import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadPackage,atomicSql,predecessorPredicate} from './floor-49-50-release-plan.mjs';
export function preflightSql(){
 const items=loadPackage();
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,
 'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${items.map(x=>`'${x.version}'`).join(',')}) OR name IN (${items.map(x=>`'${x.name}'`).join(',')})),
 'baseline',(${predecessorPredicate(items[0])}),
 'cron',EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL,
 'jobs',(SELECT count(*) FROM cron.job WHERE jobname='floor-mode-request-retry-v1'))::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0||row.baseline!==true||row.cron!==true||row.jobs!==0)throw Error('Floor49/50 precondition drift; stop without apply');
}
export function postcheckSql(version){
 if(!loadPackage().some(x=>x.version===version))throw Error('Unknown postcheck version');
 const scheduled=version.endsWith('50');
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'functions',COALESCE((SELECT bool_and(COALESCE(md5(replace(pg_get_functiondef(p.oid),chr(13),''))=e.hash AND p.prosecdef
 AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']::text[]
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')=e.browser
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'),false))
 FROM (VALUES
 ('public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)','765cf5eafa8c5b532e3ec8d260087063',true),
 ('public.floor_get_table_control_mode_request_v1(uuid,uuid)','b660b3b7de129d375d774a740d7700fe',true),
 ('public.floor_cancel_table_control_mode_request_v1(uuid,uuid,uuid)','38acb2e380dd06c9ad4dfafc9947b5f7',true),
 ('public.get_floor_tournament_table_inventory_v1(uuid)','eb255a1c1b2a0c87e430f8b333f1d1db',true),
 ('floor_private.resolve_table_mode_request_v1(uuid)','a19c384b03b7f3256af25985125f1841',false),
 ('floor_private.resolve_pending_table_modes_v1(integer)','6437645f03d75d2ab9ec1eec1632ecef',false),
 ('floor_private.expire_tournament_mode_requests_v1()','63e5c3d48e46c70a467c0f6f5a2c9ccb',false)) e(signature,hash,browser)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)),false),
 'cursor',EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('floor_private.table_mode_retry_cursor_v1') AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres'
 AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')),
 'cursor_row',(SELECT count(*)=1 AND bool_and(singleton) FROM floor_private.table_mode_retry_cursor_v1),
 'trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_mode_tournament_lifecycle_v1' AND tgfoid=to_regprocedure('floor_private.expire_tournament_mode_requests_v1()') AND tgenabled='O' AND NOT tgisinternal AND md5(pg_get_triggerdef(oid))='ab466ea641b69b1c259135ba66d1cddd'),
 'scheduler',${scheduled ? `(SELECT count(*)=1 AND bool_and(command='SET lock_timeout=''2s''; SET statement_timeout=''20s''; SELECT floor_private.resolve_pending_table_modes_v1(50);' AND schedule='* * * * *' AND username='postgres' AND database=current_database() AND active) FROM cron.job WHERE jobname='floor-mode-request-retry-v1')` : 'true'})::text;COMMIT;`;
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 for(const item of loadPackage()){
  try{transport.execute(atomicSql(item));}
  catch{
   let observed='unavailable';
   try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
   report(`STOP ${item.version} receipt=${observed}; no retry or downstream apply`);
   throw Error(`Floor49/50 apply outcome requires review at ${item.version}`);
  }
  const receipt=transport.json(receiptSql(item));
  if(receipt.count!==1||receipt.exact!==true)throw Error('Floor49/50 receipt drift; stop');
  const checks=transport.json(postcheckSql(item.version));
  if(['functions','cursor','cursor_row','trigger','scheduler'].some(k=>checks[k]!==true))throw Error(`Floor49/50 object postcheck failed at ${item.version}`);
  report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
  report(`FLOOR_${item.version}_OBJECT_POSTCHECK_PASS`);
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
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT_MIGRATIONS_PENDING 49 50');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_FLOOR_49_50_${process.env.RELEASE_SHA}`)throw Error('Exact49/50 confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
