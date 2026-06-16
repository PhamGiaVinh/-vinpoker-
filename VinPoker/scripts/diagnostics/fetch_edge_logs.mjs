#!/usr/bin/env node
// Read-only diagnosis of the tournament-register "non-2xx" error. Replicates the edge fn's
// gating checks via SELECT-only queries (Management SQL API). NOTHING is written. Secrets masked.
const log = (...a) => console.log("[reg-diag]", ...a);
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { log("no credentials — exiting safely."); process.exit(0); }

async function sql(label, q) {
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
  } catch (e) { log(`${label}: network error ${mask(e.message)}`); return; }
  const text = await res.text();
  if (!res.ok) { log(`${label}: HTTP ${res.status} ${mask(text).slice(0, 400)}`); return; }
  log(`── ${label} ──`);
  console.log(mask(text).slice(0, 5000));
}

// 1) Recent tournaments + the edge-fn gates: started? (start_time < now-1h), club, prices.
await sql("recent tournaments (+ started?/prices)", `
select t.id, t.name, t.club_id, t.status,
       t.start_time,
       (t.start_time is not null and t.start_time < now() - interval '1 hour') as started_block,
       t.buy_in, t.rake_amount, t.service_fee_amount,
       t.created_at
from public.tournaments t
order by t.created_at desc
limit 10;`);

// 2) Bank-account check (the most common 400: "CLB chưa cấu hình tài khoản nhận tiền").
//    The fn needs a club-active bank OR a platform-wide active bank (club_id is null).
await sql("active bank accounts: per recent club + platform-wide fallback", `
with recent as (select distinct club_id from public.tournaments order by 1 desc),
     clubbanks as (
       select club_id, count(*) as active_banks
       from public.platform_bank_accounts where is_active and club_id is not null
       group by club_id)
select
  (select count(*) from public.platform_bank_accounts where is_active and club_id is null) as platform_wide_active_banks,
  (select coalesce(jsonb_agg(jsonb_build_object('club_id', cb.club_id, 'active_banks', cb.active_banks)), '[]')
     from clubbanks cb) as per_club_active_banks;`);

// 3) Sanity: is service_fee_amount actually on the table (post-apply)?
await sql("service_fee_amount column present?", `
select count(*) as col_present, max(column_default) as col_default
from information_schema.columns
where table_schema='public' and table_name='tournaments' and column_name='service_fee_amount';`);

// 4) Reload PostgREST schema cache (safe, idempotent) — in case the edge fn's PostgREST client
//    has a stale schema after the raw-SQL column add. This is a NOTIFY, not a data write.
await sql("reload PostgREST schema cache (NOTIFY)", `notify pgrst, 'reload schema';`);

log("done (read-only + 1 schema-reload NOTIFY).");
