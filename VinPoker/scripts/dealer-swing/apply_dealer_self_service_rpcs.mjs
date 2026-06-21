#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// dealer self-service RPCs — controlled-op runner (owner-gated apply)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY one reviewed, idempotent migration via the Supabase Management API
// (NOT the CLI push path, NO schema_migrations write):
//   20260906000000_dealer_self_service_rpcs.sql
// Brings the dealer self-service RPCs live: dealer_confirm_shift / dealer_check_in /
// dealer_check_out / dealer_submit_availability / dealer_request_leave_or_swap (+ 2 guards).
// Required for the dealer app "Đăng ký lịch làm việc" feature to work LIVE.
//
//   node scripts/dealer-swing/apply_dealer_self_service_rpcs.mjs --preflight   (read-only)
//   node scripts/dealer-swing/apply_dealer_self_service_rpcs.mjs --apply       (gated)
//
// SAFETY: allowlist HARDCODED to that one file; safety-scanned at the TOP LEVEL (dollar-quoted
//   bodies + comments stripped) — refuses top-level DROP/INSERT/UPDATE/DELETE, schema_migrations,
//   calculate_dealer_payroll. --apply gated by CONFIRM_APPLY_DEALER_SS=APPLY_DEALER_SELF_SERVICE.
//   Idempotent (CREATE OR REPLACE). PREFLIGHT verifies the prerequisite planner tables exist
//   (the RPCs are no-ops without them). Post-verify: 5 RPCs present + dealer_submit_availability
//   = authenticated-only (no anon). Secrets masked.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIG = "supabase/migrations/20260906000000_dealer_self_service_rpcs.sql";
const CONFIRM_ENV = "CONFIRM_APPLY_DEALER_SS";
const CONFIRM_VAL = "APPLY_DEALER_SELF_SERVICE";
const RPCS = ["dealer_confirm_shift", "dealer_check_in", "dealer_check_out", "dealer_submit_availability", "dealer_request_leave_or_swap"];

const log = (...a) => console.log("[dealer-ss]", ...a);
const fail = (...a) => { console.error("[dealer-ss] ✗", ...a); process.exit(1); };
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

function stripBodies(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function scan(sql) {
  const c = stripBodies(sql);
  const v = [];
  if (/\bDROP\s+(TABLE|SCHEMA)\b/i.test(c)) v.push("top-level DROP TABLE/SCHEMA");
  if (/\bINSERT\s+INTO\b/i.test(c)) v.push("top-level INSERT INTO");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(c)) v.push("top-level UPDATE … SET");
  if (/\bDELETE\s+FROM\b/i.test(c)) v.push("top-level DELETE FROM");
  if (/schema_migrations/i.test(c)) v.push("touches schema_migrations");
  if (/\bcalculate_dealer_payroll\b/i.test(c)) v.push("references calculate_dealer_payroll");
  if (!/dealer_submit_availability/i.test(c)) v.push("does not define dealer_submit_availability");
  if (v.length) { console.error("[dealer-ss] ✗ REFUSING:"); v.forEach((x) => console.error("    - " + x)); process.exit(1); }
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

const STATE_SQL = `select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in (${RPCS.map((r) => `'${r}'`).join(",")})) as rpc_count,
  (select to_regclass('public.dealer_availability_requests') is not null) as avail_tbl,
  (select to_regclass('public.dealer_shift_assignments') is not null) as assign_tbl,
  (select to_regclass('public.dealer_shift_templates') is not null) as templates_tbl,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name='dealer_submit_availability' and grantee='authenticated') as submit_auth,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name='dealer_submit_availability' and grantee in ('anon','public')) as submit_anon;`;

async function showState(creds, label) {
  const rows = await mgmt(creds, STATE_SQL);
  const r = Array.isArray(rows) ? rows[0] : rows;
  log(`${label}:`, JSON.stringify(r));
  return r;
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : "preflight";
  let sql; try { sql = readFileSync(resolve(REPO_ROOT, MIG), "utf8"); } catch { fail(`migration not found: ${MIG}`); }
  scan(sql);
  log("safety scan PASSED.");

  const creds = process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_ACCESS_TOKEN
    ? { ref: process.env.SUPABASE_PROJECT_REF, token: process.env.SUPABASE_ACCESS_TOKEN } : null;
  if (!creds) { log("no creds in env — scan-only."); process.exit(0); }

  const pre = await showState(creds, "PRE state");
  // Prerequisite tables (Phase 2A / 20260827000000) must exist or the RPCs are inert.
  if (pre.avail_tbl !== true || pre.assign_tbl !== true) {
    fail("prerequisite planner tables missing (dealer_availability_requests / dealer_shift_assignments). Apply 20260827000000 first.");
  }
  if (mode === "preflight") { log("preflight complete (read-only)."); process.exit(0); }

  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`--apply requires ${CONFIRM_ENV}=${CONFIRM_VAL}`);

  log(`applying ${MIG} …`);
  await mgmt(creds, sql);
  log("  ✓ applied");

  const post = await showState(creds, "POST state");
  const problems = [];
  if (Number(post.rpc_count) !== RPCS.length) problems.push(`expected ${RPCS.length} RPCs, found ${post.rpc_count}`);
  if (Number(post.submit_auth) < 1) problems.push("dealer_submit_availability not granted to authenticated");
  if (Number(post.submit_anon) !== 0) problems.push(`dealer_submit_availability granted to anon/public (${post.submit_anon})`);
  if (problems.length) { console.error("[dealer-ss] ✗ POST-VERIFY FAILED:"); problems.forEach((x) => console.error("    - " + x)); process.exit(1); }
  log("✓ APPLY + VERIFY all green. (Going LIVE also needs: dealer SELECT on dealer_shift_templates + flip FEATURES.dealerMobileApp — owner/security-review gated.)");
}

main();
