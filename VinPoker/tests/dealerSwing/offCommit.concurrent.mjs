import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
assert.equal(process.env.PGHOST, "127.0.0.1");
assert.ok(process.env.PGDATABASE?.startsWith("vinpoker_ops_off_"));
const club = "22000000-0000-4000-8000-000000000001";
const owner = "22000000-0000-4000-8000-000000000002";
const table = "22000000-0000-4000-8000-000000000003";
const dealer = "22000000-0000-4000-8000-000000000004";
const attendance = "22000000-0000-4000-8000-000000000005";
const worker = "SET request.jwt.claim.role='service_role'; SET request.headers='{}';";
function sql(query) {
  const result = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function insert(id) {
  return `INSERT INTO public.dealer_assignments(id,club_id,table_id,attendance_id,dealer_id,status)
    VALUES('22000000-0000-4000-8000-${id}','${club}','${table}','${attendance}','${dealer}','assigned');`;
}
function transaction(marker, query, hold = false) {
  const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"]);
  let out = "", error = "";
  const result = new Promise(resolve => {
    child.stdout.on("data", chunk => out += chunk);
    child.stderr.on("data", chunk => error += chunk);
    child.on("error", exception => resolve({ code: -1, error: String(exception), out }));
    child.on("close", code => resolve({ code, error, out }));
  });
  child.stdin.write(`SET application_name='${marker}'; ${worker} BEGIN; ${query}\n`);
  if (!hold) child.stdin.end("COMMIT;\n");
  return { result, commit: () => child.stdin.end("COMMIT;\n") };
}
async function barrier(marker, condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND application_name='${marker}' AND ${condition});`) === "t") return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`true-overlap barrier missing: ${marker}`);
}
// Owner OFF holds an uncommitted update; the arriving automatic acquisition must wait,
// then observe OFF (not the previous ON snapshot) and roll back.
sql(`UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='${club}';`);
const off = transaction("off_fence_holder", `UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${club}';`, true);
await barrier("off_fence_holder", "wait_event='ClientRead' AND xact_start IS NOT NULL");
const late = transaction("off_fence_late", insert("000000000010"));
await barrier("off_fence_late", "wait_event_type='Lock'");
off.commit();
assert.equal((await off.result).code, 0);
const denied = await late.result;
assert.notEqual(denied.code, 0);
assert.match(denied.error, /AUTO_SWING_OFF/);
assert.equal(sql("SELECT count(*) FROM public.dealer_assignments;"), "0");

// Acquisition owns SHARE until commit: OFF waits. Another worker's SHARE remains
// compatible, including an attendance write in the same transaction.
sql(`UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='${club}';`);
const acquiring = transaction("off_fence_acquiring", insert("000000000011") +
  `UPDATE public.dealer_attendance SET current_state='assigned' WHERE id='${attendance}';`, true);
await barrier("off_fence_acquiring", "wait_event='ClientRead' AND xact_start IS NOT NULL");
const peer = transaction("off_fence_peer", insert("000000000012"), true);
await barrier("off_fence_peer", "wait_event='ClientRead' AND xact_start IS NOT NULL");
const stopping = transaction("off_fence_stopping", `UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${club}';`);
await barrier("off_fence_stopping", "wait_event_type='Lock'");
peer.commit(); acquiring.commit();
assert.equal((await peer.result).code, 0);
assert.equal((await acquiring.result).code, 0);
assert.equal((await stopping.result).code, 0);
assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}';`), "f");

// The manual exception requires the verified owner; automatic retries remain denied.
sql(`${worker} SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${owner}"}'; ${insert("000000000013")}`);
const retry = await transaction("off_fence_retry", insert("000000000014")).result;
assert.match(retry.error, /AUTO_SWING_OFF/);
assert.equal(sql("SELECT count(*) FROM public.dealer_assignments;"), "3");
console.log("OFF-at-commit true overlap, compatible workers, manual-OFF and late retry PASS");
