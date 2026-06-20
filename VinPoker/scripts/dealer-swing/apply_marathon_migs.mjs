#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Dealer-Swing marathon — controlled-op runner (owner-gated apply)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY the four reviewed, idempotent dealer-swing migrations via the
// Supabase Management API (NOT `supabase db push`, NO schema_migrations write):
//   20261007000000_lock_legacy_grant_hardening.sql   (Hardening B — REVOKE legacy lock funcs)
//   20261008000000_get_dealer_swing_health.sql       (C2 — read RPC)
//   20261009000000_edge_idempotency_keys.sql         (B1.1 — table + idem_begin/idem_complete)
//   20261010000000_swing_run_metrics.sql             (C3 — telemetry table)
//
//   node scripts/dealer-swing/apply_marathon_migs.mjs --preflight   (read-only)
//   node scripts/dealer-swing/apply_marathon_migs.mjs --apply       (gated)
//
// SAFETY (hard):
//   • Allowlist HARDCODED to those four files; nothing else can run.
//   • Each file safety-scanned (top-level, dollar-quoted bodies stripped): REFUSES top-level
//     DROP / INSERT / UPDATE…SET / DELETE FROM, schema_migrations writes, check_in_time,
//     calculate_dealer_payroll, and any `supabase db push` / deploy_db marker.
//   • --apply requires CONFIRM_APPLY_MARATHON=APPLY_DEALER_SWING_MARATHON.
//   • All four migrations are idempotent (CREATE TABLE/FUNCTION IF NOT EXISTS / OR REPLACE /
//     DO-loop REVOKE), so a re-run is safe.
//   • Post-verify asserts: all objects present; new fenced/idem/health funcs NOT anon-executable;
//     get_dealer_swing_health granted to authenticated; legacy lock funcs NO LONGER anon/authenticated
//     (Hardening B). Functional smoke runs idem_begin/idem_complete + get_dealer_swing_health inside
//     a tx that is ROLLED BACK (zero persisted rows).
//   • Secrets masked in all output. No creds → prints env names, exits 0.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // scripts/dealer-swing → VinPoker root

const MIGS = [
  "supabase/migrations/20261007000000_lock_legacy_grant_hardening.sql",
  "supabase/migrations/20261008000000_get_dealer_swing_health.sql",
  "supabase/migrations/20261009000000_edge_idempotency_keys.sql",
  "supabase/migrations/20261010000000_swing_run_metrics.sql",
];
const CONFIRM_ENV = "CONFIRM_APPLY_MARATHON";
const CONFIRM_VAL = "APPLY_DEALER_SWING_MARATHON";

const log = (...a) => console.log("[ds-marathon]", ...a);
const fail = (...a) => { console.error("[ds-marathon] ✗", ...a); process.exit(1); };

function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
}

// Strip dollar-quoted bodies, block/line comments, and string literals → leaves only top-level SQL.
function stripBodies(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function scan(path, sql) {
  const c = stripBodies(sql);
  const v = [];
  if (/\bDROP\s+(TABLE|FUNCTION|COLUMN|SCHEMA)\b/i.test(c)) v.push("top-level DROP");
  if (/\bINSERT\s+INTO\b/i.test(c)) v.push("top-level INSERT INTO");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(c)) v.push("top-level UPDATE … SET");
  if (/\bDELETE\s+FROM\b/i.test(c)) v.push("top-level DELETE FROM");
  if (/schema_migrations/i.test(c)) v.push("touches schema_migrations");
  if (/\bcheck_in_time\b/i.test(c)) v.push("touches check_in_time");
  if (/\bcalculate_dealer_payroll\b/i.test(c)) v.push("references calculate_dealer_payroll");
  if (/db\s+push|deploy_db/i.test(c)) v.push("contains a db push / deploy_db marker");
  if (v.length) { console.error(`[ds-marathon] ✗ REFUSING ${path}:`); v.forEach((x) => console.error("    - " + x)); process.exit(1); }
  return sql;
}

function loadCreds() {
  const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
  return ref && token ? { ref, token } : null;
}

async function mgmt(creds, query) {
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

const STATE_SQL = `
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_dealer_swing_health') as health_fn,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='idem_begin') as idem_begin_fn,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='idem_complete') as idem_complete_fn,
  (select to_regclass('public.edge_idempotency_keys') is not null) as idem_table,
  (select to_regclass('public.swing_run_metrics') is not null) as metrics_table,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public'
       and routine_name in ('try_acquire_club_lock','release_club_lock','cleanup_expired_club_locks')
       and grantee in ('anon','authenticated')) as legacy_anon_auth_grants,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public'
       and routine_name in ('get_dealer_swing_health','idem_begin','idem_complete')
       and grantee='anon') as new_anon_grants,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name='get_dealer_swing_health' and grantee='authenticated') as health_authenticated;
`;

async function showState(creds, label) {
  const rows = await mgmt(creds, STATE_SQL);
  const r = Array.isArray(rows) ? rows[0] : rows;
  log(`${label}:`, JSON.stringify(r));
  return r;
}

async function smoke(creds) {
  // idem roundtrip + health call, all inside a tx that is rolled back → nothing persists.
  const q = `begin;
    select public.idem_begin('__ds_smoke__','smoke',null,null,'fp',60) as b1;
    select public.idem_complete('__ds_smoke__','{"smoke":true}'::jsonb) as c1;
    select public.idem_begin('__ds_smoke__','smoke',null,null,'fp',60) as b2;
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
    select public.get_dealer_swing_health(array[]::uuid[]) as health;
    rollback;`;
  const rows = await mgmt(creds, q);
  log("functional smoke (rolled back):", JSON.stringify(rows));
  return rows;
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : "preflight";

  // Load + safety-scan all four (works even without creds).
  const sqls = MIGS.map((p) => {
    let sql; try { sql = readFileSync(resolve(REPO_ROOT, p), "utf8"); } catch { fail(`migration not found: ${p}`); }
    return scan(p, sql);
  });
  log(`safety scan PASSED for ${MIGS.length} migrations.`);

  const creds = loadCreds();
  if (!creds) {
    log("no SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN in env — scan-only. Set them in CI to run.");
    process.exit(0);
  }

  await showState(creds, "PRE state");

  if (mode === "preflight") {
    log("preflight complete (read-only). Re-run with --apply + the confirm env to apply.");
    process.exit(0);
  }

  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) {
    fail(`--apply requires ${CONFIRM_ENV}=${CONFIRM_VAL}`);
  }

  for (let i = 0; i < MIGS.length; i++) {
    log(`applying ${MIGS[i]} …`);
    await mgmt(creds, sqls[i]);
    log(`  ✓ applied ${MIGS[i]}`);
  }

  const post = await showState(creds, "POST state");
  const problems = [];
  if (Number(post.health_fn) !== 1) problems.push("get_dealer_swing_health missing");
  if (Number(post.idem_begin_fn) !== 1) problems.push("idem_begin missing");
  if (Number(post.idem_complete_fn) !== 1) problems.push("idem_complete missing");
  if (post.idem_table !== true) problems.push("edge_idempotency_keys missing");
  if (post.metrics_table !== true) problems.push("swing_run_metrics missing");
  if (Number(post.legacy_anon_auth_grants) !== 0) problems.push(`legacy lock funcs still anon/authenticated (${post.legacy_anon_auth_grants})`);
  if (Number(post.new_anon_grants) !== 0) problems.push(`new funcs anon-executable (${post.new_anon_grants})`);
  if (Number(post.health_authenticated) !== 1) problems.push("get_dealer_swing_health not granted to authenticated");
  if (problems.length) { console.error("[ds-marathon] ✗ POST-VERIFY FAILED:"); problems.forEach((x) => console.error("    - " + x)); process.exit(1); }

  await smoke(creds);
  log("✓ APPLY + VERIFY + SMOKE all green. Remember: regen types.ts separately (read-only).");
}

main();
