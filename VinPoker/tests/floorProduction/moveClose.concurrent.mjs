import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(query){
 const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
function tx(name,query,hold){
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';${query}\n`);
 if(!hold)child.stdin.end('COMMIT;\n');
 return {result,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(name,condition){
 for(let i=0;i<160;i++){
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.fail(`actual overlap barrier absent: ${name}`);
}
for(const moveFirst of [true,false]){
 const prefix=randomUUID().slice(0,8),tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`,entry=`${prefix}-0000-4000-8000-000000000031`;
 const marker=' -- MOVE_CLOSE_CONCURRENCY_FIXTURE_READY';
 let fixture=readFileSync('tests/floorProduction/breakDrawPolicy.pg17.sql','utf8');
 assert.equal(fixture.split(marker).length,2);
 fixture=fixture.replaceAll('f7470000',prefix).replace(marker,' RETURN;\n'+marker).replace('ROLLBACK;','COMMIT;');
 sql(fixture);
 const source=JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.table_number=91)x;`));
 const dest=JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.table_number=93)x;`));
 const auth=`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;`;
 const moveRequest=randomUUID();
 const move=`${auth} SELECT public.move_player_seat_v4('${entry}','${source.id}','${source.table_session_id}','${dest.id}','${dest.table_session_id}',1,${source.revision},${dest.revision},${source.control_epoch},${dest.control_epoch},'Concurrency TEST','${moveRequest}');`;
 const closeRequest=randomUUID();
 const close=`${auth} SELECT public.close_tournament_table_v4('${dest.id}',${dest.revision},'${closeRequest}');`;
 const first=tx(`move_close_first_${prefix}`,moveFirst?move:close,true);
 try{await barrier(`move_close_first_${prefix}`,"state='idle in transaction'");}
 catch(e){first.commit();throw new Error(`${e.message}: ${(await first.result).error}`);}
 const second=tx(`move_close_second_${prefix}`,moveFirst?close:move,false);
 try{await barrier(`move_close_second_${prefix}`,"wait_event_type='Lock'");}
 finally{first.commit();}
 const [a,b]=await Promise.all([first.result,second.result]);
 assert.equal(a.code,0,a.error);assert.match(a.out,/"ok": true/);
 assert.equal(b.code,0,b.error);assert.match(b.out,/"ok": false/);
 const denied=JSON.parse(b.out.trim().split('\n').at(-1));
 assert.equal(denied.error,moveFirst?'STALE_STATE':'table_session_not_active');
 assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'40000');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'1');
 assert.equal(sql(`SELECT tournament_table_id FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),moveFirst?dest.id:source.id);
 assert.equal(sql(`SELECT closed_at IS NULL FROM public.table_sessions WHERE id='${dest.table_session_id}';`),moveFirst?'t':'f');
 assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}' AND status='issued';`),moveFirst?'1':'0');
 if(moveFirst){
  // First response is intentionally not used for retry. A new connection after
  // COMMIT replays the frozen intent, as a remounted client would do.
  const replay=JSON.parse(sql(`BEGIN;${move}COMMIT;`).split('\n').find(line=>line.startsWith('{')));
  const committed=JSON.parse(a.out.split('\n').find(line=>line.startsWith('{')));
  assert.deepEqual(replay,committed,'post-COMMIT new-connection replay returns identical receipt');
  assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.seat_assignment_history WHERE entry_id='${entry}';`),'1');
  assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'40000');
  const conflict=JSON.parse(sql(`BEGIN;${move.replace('Concurrency TEST','Different payload TEST')}COMMIT;`).split('\n').find(line=>line.startsWith('{')));
  assert.equal(conflict.error,'IDEMPOTENCY_CONFLICT');
  console.log('MOVE_POST_COMMIT_NEW_CONNECTION_RECEIPT_RECOVERY_PASS');
 }else{
  const replay=JSON.parse(sql(`BEGIN;${close}COMMIT;`).split('\n').find(line=>line.startsWith('{')));
  assert.deepEqual(replay,JSON.parse(a.out.split('\n').find(line=>line.startsWith('{'))));
  const conflict=JSON.parse(sql(`BEGIN;${close.replace(`,${dest.revision},`,`,${dest.revision+1},`)}COMMIT;`).split('\n').find(line=>line.startsWith('{')));
  assert.equal(conflict.error,'IDEMPOTENCY_CONFLICT');
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE request_id='${closeRequest}';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}';`),'0');
  console.log('CLOSE_POST_COMMIT_NEW_CONNECTION_RECEIPT_RECOVERY_PASS');
 }
 console.log(`MOVE_DESTINATION_CLOSE_TRUE_OVERLAP_PASS moveFirst=${moveFirst} denied=${b.out.trim().split('\n').at(-1)}`);
}
// Old callable writers must serialize with the exact-session v4 writer too.
// Distinct keys intentionally challenge integrity, not merely receipt replay.
if(process.env.MIXED_MOVE_CASE==='1')for(const legacyVersion of [2,3])for(const legacyFirst of [true,false]){
 const prefix=randomUUID().slice(0,8),tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`,entry=`${prefix}-0000-4000-8000-000000000031`;
 const marker=' -- MOVE_CLOSE_CONCURRENCY_FIXTURE_READY';
 const fixture=readFileSync('tests/floorProduction/breakDrawPolicy.pg17.sql','utf8');
 assert.equal(fixture.split(marker).length,2);
 sql(fixture.replaceAll('f7470000',prefix).replace(marker,' RETURN;\n'+marker).replace('ROLLBACK;','COMMIT;'));
 const table=number=>JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.table_number=${number})x;`));
 const source=table(91),dest=table(93);
 const auth=`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;`;
 const legacy=`${auth} SELECT public.move_player_seat_v${legacyVersion}('${entry}','${dest.id}',1,${source.revision},${dest.revision},'${randomUUID()}');`;
 const exact=`${auth} SELECT public.move_player_seat_v4('${entry}','${source.id}','${source.table_session_id}','${dest.id}','${dest.table_session_id}',2,${source.revision},${dest.revision},${source.control_epoch},${dest.control_epoch},'Mixed writer TEST','${randomUUID()}');`;
 const first=tx(`mixed_first_${prefix}`,legacyFirst?legacy:exact,true);
 try{await barrier(`mixed_first_${prefix}`,"state='idle in transaction'");}
 catch(e){first.commit();throw new Error(`${e.message}: ${(await first.result).error}`);}
 const second=tx(`mixed_second_${prefix}`,legacyFirst?exact:legacy,false);
 try{await barrier(`mixed_second_${prefix}`,"wait_event_type='Lock'");}finally{first.commit();}
 const [a,b]=await Promise.all([first.result,second.result]);
 assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);
 const receipt=result=>JSON.parse(result.out.trim().split('\n').at(-1));
 assert.equal(receipt(a).ok,true,JSON.stringify(receipt(a)));
 assert.equal(receipt(b).ok,false,JSON.stringify(receipt(b)));
 assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'1');
 assert.equal(sql(`SELECT seat_number FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),legacyFirst?'1':'2');
 assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'40000');
 assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}' AND status='issued';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.seat_assignment_history WHERE entry_id='${entry}';`),'1');
 console.log(`MIXED_MOVE_TRUE_OVERLAP_PASS legacyVersion=${legacyVersion} legacyFirst=${legacyFirst} denial=${receipt(b).error}`);
}
if(process.env.DEALER_ASSIGN_CLOSE_CASE==='1')for(const assignFirst of [true,false]){
 const prefix=randomUUID().slice(0,8),tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`,club=`${prefix}-0000-4000-8000-000000000002`;
 const marker=' -- MOVE_CLOSE_CONCURRENCY_FIXTURE_READY';
 let fixture=readFileSync('tests/floorProduction/breakDrawPolicy.pg17.sql','utf8');
 assert.equal(fixture.split(marker).length,2);
 sql(fixture.replaceAll('f7470000',prefix).replace(marker,' RETURN;\n'+marker).replace('ROLLBACK;','COMMIT;'));
 const dest=JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT t.id,t.game_table_id,t.table_session_id,s.revision FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.table_number=93)x;`));
 assert.equal(sql(`SELECT availability_status FROM floor_private.club_operational_inventory('${club}') WHERE game_table_id='${dest.game_table_id}';`),'in_use');
 const wrongPhysical=sql(`SELECT game_table_id FROM public.tournament_tables WHERE tournament_id='${tour}' AND table_number=91;`);
 assert.equal(sql(`BEGIN;UPDATE public.tournament_tables SET table_id='${wrongPhysical}' WHERE id='${dest.id}';SELECT availability_status FROM floor_private.club_operational_inventory('${club}') WHERE game_table_id='${dest.game_table_id}';ROLLBACK;`),'repair_required');
 const shift=`${prefix}-0000-4000-8000-000000000080`,dealer=`${prefix}-0000-4000-8000-000000000081`,attendance=`${prefix}-0000-4000-8000-000000000082`;
 sql(`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${club}',true) ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${club}','Isolated assignment-close TEST','00:00','23:59');
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealer}','${club}','Assignment-close TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES('${attendance}','${dealer}','${shift}',current_date,'checked_in',now(),'available');`);
 const assign=`SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claim.role','service_role',true);SELECT public.worker_assign_dealer_to_session_v1('${club}','${dest.game_table_id}','${dest.table_session_id}','${attendance}',now()+interval '30 minutes','${randomUUID()}');`;
 const close=`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;SELECT public.close_tournament_table_v4('${dest.id}',${dest.revision},'${randomUUID()}');`;
 const first=tx(`assign_close_first_${prefix}`,assignFirst?assign:close,true);
 try{await barrier(`assign_close_first_${prefix}`,"state='idle in transaction'");}
 catch(e){first.commit();throw new Error(`${e.message}: ${(await first.result).error}`);}
 const second=tx(`assign_close_second_${prefix}`,assignFirst?close:assign,false);
 try{await barrier(`assign_close_second_${prefix}`,"wait_event_type='Lock'");}finally{first.commit();}
 const [a,b]=await Promise.all([first.result,second.result]);
 assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);
 const aReceipt=JSON.parse(a.out.trim().split('\n').at(-1)),bReceipt=JSON.parse(b.out.trim().split('\n').at(-1));
 if(assignFirst){assert.equal(aReceipt.outcome,'ok');assert.equal(bReceipt.ok,true);}
 else{assert.equal(aReceipt.ok,true);assert.equal(bReceipt.outcome,'table_session_changed');}
 assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${dest.table_session_id}';`),'t');
 assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${dest.table_session_id}' AND released_at IS NULL;`),'0');
 assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${attendance}';`),'available');
 assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'40000');
 sql(`UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${club}';`);
 console.log(`PUBLIC_FLOOR_CLOSE_INITIAL_ASSIGN_TRUE_OVERLAP_PASS assignFirst=${assignFirst}`);
}
