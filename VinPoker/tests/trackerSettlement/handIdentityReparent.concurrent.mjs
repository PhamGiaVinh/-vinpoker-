import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
const fixed=process.argv.includes('--expect-fixed');
const statement=process.argv.includes('--statement');
assert.equal(process.env.PGDATABASE,statement?'vinpoker_ops_identity58_statement_reparent_20261011':fixed?'vinpoker_ops_identity58_reparent_fixed_20261011':'vinpoker_ops_identity58_reparent_20261011');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(query){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function session(marker,query){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 const end=q=>{if(!child.stdin.writableEnded)child.stdin.end(q+'\n');};
 child.stdin.write(`SET application_name='${marker}';SET statement_timeout='12s';${query}\n`);
 return{result,end};
}
async function barrier(marker,predicate){for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${predicate});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('barrier missing '+marker);}
const source=readFileSync(new URL('./handTournamentRevision.pg17.sql',import.meta.url),'utf8');
const seed=source.slice(source.indexOf('BEGIN;'),source.indexOf('CREATE TEMP TABLE tour_revision_before')).replaceAll('vinpoker_ops_card56_overlap_20261011',process.env.PGDATABASE);
sql(seed+`
UPDATE public.table_sessions SET control_mode='manual' WHERE id='83600000-0000-4000-8000-000000000058';
INSERT INTO public.tournament_hands SELECT (jsonb_populate_record(NULL::public.tournament_hands,to_jsonb(h)||jsonb_build_object(
 'id','86900000-0000-4000-8000-000000000058','hand_number',20,
 'tournament_id','85800000-0000-4000-8000-000000000058','table_id','84800000-0000-4000-8000-000000000058',
 'tournament_table_id','84800000-0000-4000-8000-000000000058','table_session_id','83600000-0000-4000-8000-000000000058'))).* FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
UPDATE public.tournament_hands SET hand_number=10 WHERE id='86000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_hands SELECT (jsonb_populate_record(NULL::public.tournament_hands,to_jsonb(h)||jsonb_build_object('id',
 CASE WHEN h.id='86000000-0000-4000-8000-000000000001' THEN '86700000-0000-4000-8000-000000000058' ELSE '86600000-0000-4000-8000-000000000058' END,'hand_number',0))).*
 FROM public.tournament_hands h WHERE h.id IN('86000000-0000-4000-8000-000000000001','86900000-0000-4000-8000-000000000058');
INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,source_revision,source_chain_hash,settlement_revision,outcome_hash,public_outcome,request_hash,idempotency_key,actor_user_id,verification_scope)
 SELECT h.tournament_id,h.id,s.source_revision,s.source_chain_hash,1,repeat('a',64),'{}'::jsonb,repeat('b',64),'identity58-opposite-'||h.id,'81100000-0000-4000-8000-000000000001','chain'
 FROM public.tournament_hands h CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(h.id) s WHERE h.hand_number=0;
CREATE FUNCTION public.identity58_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(CASE WHEN NEW.id='86000000-0000-4000-8000-000000000001' THEN 58001 ELSE 58002 END);RETURN NEW;END $$;
CREATE TRIGGER zzzz_identity58_test_barrier BEFORE UPDATE OF tournament_id ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION public.identity58_test_barrier();
COMMIT;`);
const actor=`BEGIN;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';SET LOCAL ROLE authenticated;`;
let gate,a,b;
try{
 gate=session('identity58_gate','SELECT pg_advisory_lock(58001);SELECT pg_advisory_lock(58002);');
 await barrier('identity58_gate',"wait_event='ClientRead'");
 a=session('identity58_A',actor+`UPDATE public.tournament_hands SET tournament_id='85800000-0000-4000-8000-000000000058',table_id='84800000-0000-4000-8000-000000000058',tournament_table_id='84800000-0000-4000-8000-000000000058',table_session_id='83600000-0000-4000-8000-000000000058' WHERE id='86000000-0000-4000-8000-000000000001';COMMIT;`);a.end('');
 b=session('identity58_B',actor+`UPDATE public.tournament_hands SET tournament_id='85000000-0000-4000-8000-000000000001',table_id='84000000-0000-4000-8000-000000000001',tournament_table_id='84000000-0000-4000-8000-000000000001',table_session_id='83500000-0000-4000-8000-000000000001' WHERE id='86900000-0000-4000-8000-000000000058';COMMIT;`);b.end('');
 await barrier('identity58_A',"wait_event='advisory'");await barrier('identity58_B',"wait_event='advisory'");
 if(fixed&&!statement)assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE a.application_name='identity58_A' AND b.application_name='identity58_B');"),'t','waiter must block on scope owner before OLD invalidation');
 gate.end('SELECT pg_advisory_unlock_all();');await gate.result;
 const results=await Promise.all([a.result,b.result]);
 if(fixed){for(const r of results)assert.equal(r.code,0,r.error);assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes WHERE idempotency_key LIKE 'identity58-opposite-%' AND status='stale';"),'2');console.log(statement?'HAND_IDENTITY58_OPPOSITE_REPARENT_STATEMENT_PASS':'HAND_IDENTITY58_OPPOSITE_REPARENT_ORDERED_SCOPE_PASS');}
 else {assert.ok(results.some(r=>r.code!==0&&/deadlock detected/.test(r.error)),JSON.stringify(results));console.log('HAND_IDENTITY58_OPPOSITE_REPARENT_DEADLOCK_REPRODUCED');}
}finally{gate?.end('SELECT pg_advisory_unlock_all();');a?.end('ROLLBACK;');b?.end('ROLLBACK;');await Promise.all([gate?.result,a?.result,b?.result]);sql('DROP TRIGGER zzzz_identity58_test_barrier ON public.tournament_hands;DROP FUNCTION public.identity58_test_barrier();');}
