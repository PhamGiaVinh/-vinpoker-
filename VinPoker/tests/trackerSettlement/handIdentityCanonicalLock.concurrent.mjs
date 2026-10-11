import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGUSER, 'postgres');
const fixed=process.argv.includes('--expect-fixed');
assert.equal(process.env.PGDATABASE, fixed?'vinpoker_ops_identity58_statement_20261011':'vinpoker_ops_identity58_reparent_fixed_20261011');
for (const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key]);
function sql(q) {
 const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr); return r.stdout.trim();
}
function session(name,q) {
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 child.stdin.write(`SET application_name='${name}';SET statement_timeout='12s';SET idle_in_transaction_session_timeout='15s';${q}\n`);
 return {result,end:q=>{if(!child.stdin.writableEnded)child.stdin.end(q+'\n');}};
}
async function barrier(name,predicate) {
 for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${predicate});`)==='t')return;await new Promise(r=>setTimeout(r,25));}
 assert.fail('barrier missing '+name);
}
const hand='86000000-0000-4000-8000-000000000001';
const tournament=sql(`SELECT tournament_id FROM public.tournament_hands WHERE id='${hand}';`);
assert.match(tournament,/^[0-9a-f-]{36}$/);
assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='trg_00_tracker_hand_identity_scope_v1' AND tgenabled='O';"),fixed?'0':'1');
let canonical,identity;
try {
 canonical=session('identity58_canonical',`BEGIN;SELECT public.tracker_unified_ops_lock_tournament('${tournament}');`);
 await barrier('identity58_canonical',"wait_event='ClientRead' AND xact_start IS NOT NULL");
 identity=session('identity58_direct',`BEGIN;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';SET LOCAL ROLE authenticated;UPDATE public.tournament_hands SET hand_number=hand_number+1 WHERE id='${hand}';${fixed?'':'ROLLBACK;'}`);
 if(fixed){
   await barrier('identity58_direct',"wait_event='ClientRead' AND xact_start IS NOT NULL");
   canonical.end(`SELECT id FROM public.tournament_hands WHERE id='${hand}' FOR UPDATE;ROLLBACK;`);
   await barrier('identity58_canonical',"wait_event_type='Lock'");
   identity.end('ROLLBACK;');
   for(const r of await Promise.all([canonical.result,identity.result]))assert.equal(r.code,0,r.error);
   console.log('HAND_IDENTITY58_CANONICAL_LOCK_ORDER_PASS');
 }else{
 identity.end('');
 await barrier('identity58_direct',"wait_event='advisory'");
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity d JOIN pg_stat_activity c ON c.pid=ANY(pg_blocking_pids(d.pid)) WHERE d.application_name='identity58_direct' AND c.application_name='identity58_canonical');"),'t');
 canonical.end(`SELECT id FROM public.tournament_hands WHERE id='${hand}' FOR UPDATE;ROLLBACK;`);
 const results=await Promise.all([canonical.result,identity.result]);
 assert.ok(results.some(r=>r.code!==0&&/deadlock detected/.test(r.error)),JSON.stringify(results));
 console.log('HAND_IDENTITY58_CANONICAL_LOCK_ORDER_DEADLOCK_REPRODUCED');
 }
} finally {
 canonical?.end('ROLLBACK;');identity?.end('ROLLBACK;');
 await Promise.all([canonical?.result,identity?.result]);
}
