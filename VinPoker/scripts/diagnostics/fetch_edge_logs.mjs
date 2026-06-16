#!/usr/bin/env node
// Read-only fetch of recent tournament-register Edge Function logs (status codes + messages)
// to diagnose the "non-2xx" registration error. NOTHING is written. Secrets masked. No creds → exit 0.
import { setTimeout as sleep } from "node:timers/promises";

const log = (...a) => console.log("[edge-logs]", ...a);
const fail = (...a) => { console.error("[edge-logs] ✗", ...a); process.exit(1); };
const mask = (s) => String(s)
  .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
  .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  log("no credentials — set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN. Exiting safely.");
  process.exit(0);
}

async function logQuery(label, sql) {
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`;
  let res;
  try { res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (e) { log(`${label}: network error ${mask(e.message)}`); return; }
  if (!res.ok) { log(`${label}: HTTP ${res.status} ${mask(await res.text()).slice(0, 300)}`); return; }
  const json = await res.json();
  const rows = json.result ?? json.data ?? json;
  log(`── ${label} (${Array.isArray(rows) ? rows.length : 0} rows) ──`);
  console.log(JSON.stringify(rows, null, 2).slice(0, 6000));
}

// 1) Edge routing logs: status code per tournament-register request (last ~2h).
const edgeSql = `
select t.timestamp, m.execution_time_ms, req.method, req.url, resp.status_code
from function_edge_logs as t
cross join unnest(t.metadata) as m
cross join unnest(m.request) as req
cross join unnest(m.response) as resp
where req.url like '%tournament-register%'
order by t.timestamp desc
limit 20`;

// 2) Deno function logs: console.error / uncaught messages (last ~2h), all functions.
const fnSql = `
select t.timestamp, t.event_message, m.level, m.function_id
from function_logs as t
cross join unnest(t.metadata) as m
where m.level in ('error','warning') or t.event_message ilike '%error%' or t.event_message ilike '%exception%'
order by t.timestamp desc
limit 30`;

await logQuery("function_edge_logs (status codes)", edgeSql);
await sleep(300);
await logQuery("function_logs (errors)", fnSql);
log("done (read-only).");
