#!/usr/bin/env node
// Read-only fetch of recent Edge logs (event_message only — robust) to find the tournament-register
// failure. NOTHING is written. Secrets masked. No creds → exit 0.
const log = (...a) => console.log("[edge-logs]", ...a);
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { log("no credentials — exiting safely."); process.exit(0); }

const end = new Date();
const start = new Date(end.getTime() - 12 * 60 * 60 * 1000); // last 12h
const range = `&iso_timestamp_start=${encodeURIComponent(start.toISOString())}&iso_timestamp_end=${encodeURIComponent(end.toISOString())}`;

async function q(label, sql) {
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}${range}`;
  let res;
  try { res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (e) { log(`${label}: network ${mask(e.message)}`); return; }
  const text = await res.text();
  if (!res.ok) { log(`${label}: HTTP ${res.status} ${mask(text).slice(0, 400)}`); return; }
  let j; try { j = JSON.parse(text); } catch { log(`${label}: ${mask(text).slice(0,300)}`); return; }
  const rows = j.result ?? j.data ?? [];
  log(`── ${label} (${rows.length} rows) ──`);
  for (const r of rows) console.log(mask(`${r.timestamp ?? ""} | ${r.event_message ?? JSON.stringify(r)}`).slice(0, 500));
}

// Edge HTTP logs — event_message usually "POST | <status> | <ip> | <id> | <url> | ...".
await q("function_edge_logs (recent 40)", `select id, timestamp, event_message from function_edge_logs order by timestamp desc limit 40`);
// Deno function logs — console.log/error + uncaught exceptions.
await q("function_logs (recent 50)", `select id, timestamp, event_message from function_logs order by timestamp desc limit 50`);
log("done (read-only).");
