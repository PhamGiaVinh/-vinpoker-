#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Dealer Swing hardening — A0 baseline metric probe (one-shot, PURE READ-ONLY).
// Freezes the "before" numbers for the hardening roadmap (overdue exposure,
// swing volume + manual-override mix, fairness spread, pre-announce reliability,
// lock health). See docs/dealer-swing/HARDENING_STAGE0_AND_A0A_PREFLIGHT.md §2.
// ════════════════════════════════════════════════════════════════════════════
// • Every query is SELECT/WITH/EXPLAIN only. A guard refuses any write keyword.
// • No credentials in this file. Absent creds → prints env names, exits 0.
// • Tokens / connection strings masked in all output.
// • Per-query try/catch: a schema mismatch on one query never aborts the rest.
// • to_jsonb(t.*) used where column names are uncertain (no assumptions).
// • NOTE: race_lost rate is intentionally absent — not reconstructable from
//   swing_audit_logs (canonical perform_swing returns before the audit INSERT).
// Transport: Supabase Management SQL API (POST /v1/projects/{ref}/database/query).
// ════════════════════════════════════════════════════════════════════════════

const log = (...a) => console.log("[baseline]", ...a);
const fail = (...a) => { console.error("[baseline] ✗", ...a); process.exit(1); };

function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
}

// strip strings + comments, then assert read-only
function assertReadOnly(label, sql) {
  let s = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
  if (!/^\s*(with|select|explain)\b/i.test(s)) fail(`query "${label}" is not a SELECT/WITH/EXPLAIN`);
  const bad = s.match(/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|merge)\b/i);
  if (bad) fail(`query "${label}" contains a write keyword: ${bad[1]}`);
}

const WINDOW = "interval '30 days'";

const QUERIES = [
  {
    label: "1) Overdue exposure — completed swings, due->actual relief (last 30d, by day/club)",
    sql: `
      with s as (
        select gt.club_id,
               (da.released_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
               extract(epoch from (da.released_at - da.swing_due_at))/60.0 as overdue_min
        from dealer_assignments da
        join game_tables gt on gt.id = da.table_id
        where da.status = 'completed'
          and da.swing_due_at is not null and da.released_at is not null
          and da.released_at >= now() - ${WINDOW}
      )
      select day, club_id,
             count(*) as completed_swings,
             round(avg(overdue_min) filter (where overdue_min > 0)::numeric, 1) as avg_overdue_min_when_late,
             round(max(overdue_min)::numeric, 1) as max_overdue_min,
             count(*) filter (where overdue_min > 5)  as late_gt5,
             count(*) filter (where overdue_min > 15) as late_gt15
      from s group by 1,2 order by 1 desc, 2 limit 200;`,
  },
  {
    label: "2) Swing volume + manual-override mix (swing_audit_logs, last 30d, by day/club)",
    sql: `
      select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
             club_id,
             count(*) as total_actions,
             count(*) filter (where action = 'swing_success')   as swing_success,
             count(*) filter (where action = 'swing_no_dealer')  as swing_no_dealer,
             count(*) filter (
               where triggered_by is not null
                 and triggered_by not ilike '%process-swing%'
                 and triggered_by not ilike '%cron%'
                 and triggered_by not ilike '%system%'
                 and triggered_by not ilike '%scheduler%'
             ) as manual_actions
      from swing_audit_logs
      where created_at >= now() - ${WINDOW}
      group by 1,2 order by 1 desc, 2 limit 200;`,
  },
  {
    label: "2b) Distinct triggered_by values (to classify manual vs cron, last 30d)",
    sql: `
      select triggered_by, count(*) as n
      from swing_audit_logs
      where created_at >= now() - ${WINDOW}
      group by 1 order by 2 desc limit 50;`,
  },
  {
    label: "3) Fairness spread — per-dealer assigned minutes per day, stddev across roster (last 30d)",
    sql: `
      with sessions as (
        select att.dealer_id,
               (da.assigned_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
               extract(epoch from (coalesce(da.released_at, now()) - da.assigned_at))/60.0 as minutes
        from dealer_assignments da
        join dealer_attendance att on att.id = da.attendance_id
        where da.assigned_at >= now() - ${WINDOW}
      ),
      per_dealer as (
        select day, dealer_id, count(*) as sessions, sum(minutes) as total_min
        from sessions group by 1,2
      )
      select day,
             count(*) as dealers,
             round(avg(total_min)::numeric, 1)        as avg_min,
             round(stddev_pop(total_min)::numeric, 1) as stddev_min,
             round(min(total_min)::numeric, 1)        as min_min,
             round(max(total_min)::numeric, 1)        as max_min
      from per_dealer group by 1 order by 1 desc limit 60;`,
  },
  {
    label: "4) Pre-announce reliability (pre_announce_jobs by status, last 30d)",
    sql: `
      select (to_jsonb(j.*)->>'status') as status,
             count(*) as n,
             round(avg((to_jsonb(j.*)->>'attempts')::numeric), 2) as avg_attempts,
             max((to_jsonb(j.*)->>'attempts')::int) as max_attempts
      from pre_announce_jobs j
      where (to_jsonb(j.*)->>'created_at')::timestamptz >= now() - ${WINDOW}
      group by 1 order by 2 desc;`,
  },
  {
    label: "5) Lock health snapshot — current club_processing_locks rows (for B2 baseline)",
    sql: `
      select to_jsonb(l.*) as lock_row
      from club_processing_locks l
      limit 20;`,
  },
];

async function run(creds, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${creds.ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${mask(await res.text())}`);
  return res.json();
}

async function main() {
  // ALWAYS validate read-only first (aborts hard if any query is not read-only).
  QUERIES.forEach((q) => assertReadOnly(q.label, q.sql));
  log("all queries verified read-only (SELECT/WITH/EXPLAIN only).");

  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) {
    log("no credentials present — NOTHING contacted. To run, set:");
    log("  SUPABASE_PROJECT_REF   = <project ref>");
    log("  SUPABASE_ACCESS_TOKEN  = <Supabase Management API token, from GitHub Secret>");
    process.exit(0);
  }
  const creds = { ref, token };

  let hadError = false;
  for (const q of QUERIES) {
    log("──────────────────────────────────────────────────────");
    log(q.label);
    try {
      const rows = await run(creds, q.sql);
      console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
      hadError = true;
      console.error("[baseline] ✗ query failed (continuing):", mask(e.message));
    }
  }
  log("──────────────────────────────────────────────────────");
  log(hadError ? "baseline probe done WITH per-query errors (read-only)." : "baseline probe done (read-only).");
}

main().catch((e) => fail(mask(e.message)));
