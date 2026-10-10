import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateContext,psqlEnvironment,receiptSql} from './floor-37-47-protected-apply.mjs';
import {loadMigration,atomicSql,predecessorPredicate} from './floor-48-release-plan.mjs';
export function preflightSql(){
 const item=loadMigration();
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object('database',current_database(),'actor',current_user,
 'existing',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}'),
 'baseline',(${predecessorPredicate()}))::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.existing!==0||row.baseline!==true)throw Error('Floor48 precondition drift; stop without apply');
}
export function postcheckSql(){
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
 SELECT json_build_object('functions',COALESCE((SELECT bool_and(COALESCE(md5(replace(p.prosrc,chr(13),''))=e.hash AND p.prosecdef
 AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']::text[]
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')=e.browser
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'),false))
 FROM (VALUES
 ('public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)','b610100979aaedd16d076728a382ed92',true),
 ('public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)','737256dbd19cec9d74faadf598b9e328',true),
 ('public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)','00efba7f6c95125121233f5bf6dc9f48',true),
 ('floor_private.floor_apply_tracker_moves_after_hand_v1()','75ab2dabdcd81a3aa884e2a1dd02f5dc',false)) e(signature,hash,browser)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)),false),
 'column',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.floor_pending_tracker_moves'::regclass
 AND attname='requested_reason' AND atttypid='text'::regtype AND NOT attnotnull AND NOT attisdropped))::text;COMMIT;`;
}
export function executeMigration(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 const item=loadMigration();
 try{transport.execute(atomicSql(item));}
 catch{
  let observed='unavailable';
  try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
  report(`STOP 48 receipt=${observed}; no automatic retry`);
  throw Error('Floor48 apply outcome requires review');
 }
 const r=transport.json(receiptSql(item));
 if(r.count!==1||r.exact!==true)throw Error('Floor48 receipt drift; stop');
 const checks=transport.json(postcheckSql());
 if(checks.functions!==true||checks.column!==true)throw Error('Floor48 object/ACL postcheck failed');
 report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
 report('FLOOR48_OBJECT_POSTCHECK_PASS');
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
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT_MIGRATION_PENDING 48');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_FLOOR_48_${process.env.RELEASE_SHA}`)throw Error('Exact migration48 confirmation missing');
 executeMigration(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
