#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Accounting Control W3-B2 — payout recipients READ RPC — controlled-op runner (owner-gated)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY one reviewed, idempotent migration via the Supabase Management API
// (NOT the CLI push path, NO schema_migrations write):
//   20261217000000_get_tournament_payout_recipients.sql
// Brings live the SECDEF read RPC get_tournament_payout_recipients(p_tournament_id) that feeds the
// cashier "Đã trả thưởng" (B2) list. Read-only function; the write RPC + ledger are already live.
//
//   node scripts/accounting/apply_payout_recipients.mjs --preflight   (read-only)
//   node scripts/accounting/apply_payout_recipients.mjs --apply       (gated)
//
// SAFETY: allowlist HARDCODED to that one file; top-level safety scan (strips $$ bodies + comments +
//   string literals) refuses any top-level destructive verb or schema_migrations write. The function
//   is CREATE OR REPLACE (idempotent). PREFLIGHT verifies prerequisites (tournament_prize_payments
//   ledger from 20261216000000, tournament_prizes, tournament_entries.finished_place, club_members,
//   club_cashiers) exist. --apply gated by CONFIRM_APPLY_PAYOUT_RECIPIENTS=APPLY_PAYOUT_RECIPIENTS.
//   Post-verify: 1 RPC present, granted to authenticated and NOT anon/public. Secrets masked.
// Delete after verified.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIG = "supabase/migrations/20261217000000_get_tournament_payout_recipients.sql";
const CONFIRM_ENV = "CONFIRM_APPLY_PAYOUT_RECIPIENTS";
const CONFIRM_VAL = "APPLY_PAYOUT_RECIPIENTS";
const RPC = "get_tournament_payout_recipients";

const log = (...a) => console.log("[payout-recip]", ...a);
const fail = (...a) => { console.error("[payout-recip] ✗", ...a); process.exit(1); };
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
  if (/\bTRUNCATE\b/i.test(c)) v.push("top-level TRUNCATE");
  if (/schema_migrations/i.test(c)) v.push("touches schema_migrations");
  if (!/get_tournament_payout_recipients/i.test(c)) v.push("does not define get_tournament_payout_recipients");
  if (v.length) { console.error("[payout-recip] ✗ REFUSING:"); v.forEach((x) => console.error("    - " + x)); process.exit(1); }
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
     where n.nspname='public' and p.proname='${RPC}') as rpc_count,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name='${RPC}' and grantee='authenticated') as grants_auth,
  (select count(*) from information_schema.role_routine_grants
     where routine_schema='public' and routine_name='${RPC}' and grantee in ('anon','public','PUBLIC')) as grants_anon,
  (to_regclass('public.tournament_prize_payments') is not null) as prereq_ledger,
  (to_regclass('public.tournament_prizes') is not null) as prereq_prizes,
  (to_regclass('public.club_members') is not null) as prereq_members,
  (to_regclass('public.club_cashiers') is not null) as prereq_cashiers,
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
  if (s.prereq_ledger !== true) missing.push("tournament_prize_payments ledger (apply 20261216000000 first)");
  if (s.prereq_prizes !== true) missing.push("tournament_prizes table");
  if (s.prereq_members !== true) missing.push("club_members table");
  if (s.prereq_cashiers !== true) missing.push("club_cashiers table");
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
  if (Number(pre.rpc_count) > 0) log("note: RPC already present — CREATE OR REPLACE, apply refreshes it.");
  if (mode === "preflight") { log("preflight complete (read-only)."); process.exit(0); }

  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`--apply requires ${CONFIRM_ENV}=${CONFIRM_VAL}`);

  log(`applying ${MIG} …`);
  await mgmt(creds, sql);
  log("  ✓ applied");

  const post = await showState(creds, "POST state");
  const problems = [];
  if (Number(post.rpc_count) !== 1) problems.push(`expected 1 RPC, found ${post.rpc_count}`);
  if (Number(post.grants_auth) < 1) problems.push("RPC not granted to authenticated");
  if (Number(post.grants_anon) !== 0) problems.push(`RPC granted to anon/public (${post.grants_anon})`);
  if (problems.length) { console.error("[payout-recip] ✗ POST-VERIFY FAILED:"); problems.forEach((x) => console.error("    - " + x)); process.exit(1); }
  log("✓ APPLY + VERIFY all green. Going LIVE also needs: flip FEATURES.prizePayoutTracking (owner-gated).");
}

main();
