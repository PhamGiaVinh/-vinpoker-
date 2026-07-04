#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Accounting Control W3-B — payout liability — controlled-op runner (owner-gated)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY one reviewed, idempotent migration via the Supabase Management API
// (NOT the CLI push path, NO schema_migrations write):
//   20261216000000_accounting_payout_liability.sql
// Brings live: tournament_prize_payments ledger + get_club_payout_liability (read) +
// record_tournament_prize_payment (write, called only when the B2 flag ships).
//
//   node scripts/accounting/apply_payout_liability.mjs --preflight   (read-only)
//   node scripts/accounting/apply_payout_liability.mjs --apply       (gated)
//
// SAFETY: allowlist HARDCODED to that one file; safety-scanned at the TOP LEVEL (dollar-quoted
//   bodies + comments + string literals stripped) — refuses top-level DROP TABLE/SCHEMA / INSERT /
//   UPDATE…SET / DELETE, and any schema_migrations write. The migration's only INSERT lives inside
//   the write-RPC body ($$…$$) and is stripped before scanning. --apply gated by
//   CONFIRM_APPLY_PAYOUT_LIABILITY=APPLY_PAYOUT_LIABILITY. Everything is idempotent
//   (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION / DO-guarded policy / IF NOT EXISTS
//   indexes) → re-runnable. PREFLIGHT verifies prerequisites (tournament_prizes.amount,
//   tournament_entries.finished_place, tournament_close_report, club_cashiers) exist, else the
//   objects would be inert / wrong. Post-verify: table + RLS + read policy + unique index +
//   2 RPCs present, both granted to authenticated and NOT anon/public. Secrets masked.
// NOTE: the read RPC uses auth.uid() (SECURITY DEFINER) — it CANNOT be exercised from the
//   Management API (no JWT ⇒ auth.uid() NULL ⇒ 42501). The owed golden-diff (RPC vs manual Σ)
//   is the browser UAT step done by a logged-in owner; this runner verifies STRUCTURE only.
// Delete after verified.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIG = "supabase/migrations/20261216000000_accounting_payout_liability.sql";
const CONFIRM_ENV = "CONFIRM_APPLY_PAYOUT_LIABILITY";
const CONFIRM_VAL = "APPLY_PAYOUT_LIABILITY";
const RPCS = ["get_club_payout_liability", "record_tournament_prize_payment"];

const log = (...a) => console.log("[payout-liab]", ...a);
const fail = (...a) => { console.error("[payout-liab] ✗", ...a); process.exit(1); };
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

function stripBodies(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''") // dollar-quoted bodies (DO / function $$…$$)
    .replace(/\/\*[\s\S]*?\*\//g, " ")                 // block comments
    .replace(/--[^\n]*/g, " ")                          // line comments
    .replace(/'(?:''|[^'])*'/g, "''");                  // string literals
}

function scan(sql) {
  const c = stripBodies(sql);
  const v = [];
  if (/\bDROP\s+(TABLE|SCHEMA)\b/i.test(c)) v.push("top-level DROP TABLE/SCHEMA");
  if (/\bINSERT\s+INTO\b/i.test(c)) v.push("top-level INSERT INTO");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(c)) v.push("top-level UPDATE … SET");
  if (/\bDELETE\s+FROM\b/i.test(c)) v.push("top-level DELETE FROM");
  if (/\bTRUNCATE\b/i.test(c)) v.push("top-level TRUNCATE");
  if (/schema_migrations/i.test(c)) v.push("touches schema_migrations");
  // Positive assertions: it must define exactly the intended objects.
  if (!/\btournament_prize_payments\b/i.test(c)) v.push("does not define tournament_prize_payments");
  if (!/get_club_payout_liability/i.test(c)) v.push("does not define get_club_payout_liability");
  if (!/record_tournament_prize_payment/i.test(c)) v.push("does not define record_tournament_prize_payment");
  if (v.length) { console.error("[payout-liab] ✗ REFUSING:"); v.forEach((x) => console.error("    - " + x)); process.exit(1); }
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
  (to_regclass('public.tournament_prize_payments') is not null) as ledger_tbl,
  (select relrowsecurity from pg_class where oid = to_regclass('public.tournament_prize_payments')) as rls_on,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='tournament_prize_payments') as policy_count,
  (to_regclass('public.uq_prize_paid_once') is not null) as uq_index,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in (${RPCS.map((r) => `'${r}'`).join(",")})) as rpc_count,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name in (${RPCS.map((r) => `'${r}'`).join(",")})
       and grantee='authenticated') as grants_auth,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name in (${RPCS.map((r) => `'${r}'`).join(",")})
       and grantee in ('anon','public','PUBLIC')) as grants_anon,
  -- prerequisites (must exist or the migration objects are inert / wrong)
  (to_regclass('public.tournament_prizes') is not null) as prereq_prizes,
  (to_regclass('public.tournament_close_report') is not null) as prereq_close_report,
  (to_regclass('public.club_cashiers') is not null) as prereq_cashiers,
  (exists(select 1 from information_schema.columns
     where table_schema='public' and table_name='tournament_prizes' and column_name='amount')) as prereq_prize_amount,
  (exists(select 1 from information_schema.columns
     where table_schema='public' and table_name='tournament_prizes' and column_name='position')) as prereq_prize_position,
  (exists(select 1 from information_schema.columns
     where table_schema='public' and table_name='tournament_entries' and column_name='finished_place')) as prereq_finished_place;`;

async function showState(creds, label) {
  const rows = await mgmt(creds, STATE_SQL);
  const r = Array.isArray(rows) ? rows[0] : rows;
  log(`${label}:`, JSON.stringify(r));
  return r;
}

function checkPrereqs(s) {
  const missing = [];
  if (s.prereq_prizes !== true) missing.push("tournament_prizes table");
  if (s.prereq_close_report !== true) missing.push("tournament_close_report table");
  if (s.prereq_cashiers !== true) missing.push("club_cashiers table (RLS + authz depend on it)");
  if (s.prereq_prize_amount !== true) missing.push("tournament_prizes.amount column");
  if (s.prereq_prize_position !== true) missing.push("tournament_prizes.position column");
  if (s.prereq_finished_place !== true) missing.push("tournament_entries.finished_place column");
  if (missing.length) fail("prerequisites missing: " + missing.join(", "));
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
  checkPrereqs(pre);
  if (pre.ledger_tbl === true || Number(pre.rpc_count) > 0) {
    log("note: some objects already present — migration is idempotent, apply will be a no-op / refresh.");
  }
  if (mode === "preflight") { log("preflight complete (read-only)."); process.exit(0); }

  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`--apply requires ${CONFIRM_ENV}=${CONFIRM_VAL}`);

  log(`applying ${MIG} …`);
  await mgmt(creds, sql);
  log("  ✓ applied");

  const post = await showState(creds, "POST state");
  const problems = [];
  if (post.ledger_tbl !== true) problems.push("tournament_prize_payments table missing");
  if (post.rls_on !== true) problems.push("RLS not enabled on tournament_prize_payments");
  if (Number(post.policy_count) < 1) problems.push("read policy missing");
  if (post.uq_index !== true) problems.push("uq_prize_paid_once unique index missing");
  if (Number(post.rpc_count) !== RPCS.length) problems.push(`expected ${RPCS.length} RPCs, found ${post.rpc_count}`);
  if (Number(post.grants_auth) < RPCS.length) problems.push(`RPCs not fully granted to authenticated (${post.grants_auth}/${RPCS.length})`);
  if (Number(post.grants_anon) !== 0) problems.push(`RPCs granted to anon/public (${post.grants_anon})`);
  if (problems.length) { console.error("[payout-liab] ✗ POST-VERIFY FAILED:"); problems.forEach((x) => console.error("    - " + x)); process.exit(1); }
  log("✓ APPLY + VERIFY all green. Going LIVE also needs: flip FEATURES.accountingControlLivePayout");
  log("  (owner-gated) + browser UAT owed golden-diff. types.ts regen is optional (hook uses `as any`).");
}

main();
