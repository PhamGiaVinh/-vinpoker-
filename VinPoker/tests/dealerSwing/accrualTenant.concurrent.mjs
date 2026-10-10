import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_policy57_overlap_20261011');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const club='81000000-0000-4000-8000-000000000001';
const owner='81100000-0000-4000-8000-000000000001';
function sql(query){
 const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
assert.equal(sql(`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)'::regprocedure;`),'70839e7ef76e135897c445068e3b4085');
assert.equal(sql(`SELECT owner_id FROM public.clubs WHERE id='${club}';`),owner);
assert.equal(sql(`SELECT count(*) FROM public.dealer_pt_wage_accrual_policies WHERE club_id='${club}';`),'0','fresh clone required; no policy reset');
const auditCount=()=>Number(sql(`SELECT count(*) FROM public.payroll_audit_log WHERE club_id='${club}' AND table_name='dealer_pt_wage_accrual_policies';`));
const before=auditCount();
function tx(marker,hold=false){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{
  child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);
  child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));
 });
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${marker}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';SET LOCAL request.jwt.claim.sub='${owner}';SET LOCAL ROLE authenticated;
 SELECT public.set_dealer_pt_wage_accrual_policy('${club}',true,NULL,'Isolated policy57 overlap');\n`);
 if(!hold)end('COMMIT');
 return {result,end};
}
async function barrier(marker,predicate){
 for(let i=0;i<100;i++){
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${predicate});`)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.fail(`actual overlap missing: ${marker}`);
}
let holder,waiter;
try{
 holder=tx('policy57_holder',true);
 await barrier('policy57_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
 waiter=tx('policy57_waiter');
 await barrier('policy57_waiter',"wait_event_type='Lock'");
 holder.end('COMMIT');
 const [a,b]=await Promise.all([holder.result,waiter.result]);
 assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);
 const first=JSON.parse(a.out.trim()),second=JSON.parse(b.out.trim());
 assert.equal(first.idempotent,false);assert.equal(second.idempotent,true);
 assert.equal(first.club_id,club);assert.equal(first.standby_accrual_enabled,true);
 const {idempotent:one,...original}=first,{idempotent:two,...replay}=second;
 assert.deepEqual(replay,original,'second writer cannot slide the policy boundary');
 assert.equal(sql(`SELECT count(*) FROM public.dealer_pt_wage_accrual_policies WHERE club_id='${club}';`),'1');
 assert.equal(auditCount()-before,1,'replay cannot duplicate payroll audit');
 console.log('POLICY57_TRUE_OVERLAP_COMMIT_REPLAY_ONE_AUDIT_PASS');
}finally{
 holder?.end('ROLLBACK');waiter?.end('ROLLBACK');
 await Promise.all([holder?.result,waiter?.result]);
}
