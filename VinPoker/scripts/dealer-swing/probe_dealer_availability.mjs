#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// READ-ONLY probe — why doesn't the floor see a dealer's "xin ca" request?
// ════════════════════════════════════════════════════════════════════════════
// Runs ONLY SELECTs via the Supabase Management API. NO writes, NO schema change,
// NO confirm gate. Dumps the live data needed to pinpoint the floor-shows-0 bug:
//   1. latest dealer_availability_requests (dealer_id / club_id / work_date / kind / status)
//   2. the dealer(s) matching "pgv" (id / club_id / user_id) — does club_id match the floor?
//   3. clubs whose id starts 22222222 (id / owner_id) — does the floor account own/control it?
//
//   node scripts/dealer-swing/probe_dealer_availability.mjs
//
// SAFETY: hardcoded SELECT-only queries (a guard rejects any non-SELECT). Secrets masked.
// ════════════════════════════════════════════════════════════════════════════

const log = (...a) => console.log("[ds-probe]", ...a);
const fail = (...a) => { console.error("[ds-probe] ✗", ...a); process.exit(1); };
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

const QUERIES = {
  latest_requests: `
    select dealer_id::text, club_id::text, work_date::text, kind, template_id::text, status, created_at::text
    from public.dealer_availability_requests
    order by created_at desc limit 10;`,
  dealer_pgv: `
    select id::text, club_id::text, user_id::text, full_name, telegram_username, status
    from public.dealers
    where full_name ilike '%pgv%' or telegram_username ilike '%pgv%'
    limit 5;`,
  club_22222222: `
    select id::text, name, owner_id::text
    from public.clubs
    where id::text ilike '22222222%'
    limit 3;`,
};

async function mgmt(creds, query) {
  if (!/^\s*select\b/i.test(query) || /;\s*\S/.test(query.trim().replace(/;\s*$/, ""))) {
    fail("refusing non-SELECT / multi-statement query");
  }
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${creds.ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (e) { fail("network error:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

async function main() {
  const creds = process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_ACCESS_TOKEN
    ? { ref: process.env.SUPABASE_PROJECT_REF, token: process.env.SUPABASE_ACCESS_TOKEN } : null;
  if (!creds) { log("no SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN — dry (queries below are SELECT-only):"); log(JSON.stringify(QUERIES, null, 2)); process.exit(0); }

  for (const [name, q] of Object.entries(QUERIES)) {
    const rows = await mgmt(creds, q);
    log(`── ${name} ──`);
    console.log(JSON.stringify(rows, null, 2));
  }
  log("done (read-only).");
}

main();
