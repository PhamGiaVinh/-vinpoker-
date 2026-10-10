import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
assert.match(process.env.PGHOST ?? '', /^(127\.0\.0\.1|\/tmp\/vinpoker-c4-pg17\.[A-Za-z0-9]+)$/);
assert.ok(process.env.PGDATABASE === 'postgres' || process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
// Additional server guard: this exact disposable synthetic fixture, not a live DB.
function sql(query) {
 const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
assert.equal(sql("SELECT current_setting('port');"),process.env.RESTORE_CANCEL_TEST_PORT ?? '54552');
function tx(name,query,hold){
 const c=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise((resolve,reject)=>{c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>error+=x);c.on('error',reject);c.on('close',code=>resolve({code,out,error}));});
 c.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';${query}\n`);
 if(!hold)c.stdin.end('COMMIT;\n');return {result,commit:()=>c.stdin.end('COMMIT;\n')};
}
async function barrier(name,condition){
 for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(r=>setTimeout(r,25));}
 assert.fail(`true overlap missing ${name}`);
}
const entry='00000000-0000-0000-0000-000000000831',dest='00000000-0000-0000-0000-000000000770',session='00000000-0000-0000-0000-000000000670';
assert.equal(sql(`SELECT status FROM public.tournament_entries WHERE id='${entry}';`),'busted','fresh disposable entry required');
sql(`UPDATE public.tournament_entries SET registration_id='00000000-0000-0000-0000-000000000939' WHERE id='${entry}';`);
const fences=JSON.parse(sql(`SELECT row_to_json(s) FROM (SELECT revision,control_epoch FROM public.table_sessions WHERE id='${session}')s;`));
for(const cancelFirst of [true,false]){
 const key=randomUUID(),tag=key.slice(0,8);
 const args=`'${entry}','${dest}',3,${fences.revision},${fences.control_epoch},'${key}','${session}'`;
 const mutation=`SELECT public.floor_restore_busted_player_to_seat_v5(${args});`;
 const cancellation=`SELECT public.cancel_floor_restore_request_v1(${args});`;
 const first=tx(`restore_first_${tag}`,cancelFirst?cancellation:mutation,true);let second;
 try{await barrier(`restore_first_${tag}`,"state='idle in transaction'");second=tx(`restore_second_${tag}`,cancelFirst?mutation:cancellation,false);await barrier(`restore_second_${tag}`,"wait_event_type='Lock'");}
 finally{first.commit();}
 const a=await first.result;assert.equal(a.code,0,a.error);assert.ok(second);const b=await second.result;assert.equal(b.code,0,b.error);
 const parse=r=>JSON.parse(r.out.split('\n').find(x=>x.startsWith('{')));const winner=parse(a),waiter=parse(b);
 if(cancelFirst){assert.equal(winner.result.status,'cancelled');assert.deepEqual(waiter,winner.result);assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'0');}
 else{assert.equal(winner.ok,true,JSON.stringify(winner));assert.deepEqual(waiter.result,winner);assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'1');}
 const late=JSON.parse(sql(`SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';${mutation}`));
 assert.deepEqual(late,cancelFirst?winner.result:winner);
}
console.log('RESTORE54_TRUE_OVERLAP_CANCEL_VS_ACTUAL_RESTORE_EFFECT_REPLAY_PASS');
