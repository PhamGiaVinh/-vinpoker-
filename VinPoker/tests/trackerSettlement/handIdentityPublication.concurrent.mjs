import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_identity58_history_runtime_20261011');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(q){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function session(name,q){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 child.stdin.write(`SET application_name='${name}';SET statement_timeout='12s';SET idle_in_transaction_session_timeout='15s';${q}\n`);
 return{result,end:q=>{if(!child.stdin.writableEnded)child.stdin.end(q+'\n');}};
}
async function barrier(name,predicate){for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${predicate});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('barrier missing '+name);}
const hand='d3000000-0000-4000-8000-000000000021';
const owner='d3000000-0000-4000-8000-000000000010';
assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id WHERE h.id='${hand}' AND c.owner_id='${owner}' AND h.status='completed';`),'1');
sql(`UPDATE public.tournament_hands SET hand_number=hand_number+100 WHERE id='${hand}';`);
const requestKey='identity58-publication-overlap-'+sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`);
sql(`UPDATE public.tracker_historical_display_queue SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE hand_id<>'${hand}' AND status IN('pending','processing');`);
const suite=readFileSync(new URL('../protectedNineIntegratedUat/history.pg17.sql',import.meta.url),'utf8');
const payloadSql=suite.slice(suite.indexOf('CREATE TEMP TABLE history_runtime_source AS'),suite.indexOf('SET ROLE service_role;',suite.indexOf('CREATE TEMP TABLE history_runtime_source AS')));
assert.ok(payloadSql.includes('GRANT SELECT'));
let worker,identity;
try{
 worker=session('identity58_publication',`BEGIN;${payloadSql}
 UPDATE history_runtime_outcome SET payload=jsonb_set(payload,'{settlementRevision}',to_jsonb((SELECT COALESCE(max(settlement_revision),0)+1 FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}')));
 SET LOCAL ROLE service_role;SET LOCAL request.jwt.claims='{"role":"service_role"}';
 CREATE TEMP TABLE publication_claim AS SELECT * FROM public.claim_tracker_historical_display_jobs(1);
 DO $$ BEGIN IF (SELECT hand_id FROM publication_claim) IS DISTINCT FROM '${hand}'::uuid THEN RAISE EXCEPTION 'publication_wrong_claim';END IF;END $$;
 SELECT public.commit_tracker_historical_display_outcome_v2(c.hand_id,'00000000-0000-4000-8000-000000000001','system_worker',s.source_revision,s.source_chain_hash,repeat('a',64),repeat('b',64),'${requestKey}',o.payload,c.lease_token)
 FROM publication_claim c CROSS JOIN history_runtime_source s CROSS JOIN history_runtime_outcome o;`);
 try{await barrier('identity58_publication',"wait_event='ClientRead' AND xact_start IS NOT NULL");}
 catch(e){worker.end('ROLLBACK;');const r=await worker.result;assert.fail(String(e)+' '+r.error);}
 identity=session('identity58_publication_owner',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${owner}';UPDATE public.tournament_hands SET hand_number=hand_number+100 WHERE id='${hand}';COMMIT;`);identity.end('');
 await barrier('identity58_publication_owner',"wait_event_type='Lock'");
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity d JOIN pg_stat_activity w ON w.pid=ANY(pg_blocking_pids(d.pid)) WHERE d.application_name='identity58_publication_owner' AND w.application_name='identity58_publication');"),'t');
 worker.end('COMMIT;');
 const result=await worker.result;assert.equal(result.code,0,result.error);assert.match(result.out,/"ok": true/);
 const changed=await identity.result;assert.equal(changed.code,0,changed.error);
 assert.equal(sql(`SELECT status FROM public.tournament_settlement_outcomes WHERE idempotency_key='${requestKey}';`),'stale');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}' AND q.status='pending';`),'1');
 console.log('HAND_IDENTITY58_WORKER_PUBLICATION_OVERLAP_PASS');
}finally{worker?.end('ROLLBACK;');identity?.end('ROLLBACK;');await Promise.all([worker?.result,identity?.result]);}
