#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Finance read-only probe — find the "test" tour(s) and show buy-in / rake /
// per-registration (total_pay − buy_in). PURE READ-ONLY.
// ════════════════════════════════════════════════════════════════════════════
// • Every query is SELECT/WITH only. A guard refuses any write keyword
//   (insert/update/delete/drop/alter/create/grant/revoke/truncate/copy/call).
// • No credentials in this file. Absent creds → prints env names, exits 0.
// • Tokens / connection strings masked in all output.
// • Uses to_jsonb(t.*) so it never assumes column names (missing cols → null,
//   not an error). Reads `tournament_registrations` cols the live finance hook
//   already uses (total_pay, buy_in, reference_code, status).
//
// Transport: Supabase Management SQL API (POST /v1/projects/{ref}/database/query).
// ════════════════════════════════════════════════════════════════════════════

const log = (...a) => console.log("[probe]", ...a);
const fail = (...a) => { console.error("[probe] ✗", ...a); process.exit(1); };

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

const TZ = "Asia/Ho_Chi_Minh";

const QUERIES = [
  {
    label: "1) tournaments columns",
    sql: `select column_name, data_type
          from information_schema.columns
          where table_schema='public' and table_name='tournaments'
          order by ordinal_position;`,
  },
  {
    label: "2) tours matching 'test' (any column) — newest 30, with confirmed-reg sums",
    sql: `
      with tt as (
        select t.id, to_jsonb(t.*) as j, t.created_at
        from tournaments t
        where to_jsonb(t.*)::text ilike '%test%'
        order by t.created_at desc
        limit 30
      ),
      g as (
        select r.tournament_id,
               count(*) as regs_total,
               count(*) filter (where r.status='confirmed') as regs_confirmed,
               sum((r.total_pay)::numeric) filter (where r.status='confirmed') as sum_total_pay,
               sum((r.buy_in)::numeric)    filter (where r.status='confirmed') as sum_buy_in,
               sum(greatest(0,(r.total_pay)::numeric-(r.buy_in)::numeric)) filter (where r.status='confirmed') as sum_actual
        from tournament_registrations r
        where r.tournament_id in (select id from tt)
        group by r.tournament_id
      )
      select tt.j->>'name'        as name,
             tt.j->>'title'       as title,
             tt.j->>'club_id'     as club_id,
             tt.j->>'buy_in'      as buy_in,
             tt.j->>'fee'         as fee,
             tt.j->>'rake_amount' as rake_amount,
             tt.j->>'free_rake_enabled' as free_rake_enabled,
             tt.j->>'free_rake_used'    as free_rake_used,
             tt.j->>'start_time'  as start_time,
             tt.created_at,
             tt.id,
             coalesce(g.regs_total,0)     as regs_total,
             coalesce(g.regs_confirmed,0) as regs_confirmed,
             g.sum_total_pay, g.sum_buy_in, g.sum_actual
      from tt left join g on g.tournament_id = tt.id
      order by tt.created_at desc;`,
  },
  {
    label: "3) tours created on 2026-06-09 (Asia/Ho_Chi_Minh), with confirmed-reg sums",
    sql: `
      with tt as (
        select t.id, to_jsonb(t.*) as j, t.created_at
        from tournaments t
        where t.created_at >= '2026-06-09 00:00:00+07'
          and t.created_at <  '2026-06-10 00:00:00+07'
      ),
      g as (
        select r.tournament_id,
               count(*) as regs_total,
               count(*) filter (where r.status='confirmed') as regs_confirmed,
               sum((r.total_pay)::numeric) filter (where r.status='confirmed') as sum_total_pay,
               sum((r.buy_in)::numeric)    filter (where r.status='confirmed') as sum_buy_in,
               sum(greatest(0,(r.total_pay)::numeric-(r.buy_in)::numeric)) filter (where r.status='confirmed') as sum_actual
        from tournament_registrations r
        where r.tournament_id in (select id from tt)
        group by r.tournament_id
      )
      select tt.j->>'name'        as name,
             tt.j->>'club_id'     as club_id,
             tt.j->>'buy_in'      as buy_in,
             tt.j->>'fee'         as fee,
             tt.j->>'rake_amount' as rake_amount,
             tt.created_at,
             tt.id,
             coalesce(g.regs_confirmed,0) as regs_confirmed,
             g.sum_total_pay, g.sum_buy_in, g.sum_actual
      from tt left join g on g.tournament_id = tt.id
      order by tt.created_at desc;`,
  },
  {
    label: "4) per-registration AGGREGATE for 'test' tours (distinct buy_in/total_pay, counts) — no PII",
    sql: `
      with tt as (
        select t.id
        from tournaments t
        where to_jsonb(t.*)::text ilike '%test%'
        order by t.created_at desc
        limit 30
      )
      select r.tournament_id,
             r.status,
             (r.buy_in)::numeric    as buy_in,
             (r.total_pay)::numeric as total_pay,
             greatest(0,(r.total_pay)::numeric-(r.buy_in)::numeric) as actual_fee_per_entry,
             count(*) as n
      from tournament_registrations r
      where r.tournament_id in (select id from tt)
      group by r.tournament_id, r.status, r.buy_in, r.total_pay
      order by r.tournament_id, buy_in
      limit 200;`,
  },
];

async function run(creds, sql) {
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${creds.ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
  } catch (e) { fail("network error:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

async function main() {
  // ALWAYS validate read-only first.
  QUERIES.forEach((q) => assertReadOnly(q.label, q.sql));
  log("all queries verified read-only (SELECT/WITH only).");

  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) {
    log("no credentials present — NOTHING contacted. To run, set:");
    log("  SUPABASE_PROJECT_REF   = <project ref>");
    log("  SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>");
    process.exit(0);
  }
  const creds = { ref, token };

  for (const q of QUERIES) {
    log("──────────────────────────────────────────────────────");
    log(q.label);
    const rows = await run(creds, q.sql);
    console.log(JSON.stringify(rows, null, 2));
  }
  log("──────────────────────────────────────────────────────");
  log("probe done (read-only).");
}

main().catch((e) => fail(mask(e?.message ?? String(e))));
