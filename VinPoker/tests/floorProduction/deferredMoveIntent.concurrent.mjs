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
