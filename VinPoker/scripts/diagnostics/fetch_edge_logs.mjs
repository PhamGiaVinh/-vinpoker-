#!/usr/bin/env node
// Read-only fetch of recent tournament-register Edge Function logs to diagnose the registration
// "non-2xx" error. NOTHING is written. Secrets masked. No creds → exit 0.

const log = (...a) => console.log("[edge-logs]", ...a);
const mask = (s) => String(s)
  .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
  .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { log("no credentials — set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN. Exiting safely."); process.exit(0); }

// wide window: last 24h (logs.all defaults to a narrow recent window otherwise)
const end = new Date();
const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
const range = `&iso_timestamp_start=${encodeURIComponent(start.toISOString())}&iso_timestamp_end=${encodeURIComponent(end.toISOString())}`;

async function q(label, sql) {
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}${range}`;
  let res;
  try { res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (e) { log(`${label}: network error ${mask(e.message)}`); return; }
  const text = await res.text();
  if (!res.ok) { log(`${label}: HTTP ${res.status} ${mask(text).slice(0, 400)}`); return; }
  let json; try { json = JSON.parse(text); } catch { log(`${label}: non-JSON ${mask(text).slice(0,300)}`); return; }
  const rows = json.result ?? json.data ?? [];
  log(`── ${label} (${Array.isArray(rows) ? rows.length : 0} rows) ──`);
  console.log(mask(JSON.stringify(rows, null, 2)).slice(0, 7000));
}

// 1) Edge HTTP logs — status code per tournament-register request.
await q("edge: tournament-register status", `
select t.timestamp, req.method as method, req.path as path, resp.status_code as status
from function_edge_logs t
cross join unnest(t.metadata) m
cross join unnest(m.request) req
cross join unnest(m.response) resp
where req.path like '%tournament-register%'
order by t.timestamp desc limit 20`);

// 2) Deno function logs — the actual console.error / thrown message (all functions, recent).
await q("fn logs: recent messages", `
select t.timestamp, t.event_message, m.level as level
from function_logs t
cross join unnest(t.metadata) m
order by t.timestamp desc limit 40`);

log("done (read-only).");
