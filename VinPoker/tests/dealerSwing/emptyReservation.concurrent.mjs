import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_reservation_'));
function sql(query) {
 const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr); return result.stdout.trim();
}
const club='e2400000-0000-4000-8000-000000000002';
const table='e2300000-0000-4000-8000-000000000010';
const session='e2300000-0000-4000-8000-000000000020';
const attendance='e2300000-0000-4000-8000-000000000040';
const replacement='e2300000-0000-4000-8000-000000000041';
const dealerB='e2300000-0000-4000-8000-000000000031';
const worker=`SET request.jwt.claim.role='service_role'; SET request.headers='{}';`;
const fixture=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
const seed=readFileSync('tests/dealerSwing/emptyReservation.pg17.sql','utf8').split('SET LOCAL ROLE service_role;')[0];
const manual=`SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);`;
// This database is disposable and empty; committed fixtures are necessary for genuine other-session visibility.
sql(fixture.replace('BEGIN;',`BEGIN; ${manual}`).replace('ROLLBACK;',()=>seed+'\nCOMMIT;')
 .replaceAll('e1700000-','e2400000-').replaceAll("'exact-key'","'reservation-overlap-exact-key'"));
const reservation=JSON.parse(sql(`${worker} SELECT public.reserve_empty_table_for_dealer_v2('${table}','${session}','${attendance}',now(),'${club}');`)).reservation_id;
assert.ok(reservation);
sql(`UPDATE public.dealer_attendance SET current_state='available' WHERE id='${attendance}';
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${dealerB}','${club}','Unrested replacement TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,last_released_at)
 VALUES('${replacement}','${dealerB}','e2400000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'on_break',now());`);
function transaction(marker,query,hold=false) {
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',error='';
 const done=new Promise(resolve=>{
  child.stdout.on('data',part=>out+=part); child.stderr.on('data',part=>error+=part);
  child.on('error',exception=>resolve({code:-1,error:String(exception),out}));
  child.on('close',code=>resolve({code,error,out}));
 });
 child.stdin.write(`SET application_name='${marker}'; ${worker} BEGIN; ${query}\n`);
 if(!hold) child.stdin.end('COMMIT;\n');
 return {done,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(marker,condition) {
 for(let attempt=0;attempt<100;attempt++) {
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND application_name='${marker}' AND ${condition});`)==='t') return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.fail(`true-overlap barrier missing: ${marker}`);
}
// Executor sees A, then waits on the physical row. A concurrent writer swaps the
// same reservation to B; the final locked tuple must reject B rather than using A's rest proof.
const holder=transaction('reservation_physical_holder',`SELECT 1 FROM public.game_tables WHERE id='${table}' FOR UPDATE;`,true);
await barrier('reservation_physical_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
const executor=transaction('reservation_identity_executor',`SELECT public.execute_empty_table_reservation_v2('${reservation}','${session}',now()+interval '30 minutes');`);
await barrier('reservation_identity_executor',"wait_event_type='Lock'");
sql(`${worker} UPDATE public.dealer_assignments SET attendance_id='${replacement}',dealer_id='${dealerB}' WHERE id='${reservation}';`);
holder.commit(); assert.equal((await holder.done).code,0);
const result=await executor.done; assert.equal(result.code,0,result.error);
assert.match(result.out,/reservation_identity_changed/);
assert.equal(sql(`SELECT status FROM public.dealer_assignments WHERE id='${reservation}';`),'reserved');
assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${replacement}';`),'on_break');
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE attendance_id='${replacement}' AND status='assigned';`),'0');
console.log('Current-schema true-overlap reservation identity swap rejected without assigning unrested replacement PASS');
