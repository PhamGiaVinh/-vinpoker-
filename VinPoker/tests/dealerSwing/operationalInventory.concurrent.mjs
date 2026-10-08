import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
assert.equal(process.env.PGHOST,"127.0.0.1");
assert.ok(process.env.PGDATABASE?.startsWith("vinpoker_ops_"));
function sql(query) {
  const result=spawnSync("psql",["-X","-qAt","-v","ON_ERROR_STOP=1"],{ input: query, encoding: "utf8" });
  if(result.status!==0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const fixture=readFileSync("tests/dealerSwing/operationalInventory.pg17.sql","utf8");
assert.equal((fixture.match(/ROLLBACK;/g)??[]).length,1);
sql(fixture.replace("ROLLBACK;","COMMIT;"));
const club="e1700000-0000-4000-8000-000000000002";
const table="e1700000-0000-4000-8000-000000000012";
const session="e1700000-0000-4000-8000-000000000022";
const firstAttendance="e1700000-0000-4000-8000-000000000042";
const secondAttendance="e1700000-0000-4000-8000-000000000043";
sql(`INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
  VALUES('${session}','${club}','${table}','cash','manual',1,1,'e1700000-0000-4000-8000-000000000001');
  INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
  ('e1700000-0000-4000-8000-000000000032','${club}','Concurrency TEST 2','active'),
  ('e1700000-0000-4000-8000-000000000033','${club}','Concurrency TEST 3','active');
  INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES
  ('${firstAttendance}','e1700000-0000-4000-8000-000000000032','e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available'),
  ('${secondAttendance}','e1700000-0000-4000-8000-000000000033','e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');`);
const worker="SET ROLE service_role; SET request.jwt.claim.role='service_role';";
function call(attendance,key,exact=session) {
  return `SELECT public.worker_assign_dealer_to_session_v1('${club}','${table}','${exact}','${attendance}','2026-10-09T10:30:00Z','${key}');`;
}
function concurrent(query, marker) {
  return new Promise((resolve,reject)=>{
    const child=spawn("psql",["-X","-qAt","-v","ON_ERROR_STOP=1"]); let out="",error="";
    child.stdout.on("data",chunk=>out+=chunk); child.stderr.on("data",chunk=>error+=chunk);
    child.on("error",reject); child.on("close",code=>code===0?resolve(out.trim()):reject(new Error(error)));
    child.stdin.end(`SET application_name='${marker}'; ${query}`);
  });
}
async function barrier(marker,condition) {
  for(let attempt=0;attempt<50;attempt++) {
    if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND application_name='${marker}' AND ${condition});`)==="t") return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail(`true overlap barrier not reached: ${marker}`);
}
const first=concurrent(`${worker} BEGIN; ${call(firstAttendance,"parallel-first")} SELECT pg_sleep(2); COMMIT;`, "initial_assign_holder");
await barrier("initial_assign_holder","wait_event='PgSleep'");
const second=concurrent(`${worker} ${call(secondAttendance,"parallel-second")}`, "initial_assign_waiter");
await barrier("initial_assign_waiter","wait_event_type='Lock'");
assert.equal(JSON.parse((await first).split(/\r?\n/).find(line=>line.startsWith("{"))).outcome,"ok");
assert.equal(JSON.parse(await second).outcome,"table_occupied");
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${session}' AND released_at IS NULL;`),"1");
assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${secondAttendance}';`),"available");
// A second Edge request can compute a different due time before seeing the first
// receipt. The canonical writer conflicts, then the service wrapper reconciles.
assert.equal(JSON.parse(sql(`${worker} ${call(firstAttendance,"parallel-first").replace("10:30:00Z","10:30:01Z")}`)).outcome,"idempotency_mismatch");
const reconciled=JSON.parse(sql(`${worker} SELECT public.worker_read_initial_assignment_receipt_v1('parallel-first','${club}','${table}','${session}','e1700000-0000-4000-8000-000000000032');`));
assert.equal(reconciled.outcome,"ok");
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE id='${reconciled.assignment_id}';`),"1");
// Fixture lifecycle writer, not proof of the complete Floor-close journey. Its
// committed session replacement must invalidate an already queued old-session fill.
const replacement="e1700000-0000-4000-8000-000000000025";
const close=concurrent(`BEGIN; SELECT id FROM public.game_tables WHERE id='${table}' FOR UPDATE;
  UPDATE public.dealer_assignments SET status='completed',released_at=clock_timestamp() WHERE table_session_id='${session}' AND released_at IS NULL;
  UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id='${session}';
  INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
  VALUES('${replacement}','${club}','${table}','cash','manual',1,1,'e1700000-0000-4000-8000-000000000001');
  SELECT pg_sleep(2); COMMIT;`, "close_reopen_holder");
await barrier("close_reopen_holder","wait_event='PgSleep'");
const stale=concurrent(`${worker} ${call(secondAttendance,"stale-session-key")}`, "close_reopen_waiter");
await barrier("close_reopen_waiter","wait_event_type='Lock'");
await close;
assert.equal(JSON.parse(await stale).outcome,"table_session_changed");
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${replacement}';`),"0");
const reservation=concurrent(`BEGIN;
  SELECT id FROM public.game_tables WHERE id='${table}' FOR UPDATE;
  SELECT id FROM public.table_sessions WHERE id='${replacement}' FOR UPDATE;
  INSERT INTO public.dealer_assignments(attendance_id,dealer_id,club_id,table_id,table_session_id,status)
  VALUES('${firstAttendance}','e1700000-0000-4000-8000-000000000032','${club}','${table}','${replacement}','reserved');
  SELECT pg_sleep(2); COMMIT;`, "reservation_holder");
await barrier("reservation_holder","wait_event='PgSleep'");
const reservedFill=concurrent(`${worker} ${call(secondAttendance,"reserved-target-key",replacement)}`, "reservation_waiter");
await barrier("reservation_waiter","wait_event_type='Lock'");
await reservation;
assert.equal(JSON.parse(await reservedFill).outcome,"table_occupied");
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${replacement}' AND released_at IS NULL;`),"1");
console.log("EXACT_SESSION_INITIAL_ASSIGN_AND_CLOSE_REOPEN_TRUE_OVERLAP_PASS");
