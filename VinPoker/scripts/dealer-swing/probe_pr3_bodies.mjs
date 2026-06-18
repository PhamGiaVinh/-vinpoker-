#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// probe_pr3_bodies.mjs — READ-ONLY Phase-0 probe for Dealer Swing PR3.
//
// Dumps the LIVE definitions of the functions PR3 may touch (migrations have
// drifted; perform_swing is a 26-overload "bomb" — the live body is the only
// trustworthy source) plus the pool-bridge gating flag and a future-anchor check.
//
// PURE READ-ONLY: pg_get_functiondef / SELECT only. NO writes, NO db push,
// NO deploy_db, NO schema_migrations touch. Token comes from the GitHub Secret
// (SUPABASE_ACCESS_TOKEN); never printed (masked). Missing creds → exit 0.
// ════════════════════════════════════════════════════════════════════════════
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
const log = (...a) => console.log("[pr3-probe]", ...a);
const fail = (...a) => { console.error("[pr3-probe] ✗", ...a); process.exit(1); };

function assertReadOnly(sql) {
  const s = sql.replace(/\$[a-z]*\$[\s\S]*?\$[a-z]*\$/gi, "''").replace(/--[^\n]*/g, " ").replace(/'(?:''|[^'])*'/g, "''");
  if (!/^\s*(with|select)\b/i.test(s)) fail("non-read-only query blocked");
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|merge)\b/i.test(s)) fail("write keyword blocked");
}
async function q(sql) {
  assertReadOnly(sql);
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) fail(`Management API ${r.status}: ${mask(t).slice(0, 400)}`);
  return JSON.parse(t);
}

if (!ref || !token) { log("no credentials — set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN. Nothing contacted."); process.exit(0); }

const FUNCS = ["perform_swing", "execute_pre_assigned_swing", "bridge_shift_checkins_to_pool", "end_expired_breaks", "_dealer_record_checkin", "_enter_dealer_pool"];

(async () => {
  // 1) Signatures (ALL overloads) for the target functions
  log("════════ 1) LIVE signatures (all overloads) ════════");
  const sigs = await q(`
    select p.proname, p.oid::int as oid, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (${FUNCS.map((f) => `'${f}'`).join(",")})
    order by p.proname, p.oid;`);
  console.log(JSON.stringify(sigs, null, 1));
  log(`perform_swing overload count: ${sigs.filter((s) => s.proname === "perform_swing").length}`);
  log("NOTE: process-swing caller passes named args {p_assignment_id, p_duration_minutes, p_send_to_break, p_break_duration_minutes, p_expected_version, p_next_attendance_id} — the resolved overload is the one whose params match those names.");

  // 2) Full bodies (the only trustworthy source for authoring)
  for (const fn of FUNCS) {
    const rows = sigs.filter((s) => s.proname === fn);
    if (rows.length === 0) { log(`──── ${fn}: NOT FOUND on live ────`); continue; }
    for (const r of rows) {
      log(`──── ${fn}(${r.args})  [oid ${r.oid}] ────`);
      const def = await q(`select pg_get_functiondef(${r.oid}::oid) as def;`);
      console.log(def[0].def);
    }
  }

  // 3) Pool-bridge gating flag — is the bridge path even ACTIVE?
  log("════════ 3) pool-bridge gating flag ════════");
  try {
    const flag = await q(`select club_id, table_type,
      (to_jsonb(sc.*) ? 'dealer_self_checkin_scheduled_pool') as has_flag_col,
      (to_jsonb(sc.*)->>'dealer_self_checkin_scheduled_pool') as flag_value
      from swing_config sc order by club_id limit 20;`);
    console.log(JSON.stringify(flag, null, 1));
  } catch (e) { log("flag read note:", mask(String(e.message))); }

  // 4) Is pool_entered_at ever FUTURE on live right now? (PR3-B premise)
  log("════════ 4) future pool_entered_at check (PR3-B premise) ════════");
  const fut = await q(`select count(*) as future_rows,
    max(pool_entered_at) as max_pool_entered, now() as now_ts
    from dealer_attendance where pool_entered_at > now();`);
  console.log(JSON.stringify(fut, null, 1));

  // 5) Where does pool_entered_at get set? (string-scan the live bodies for the expression)
  log("════════ 5) pool_entered_at assignment expressions in live bodies ════════");
  const scan = await q(`
    select p.proname,
      position('pool_entered_at' in pg_get_functiondef(p.oid)) > 0 as sets_pool_entered,
      position('GREATEST(' in pg_get_functiondef(p.oid)) > 0 as uses_greatest,
      position('check_in_time' in pg_get_functiondef(p.oid)) > 0 as touches_check_in_time
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (${FUNCS.map((f) => `'${f}'`).join(",")})
    order by p.proname;`);
  console.log(JSON.stringify(scan, null, 1));

  log("════════ DONE (read-only). No DB writes. ════════");
  log("Decision inputs: (a) perform_swing overload count + caller-resolved sig; (b) bridge flag value → PR3-B needed only if ON; (c) future_rows>0 → PR3-B premise confirmed; (d) which fns touch check_in_time (do NOT alter those expressions — payroll).");
})().catch((e) => fail(mask(e?.message ?? String(e))));
