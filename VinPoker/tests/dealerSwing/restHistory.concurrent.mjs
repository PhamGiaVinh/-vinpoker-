import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn,spawnSync } from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const owner='e2600000-0000-4000-8000-000000000001';
const club='e2600000-0000-4000-8000-000000000002';
const attendance='e2600000-0000-4000-8000-000000000041';
const dealer='e2600000-0000-4000-8000-000000000031';
const table='e2600000-0000-4000-8000-000000000012';
const session='e2600000-0000-4000-8000-000000000022';
const worker="SET request.jwt.claim.role='service_role'; SET request.headers='{}';";
function sql(query) {
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); return r.stdout.trim();
}
let fixture=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
assert.equal((fixture.match(/ROLLBACK;/g)??[]).length,1);
fixture=fixture.replace('BEGIN;',`BEGIN; SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);`)
  .replace('ROLLBACK;','COMMIT;').replaceAll('e1700000-','e2600000-').replaceAll("'exact-key'","'rest-history-concurrent-initial'");
sql(fixture);
sql(`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${club}',true) ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
 VALUES('${session}','${club}','${table}','cash','manual',1,1,'${owner}');
 UPDATE public.dealer_attendance SET last_released_at=now()-interval '60 minutes' WHERE id='${attendance}';`);
function transaction(marker,query,hold=false) {
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',error='';
  const result=new Promise(resolve=>{
    child.stdout.on('data',chunk=>out+=chunk); child.stderr.on('data',chunk=>error+=chunk);
    child.on('error',e=>resolve({code:-1,error:String(e),out})); child.on('close',code=>resolve({code,error,out}));
  });
  child.stdin.write(`SET application_name='${marker}'; ${worker} BEGIN; SET LOCAL statement_timeout='5s'; ${query}\n`);
  if(!hold) child.stdin.end('COMMIT;\n');
  return {result,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(marker,condition) {
  for(let i=0;i<100;i++) {
    if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND application_name='${marker}' AND ${condition});`)==='t') return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail(`true-overlap barrier missing: ${marker}`);
}
const insert=`INSERT INTO public.dealer_assignments(table_id,table_session_id,attendance_id,dealer_id,club_id,status,assigned_at)
 VALUES('${table}','${session}','${attendance}','${dealer}','${club}','assigned',now());`;
const release=`UPDATE public.dealer_assignments SET status='completed',released_at=clock_timestamp() WHERE attendance_id='${attendance}' AND status='assigned' AND released_at IS NULL;`;
// Legacy release writer does not lock/update attendance. An old MVCC active row
// must block the new assignment BEFORE uniqueness waits can turn it into a short-rest commit.
const first=transaction('rest_history_release_no_marker',release,true);
await barrier('rest_history_release_no_marker',"wait_event='ClientRead' AND xact_start IS NOT NULL");
const before=await transaction('rest_history_before_release_commit',insert).result;
assert.notEqual(before.code,0); assert.match(before.error,/DEALER_REST_ACTIVE_ASSIGNMENT/);
first.commit(); assert.equal((await first.result).code,0);
const after=await transaction('rest_history_after_release_commit',insert).result;
assert.notEqual(after.code,0); assert.match(after.error,/DEALER_REST_REQUIRED/);
// Real attendance lock overlap: after waiting, the next SPI snapshot must see
// the just-committed release even though the stored attendance marker stays old.
sql(`${worker} SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${owner}"}';
 UPDATE public.dealer_assignments SET status='assigned',released_at=NULL WHERE attendance_id='${attendance}' AND status='completed';`);
const holder=transaction('rest_history_release_attendance_holder',`SELECT id FROM public.dealer_attendance WHERE id='${attendance}' FOR UPDATE; ${release}`,true);
await barrier('rest_history_release_attendance_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
const arriving=transaction('rest_history_release_attendance_waiter',insert);
await barrier('rest_history_release_attendance_waiter',"wait_event_type='Lock'");
holder.commit(); assert.equal((await holder.result).code,0);
const waited=await arriving.result;
assert.notEqual(waited.code,0); assert.match(waited.error,/DEALER_REST_REQUIRED/);
assert.doesNotMatch(waited.error,/deadlock|statement timeout/);
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${session}' AND status='assigned';`),'0');
console.log('REST_HISTORY_PRE_COMMIT_ACTIVE_AND_POST_COMMIT_FRESH_RELEASE_TRUE_OVERLAP_PASS');
