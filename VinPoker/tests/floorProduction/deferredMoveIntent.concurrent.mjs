import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(query){
 const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr); return r.stdout.trim();
}
function tx(name,query,hold=false){
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,error:String(e)}));});
 child.stdin.write(`SET application_name='${name}'; BEGIN; SET LOCAL statement_timeout='8s'; ${query}\n`);
 if(!hold)child.stdin.end('COMMIT;\n');
 return {result,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(name,condition){
 for(let i=0;i<160;i++){
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;
  await new Promise(r=>setTimeout(r,25));
 }
 assert.fail(`overlap barrier absent: ${name}`);
}
for(const canonical of [false,true]) for(const breakFirst of [true,false]){
 const prefix=randomUUID().slice(0,8);
 let fixture=readFileSync('tests/floorProduction/deferredMoveIntent.pg17.sql','utf8');
 // Explicit boundary after both rosters and active destination hand are prepared.
 // Later read/reopen assertions may read the same revision, so SQL text is not a marker.
 const marker=' -- DEFERRED_CONCURRENCY_FIXTURE_READY';
 assert.equal(fixture.split(marker).length,2,'fixture stop must be unique');
 fixture=fixture.replaceAll('f7290000',prefix).replace(marker,' RETURN;\n'+marker).replace('ROLLBACK;','COMMIT;');
 sql(fixture);
 const tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`;
 const st=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${tour}' AND table_number=81;`);
 const ss=sql(`SELECT table_session_id FROM public.tournament_tables WHERE id='${st}';`);
 sql(`SELECT set_config('request.jwt.claim.sub','${actor}',false);
 SELECT public.set_tracker_table_roster_seat_v2('${tour}','${st}',(SELECT table_session_id FROM public.tournament_tables WHERE id='${st}'),(SELECT s.control_epoch FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id WHERE t.id='${st}'),gen_random_uuid(),2,'Source second TEST',20000);
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id='${ss}';`);
 const producer=`SELECT set_config('request.jwt.claim.sub','${actor}',true);
 SELECT public.floor_break_table_v5('${st}',s.revision,gen_random_uuid(),'fill_lowest_table',public.floor_plan_break_table_v1('${st}',s.revision,'fill_lowest_table')->>'plan_hash') FROM public.table_sessions s WHERE s.id='${ss}';`;
 const insert=`INSERT INTO public.tournament_hands SELECT (jsonb_populate_record(NULL::public.tournament_hands,to_jsonb(h)||jsonb_build_object('id',gen_random_uuid(),'table_id','${st}','tournament_table_id','${st}','table_session_id','${ss}'))).* FROM public.tournament_hands h WHERE tournament_id='${tour}';`;
 const start=canonical?`SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT public.start_tracker_hand_v3('${tour}','${st}','${ss}',s.control_epoch,1,now(),'${actor}',1) FROM public.table_sessions s WHERE s.id='${ss}';`:insert;
 const first=tx(`p1_first_${prefix}`,breakFirst?producer:start,true);
 try {await barrier(`p1_first_${prefix}`,"state='idle in transaction'");}
 catch(error){first.commit(); const result=await first.result; throw new Error(`${error.message}: ${result.error}`);}
 const second=tx(`p1_second_${prefix}`,breakFirst?start:producer);
 await barrier(`p1_second_${prefix}`,"wait_event_type='Lock'");
 first.commit();
 const [a,b]=await Promise.all([first.result,second.result]);
 assert.equal(a.code,0,a.error);
 if(breakFirst){assert.match(b.error+b.out,/source_break_pending/);}
 else {assert.equal(b.code,0,b.error);assert.match(b.out,/table_has_active_hand/);}
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND table_session_id='${ss}' AND status='in_progress';`),breakFirst?'0':'1');
 assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${tour}' AND status='pending';`),breakFirst?'2':'0');
 if(breakFirst){
  sql(`SELECT set_config('request.jwt.claim.sub','${actor}',false);
   SELECT public.floor_cancel_pending_tracker_move_v1(id) FROM public.floor_pending_tracker_moves WHERE tournament_id='${tour}' ORDER BY id LIMIT 1;
   UPDATE public.tournament_hands SET status='voided' WHERE tournament_id='${tour}' AND status='in_progress';`);
  assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${tour}' AND status='applied';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${tour}' AND status='cancelled';`),'1');
  assert.equal(sql(`SELECT closed_at IS NULL FROM public.table_sessions WHERE id='${ss}';`),'t');
  assert.equal(sql(`SELECT released_at IS NULL FROM public.dealer_assignments WHERE table_session_id='${ss}';`),'t');
  assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'80000');
 }
}
console.log('DEFERRED_BREAK_TRUE_OVERLAP_PASS');

if(process.env.EXACT_QUEUE_RECOVERY_CASE==='1'){
 const prefix=randomUUID().slice(0,8),tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`;
 const marker=' -- DEFERRED_CONCURRENCY_FIXTURE_READY';
 const fixture=readFileSync('tests/floorProduction/deferredMoveIntent.pg17.sql','utf8');
 assert.equal(fixture.split(marker).length,2);
 sql(fixture.replaceAll('f7290000',prefix).replace(marker,' RETURN;\n'+marker).replace('ROLLBACK;','COMMIT;'));
 const table=number=>JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.table_number=${number})x;`));
 const source=table(81),destination=table(82);
 const entry=sql(`SELECT entry_id FROM public.tournament_seats WHERE tournament_table_id='${source.id}' AND is_active;`);
 const request=randomUUID();
 const invoke=`SELECT public.move_player_seat_v5('${entry}','${source.id}','${source.table_session_id}','${destination.id}','${destination.table_session_id}',3,${source.revision},${destination.revision},${source.control_epoch},${destination.control_epoch},'Queued recovery TEST','${request}');`;
 const auth=`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;`;
 const foreign=randomUUID(),foreignClub=randomUUID();
 sql(`INSERT INTO auth.users(id) VALUES('${foreign}');INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${foreignClub}','${foreign}','Foreign exact queue TEST','TEST');`);
 const denied=JSON.parse(sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${foreign}',true);SET LOCAL ROLE authenticated;${invoke}COMMIT;`).split('\n').find(line=>line.startsWith('{')));
 assert.equal(denied.error,'actor_not_allowed');
 assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${tour}';`),'0');
 for(const role of ['anon','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)','EXECUTE');`),'f');
 const first=tx(`exact_queue_first_${prefix}`,auth+invoke,true);
 try{await barrier(`exact_queue_first_${prefix}`,"state='idle in transaction'");}
 catch(e){first.commit();throw new Error(`${e.message}: ${(await first.result).error}`);}
 const second=tx(`exact_queue_retry_${prefix}`,auth+invoke);
 try{await barrier(`exact_queue_retry_${prefix}`,"wait_event_type='Lock'");}finally{first.commit();}
 const [lost,retry]=await Promise.all([first.result,second.result]);
 assert.equal(lost.code,0,lost.error);assert.equal(retry.code,0,retry.error);
 // Ignore first response after COMMIT. Recover from durable receipt through a new connection.
 const receipt=JSON.parse(sql(`SELECT result FROM floor_private.floor_table_v3_existing_receipt('${actor}','move_player_seat_v5','${request}');`));
 const parse=result=>JSON.parse(result.split('\n').find(line=>line.startsWith('{')));
 assert.equal(receipt.queued,true);assert.equal(receipt.request_id,request);assert.equal(receipt.receipt_code,undefined);
 assert.deepEqual(parse(retry.out),receipt);
 assert.deepEqual(parse(sql(`BEGIN;${auth}${invoke}COMMIT;`)),receipt);
 assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${tour}' AND entry_id='${entry}';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}';`),'0');
 assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'60000');
 assert.equal(sql(`SELECT table_session_id FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),source.table_session_id);
 console.log('EXACT_QUEUE_TRUE_OVERLAP_COMMITTED_RESPONSE_LOSS_RECOVERY_AND_FOREIGN_CLUB_ACL_PASS');
}
