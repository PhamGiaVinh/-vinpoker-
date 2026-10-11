import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_identity58_overlap_20261011',
 'vinpoker_ops_identity58_overlap_v2_20261011'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const hand='86000000-0000-4000-8000-000000000001';
const actor='81100000-0000-4000-8000-000000000001';
function sql(query) {
 const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_new_hand_identity_chain_v1' AND tgenabled='O';"),'1');
function tx(marker,hold=false) {
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{
  child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);
  child.on('error',e=>resolve({code:-1,out,error:String(e)}));
  child.on('close',code=>resolve({code,out,error}));
 });
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${marker}';BEGIN;SET LOCAL statement_timeout='10s';
 SET LOCAL idle_in_transaction_session_timeout='10s';
 SET LOCAL request.jwt.claim.sub='${actor}';
 SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
 SET LOCAL ROLE authenticated;
 UPDATE public.tournament_hands SET hand_number=hand_number+1 WHERE id='${hand}'
 RETURNING source_revision;\n`);
 if(!hold)end('COMMIT');
 return {result,end};
}
async function barrier(marker,condition) {
 for(let i=0;i<120;i++) {
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t')return;
  await new Promise(r=>setTimeout(r,25));
 }
 assert.fail(`identity58 overlap missing: ${marker}`);
}
sql(`UPDATE public.tournament_hands SET status='completed' WHERE id='${hand}';`);
const before=JSON.parse(sql(`SELECT json_build_object('number',hand_number,'revision',source_revision) FROM public.tournament_hands WHERE id='${hand}';`));
let holder,waiter;
try {
 holder=tx('identity58_holder',true);
 await barrier('identity58_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
 waiter=tx('identity58_waiter');
 await barrier('identity58_waiter',"wait_event_type='Lock'");
 holder.end('COMMIT');
 const first=await holder.result,second=await waiter.result;
 assert.equal(first.code,0,first.error);assert.equal(second.code,0,second.error);
 const after=JSON.parse(sql(`SELECT json_build_object('number',hand_number,'revision',source_revision) FROM public.tournament_hands WHERE id='${hand}';`));
 assert.equal(after.number,before.number+2);assert.equal(after.revision,before.revision+2);
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=${after.revision} AND status='pending';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=${before.revision+1} AND status='cancelled';`),'1');
 console.log('HAND_IDENTITY58_TRUE_LOCK_OVERLAP_PASS');
} finally {
 holder?.end('ROLLBACK');waiter?.end('ROLLBACK');
 await Promise.all([holder?.result,waiter?.result]);
}
