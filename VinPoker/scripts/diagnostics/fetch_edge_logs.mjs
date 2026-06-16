#!/usr/bin/env node
// Read-only diagnosis of the tournament-register 500: inspect tournament_registrations schema
// (NOT-NULL-without-default columns the insert may omit) + triggers that could throw. SELECT only.
const log = (...a) => console.log("[reg-500]", ...a);
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
  } catch (e) { log(`${label}: network ${mask(e.message)}`); return; }
  const text = await res.text();
  if (!res.ok) { log(`${label}: HTTP ${res.status} ${mask(text).slice(0, 500)}`); return; }
  log(`── ${label} ──`); console.log(mask(text).slice(0, 5000));
}

// The edge fn inserts ONLY these columns:
//   tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, used_free_rake
// 1) Any NOT NULL column without a default that the insert does NOT provide → guaranteed 500.
await sql("NOT-NULL cols w/o default NOT in the insert", `
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='tournament_registrations'
  and is_nullable='NO' and column_default is null
  and column_name not in ('tournament_id','player_id','club_id','buy_in','platform_fixed_fee','total_pay','reference_code','status','used_free_rake','id')
order by ordinal_position;`);

// 2) All columns (for context: defaults + nullability).
await sql("all columns (nullable/default)", `
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='tournament_registrations'
order by ordinal_position;`);

// 3) Triggers that fire on INSERT (a failing trigger throws → 500).
await sql("triggers on tournament_registrations", `
select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as def
from pg_trigger t
where t.tgrelid = 'public.tournament_registrations'::regclass and not t.tgisinternal
order by t.tgname;`);

log("done (read-only).");
