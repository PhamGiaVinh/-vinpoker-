import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(q){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function tx(name,q,hold){
 const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>error+=c);p.on('close',code=>resolve({code,out,error}));p.on('error',e=>resolve({code:-1,error:String(e)}));});
 p.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';${q}\n`);
 if(!hold)p.stdin.end('COMMIT;\n');
 return {result,commit:()=>p.stdin.end('COMMIT;\n')};
}
async function barrier(name,condition){for(let i=0;i<160;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('missing actual overlap barrier');}
for(const replay of [true,false]){
 const prefix=randomUUID().slice(0,8);
 let fixture=readFileSync('tests/floorProduction/trackerRosterSession.pg17.sql','utf8').split('-- Only public RPC calls')[0];
 const marker=" PERFORM set_config('role','authenticated',true);";
 assert.ok(fixture.includes(marker));
 fixture=fixture.replaceAll('f7280000',prefix).replace(marker,' RETURN;\n'+marker)+'\nCOMMIT;\n';
 sql(fixture);
 const tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`;
 const tt=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${tour}' AND status='active';`);
 const session=sql(`SELECT table_session_id FROM public.tournament_tables WHERE id='${tt}';`);
 const key=randomUUID();
 const call=k=>`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;SELECT public.set_tracker_table_roster_seat_v2('${tour}','${tt}','${session}',1,'${k}',1,'Concurrent TEST',20000);`;
 const a=tx(`roster_a_${prefix}`,call(key),true);
 await barrier(`roster_a_${prefix}`,"state='idle in transaction'");
 const b=tx(`roster_b_${prefix}`,call(replay?key:randomUUID()),false);
 await barrier(`roster_b_${prefix}`,"wait_event_type='Lock'");a.commit();
 const [first,second]=await Promise.all([a.result,b.result]);
 assert.equal(first.code,0,first.error);assert.equal(second.code,0,second.error);
 if(replay)assert.equal(second.out,first.out);else assert.match(second.out,/STALE_ROSTER_STATE/);
 assert.equal(sql(`SELECT count(*)||':'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'1:20000');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='set_tracker_table_roster_seat_v2';`),'1');
 if(!replay){
  const token=sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;
   SELECT public.get_tracker_roster_snapshot_v1('${tour}','${tt}','${session}',1)->'seats'->0->>'token';COMMIT;`).split('\n').at(-1);
  const player=sql(`SELECT player_id FROM public.tournament_seats WHERE table_session_id='${session}' AND is_active;`);
  const update=(chips,k)=>`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;
   SELECT public.set_tracker_table_roster_seat_v2('${tour}','${tt}','${session}',1,'${k}',1,'Concurrent TEST',${chips},'${player}',false,NULL,'${token}');`;
  const newer=tx(`stack_b_${prefix}`,update(25000,randomUUID()),true);
  await barrier(`stack_b_${prefix}`,"state='idle in transaction'");
  const delayed=tx(`stack_a_${prefix}`,update(20000,randomUUID()),false);
  await barrier(`stack_a_${prefix}`,"wait_event_type='Lock'");newer.commit();
  const [n,d]=await Promise.all([newer.result,delayed.result]);
  assert.equal(n.code,0,n.error);assert.match(n.out,/"ok": true/);
  assert.equal(d.code,0,d.error);assert.match(d.out,/STALE_ROSTER_STATE/);
  assert.equal(sql(`SELECT s.chip_count||':'||e.current_stack||':'||cc.chip_count FROM public.tournament_seats s
   JOIN public.tournament_entries e ON e.id=s.entry_id JOIN public.tournament_chip_counts cc
   ON cc.tournament_id=s.tournament_id AND cc.player_id=s.player_id AND cc.entry_number=s.entry_number
   WHERE s.table_session_id='${session}' AND s.is_active;`),'25000:25000:25000');
 }
}
console.log('TRACKER_ROSTER_INTENT_TRUE_OVERLAP_PASS');

if(process.env.MOVE_WRAPPER_RECEIPT_CASE==='1')for(const replay of [true,false]){
 const prefix=randomUUID().slice(0,8);
 let fixture=readFileSync('tests/floorProduction/trackerRosterSession.pg17.sql','utf8').split('-- Only public RPC calls')[0];
 const marker=" PERFORM set_config('role','authenticated',true);";
 assert.ok(fixture.includes(marker));
 fixture=fixture.replaceAll('f7280000',prefix).replace(marker,' RETURN;\n'+marker)+'\nCOMMIT;\n';
 sql(fixture);
 const tour=`${prefix}-0000-4000-8000-000000000003`,actor=`${prefix}-0000-4000-8000-000000000001`;
 const tt=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${tour}' AND status='active';`);
 const session=sql(`SELECT table_session_id FROM public.tournament_tables WHERE id='${tt}';`);
 sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;
 SELECT public.set_tracker_table_roster_seat_v2('${tour}','${tt}','${session}',1,'${randomUUID()}',1,'Move concurrent TEST',20000);COMMIT;`);
 const entry=sql(`SELECT entry_id FROM public.tournament_seats WHERE table_session_id='${session}' AND is_active;`);
 const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`),key=randomUUID();
 const call=seat=>`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;
 SELECT public.move_player_seat_v3('${entry}','${tt}',${seat},${revision},${revision},'${key}');`;
 const a=tx(`move_a_${prefix}`,call(3),true);
 await barrier(`move_a_${prefix}`,"state='idle in transaction'");
 const b=tx(`move_b_${prefix}`,call(replay?3:4),false);
 await barrier(`move_b_${prefix}`,"wait_event_type='Lock'");a.commit();
 const [first,second]=await Promise.all([a.result,b.result]);
 assert.equal(first.code,0,first.error);assert.match(first.out,/"ok": true/);
 assert.equal(second.code,0,second.error);
 if(replay)assert.equal(second.out,first.out);else assert.match(second.out,/IDEMPOTENCY_CONFLICT/);
 assert.equal(sql(`SELECT count(*)||':'||sum(chip_count)||':'||min(seat_number) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'1:20000:3');
 assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='move_player_seat_v2';`),'1');
}
if(process.env.MOVE_WRAPPER_RECEIPT_CASE==='1')console.log('MOVE_WRAPPER_RECEIPT_TRUE_OVERLAP_PASS');
