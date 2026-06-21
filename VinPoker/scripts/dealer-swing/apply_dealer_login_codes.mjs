#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// dealer_login_codes — controlled-op runner (owner-gated apply)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY one reviewed, idempotent migration via the Supabase Management API
// (NOT the CLI push path, NO schema_migrations write):
//   20261013000000_dealer_login_codes.sql   (one-time dealer-app login codes table; /code feature)
//
//   node scripts/dealer-swing/apply_dealer_login_codes.mjs --preflight   (read-only)
//   node scripts/dealer-swing/apply_dealer_login_codes.mjs --apply       (gated)
//
// SAFETY: allowlist HARDCODED to that one file; safety-scanned (refuses top-level DROP/INSERT/
//   UPDATE/DELETE, schema_migrations, check_in_time, calculate_dealer_payroll); --apply gated by
//   CONFIRM_APPLY_DEALER_CODES=APPLY_DEALER_LOGIN_CODES. Idempotent (CREATE TABLE IF NOT EXISTS).
//   Post-verify: table present + service_role-only (no anon/authenticated grant). Secrets masked.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIG = "supabase/migrations/20261013000000_dealer_login_codes.sql";
const CONFIRM_ENV = "CONFIRM_APPLY_DEALER_CODES";
const CONFIRM_VAL = "APPLY_DEALER_LOGIN_CODES";

const log = (...a) => console.log("[dealer-codes]", ...a);
const fail = (...a) => { console.error("[dealer-codes] ✗", ...a); process.exit(1); };
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
  if (/\bDROP\s+(TABLE|FUNCTION|COLUMN|SCHEMA)\b/i.test(c)) v.push("top-level DROP");
  if (/\bINSERT\s+INTO\b/i.test(c)) v.push("top-level INSERT INTO");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(c)) v.push("top-level UPDATE … SET");
  if (/\bDELETE\s+FROM\b/i.test(c)) v.push("top-level DELETE FROM");
  if (/schema_migrations/i.test(c)) v.push("touches schema_migrations");
  if (/\bcheck_in_time\b/i.test(c)) v.push("touches check_in_time");
  if (/\bcalculate_dealer_payroll\b/i.test(c)) v.push("references calculate_dealer_payroll");
  if (!/dealer_login_codes/i.test(c)) v.push("does not reference dealer_login_codes");
  if (v.length) { console.error("[dealer-codes] ✗ REFUSING:"); v.forEach((x) => console.error("    - " + x)); process.exit(1); }
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
  (select to_regclass('public.dealer_login_codes') is not null) as tbl,
  (select count(*) from information_schema.role_table_grants
     where table_schema='public' and table_name='dealer_login_codes' and grantee in ('anon','authenticated')) as anon_auth_grants,
  (select count(*) from information_schema.role_table_grants
     where table_schema='public' and table_name='dealer_login_codes' and grantee='service_role') as service_grants;`;

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

  await showState(creds, "PRE state");
  if (mode === "preflight") { log("preflight complete (read-only)."); process.exit(0); }

  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`--apply requires ${CONFIRM_ENV}=${CONFIRM_VAL}`);

  log(`applying ${MIG} …`);
  await mgmt(creds, sql);
  log(`  ✓ applied`);

  const post = await showState(creds, "POST state");
  const problems = [];
  if (post.tbl !== true) problems.push("dealer_login_codes table missing");
  if (Number(post.anon_auth_grants) !== 0) problems.push(`table grants anon/authenticated (${post.anon_auth_grants})`);
  if (Number(post.service_grants) < 1) problems.push("service_role grant missing");
  if (problems.length) { console.error("[dealer-codes] ✗ POST-VERIFY FAILED:"); problems.forEach((x) => console.error("    - " + x)); process.exit(1); }
  log("✓ APPLY + VERIFY all green.");
}

main();
