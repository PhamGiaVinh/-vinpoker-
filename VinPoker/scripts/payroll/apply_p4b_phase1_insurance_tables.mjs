#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Payroll P4b Phase 1 — allowlisted controlled-op runner (PREP-ONLY)
// ════════════════════════════════════════════════════════════════════════════
// Encodes the reviewed preflight → dry-run → apply → post-verify steps for the
// ONE allowlisted migration, so a future owner-gated apply is safe and repeatable.
//
//   node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --preflight
//   node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --dry-run
//   node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --apply        (gated)
//   node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --post-verify
//
// SAFETY (hard):
//   • Allowlist is HARDCODED to exactly one migration; no other file can be run.
//   • The migration is safety-scanned every run: refuses payroll-fn / DML / seed /
//     CREATE FUNCTION / ALTER on non-P4b tables / DROP TABLE (outside rollback).
//   • NO credentials in this file. If creds are absent the script prints the env
//     names it needs and exits 0 — it never contacts a database.
//   • --apply requires CONFIRM_APPLY_P4B_PHASE1=APPLY_P4B_PHASE1_INSURANCE_TABLES.
//   • Never writes supabase_migrations.schema_migrations. Never seeds data. Never
//     runs `supabase db push` / deploy. Never touches calculate_dealer_payroll.
//   • Tokens / connection strings are masked in all output.
//
// Transport: Supabase Management SQL API (POST /v1/projects/{ref}/database/query).
//   `\i file.sql` is NOT available there (that is psql only) — so the runner reads
//   the migration file and wraps its CONTENT in BEGIN; … COMMIT/ROLLBACK;.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // scripts/payroll → VinPoker root

const ALLOWLISTED_MIGRATION = "supabase/migrations/20260910000000_payroll_p4b_insurance_layer_phase1.sql";
const MIGRATION_VERSION = "20260910000000";
const P4B_TABLES = ["insurance_policy_rates", "dealer_insurance_profiles"];
const EXPECTED = { tables: 2, policies: 5, triggers: 2 };
const APPLY_CONFIRM_ENV = "CONFIRM_APPLY_P4B_PHASE1";
const APPLY_CONFIRM_VALUE = "APPLY_P4B_PHASE1_INSURANCE_TABLES";
const PAYROLL_FN = "public.calculate_dealer_payroll(uuid,date,date,integer)";

const log = (...a) => console.log("[p4b-phase1]", ...a);
const fail = (...a) => { console.error("[p4b-phase1] ✗", ...a); process.exit(1); };

// ── secret masking ─────────────────────────────────────────────────────────
function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****")
    .replace(/(SUPABASE_(?:ACCESS_TOKEN|SERVICE_ROLE_KEY|DB_URL|ANON_KEY)\s*=\s*)\S+/gi, "$1****");
}

// ── strip comments + string/dollar literals so the safety scan sees CODE only ─
function stripCommentsAndStrings(sql) {
  let s = sql;
  s = s.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''"); // dollar-quoted blocks
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");                 // /* block */
  s = s.replace(/--[^\n]*/g, " ");                          // -- line
  s = s.replace(/'(?:''|[^'])*'/g, "''");                   // 'string literals'
  return s;
}

// ── hard safety scan (additive-DDL-only) ─────────────────────────────────────
function safetyScan(sql, { rollbackMode = false } = {}) {
  const clean = stripCommentsAndStrings(sql);
  const v = [];
  if (/\bcalculate_dealer_payroll\b/i.test(clean)) v.push("references calculate_dealer_payroll (code, not a comment)");
  if (/\bINSERT\s+INTO\b/i.test(clean)) v.push("contains INSERT INTO (seed/DML not allowed in Phase 1)");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(clean)) v.push("contains an UPDATE … SET statement");
  if (/\bDELETE\s+FROM\b/i.test(clean)) v.push("contains a DELETE FROM statement");
  if (/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(clean)) v.push("creates/replaces a FUNCTION");
  for (const m of clean.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
    if (!P4B_TABLES.includes(m[1].toLowerCase())) v.push(`ALTER TABLE on non-P4b table: ${m[1]}`);
  }
  if (!rollbackMode && /\bDROP\s+TABLE\b/i.test(clean)) v.push("contains DROP TABLE outside rollback mode");
  return v;
}

function loadMigration() {
  const path = resolve(REPO_ROOT, ALLOWLISTED_MIGRATION);
  let sql;
  try { sql = readFileSync(path, "utf8"); }
  catch { fail(`allowlisted migration not found: ${ALLOWLISTED_MIGRATION}`); }
  return { path, sql };
}

function loadCreds() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  return ref && token ? { ref, token } : null;
}

async function mgmtQuery(creds, query) {
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${creds.ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (e) { fail("network error contacting Management API:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

const PREFLIGHT_SQL = `
select
  (select max(version) from supabase_migrations.schema_migrations) as schema_migrations_max,
  (select count(*) from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}') as slot_registered,
  (select count(*) from pg_tables where schemaname='public' and tablename in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}')) as p4b_tables_live,
  md5(pg_get_functiondef('${PAYROLL_FN}'::regprocedure)) as payroll_fn_md5;
`;

async function preflight(creds) {
  const r = (await mgmtQuery(creds, PREFLIGHT_SQL))[0];
  log("preflight:");
  log(`  schema_migrations max     : ${r.schema_migrations_max}`);
  log(`  slot ${MIGRATION_VERSION} registered : ${r.slot_registered} (expect 0)`);
  log(`  P4b tables live           : ${r.p4b_tables_live} (expect 0 before apply)`);
  log(`  calculate_dealer_payroll md5: ${r.payroll_fn_md5}  (capture this; must NOT change)`);
  if (Number(r.slot_registered) !== 0) log("  ⚠ slot already registered — investigate before apply.");
  if (Number(r.p4b_tables_live) !== 0) log("  ⚠ P4b tables already present — apply would be a no-op (IF NOT EXISTS).");
  log("preflight done (read-only).");
  return r;
}

async function dryRun(creds, sql) {
  const probe = `select
    (select count(*) from pg_tables where schemaname='public' and tablename in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}')) as tables_created,
    (select count(*) from pg_policies where schemaname='public' and tablename in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}')) as policies_created,
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}') and not t.tgisinternal) as triggers_created;`;
  const r = (await mgmtQuery(creds, `BEGIN;\n${sql}\n${probe}\nROLLBACK;`))[0];
  log("dry-run (BEGIN … migration … ROLLBACK — nothing persisted):");
  log(`  tables_created   : ${r.tables_created} (expect ${EXPECTED.tables})`);
  log(`  policies_created : ${r.policies_created} (expect ${EXPECTED.policies})`);
  log(`  triggers_created : ${r.triggers_created} (expect ${EXPECTED.triggers})`);
  // confirm nothing persisted
  const after = (await mgmtQuery(creds, `select count(*) c from pg_tables where schemaname='public' and tablename in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}')`))[0];
  log(`  persisted after rollback : ${after.c} (expect 0)`);
  if (Number(r.tables_created) !== EXPECTED.tables || Number(after.c) !== 0)
    fail("dry-run did not match expectations.");
  log("dry-run PASS.");
}

async function apply(creds, sql) {
  if (process.env[APPLY_CONFIRM_ENV] !== APPLY_CONFIRM_VALUE)
    fail(`APPLY blocked. To confirm set:  ${APPLY_CONFIRM_ENV}=${APPLY_CONFIRM_VALUE}`);
  // gate: must still be safe to apply
  const pre = (await mgmtQuery(creds, PREFLIGHT_SQL))[0];
  if (Number(pre.slot_registered) !== 0) fail(`slot ${MIGRATION_VERSION} already in schema_migrations — refusing.`);
  log(`applying ${ALLOWLISTED_MIGRATION} (BEGIN … COMMIT; schema_migrations NOT touched) …`);
  await mgmtQuery(creds, `BEGIN;\n${sql}\nCOMMIT;`);
  log("applied. running post-verify …");
  await postVerify(creds, pre.payroll_fn_md5);
}

async function postVerify(creds, expectedMd5) {
  const want = expectedMd5 || process.env.EXPECTED_PAYROLL_FN_MD5 || null;
  const r = (await mgmtQuery(creds, `select
    (select count(*) from pg_tables where schemaname='public' and tablename in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}')) as tables_live,
    (select count(*) from pg_class where relname in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}') and relrowsecurity) as rls_enabled,
    (select count(*) from pg_policies where schemaname='public' and tablename in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}')) as policies,
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname in ('${P4B_TABLES[0]}','${P4B_TABLES[1]}') and not t.tgisinternal) as triggers,
    (select count(*) from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}') as slot_registered,
    md5(pg_get_functiondef('${PAYROLL_FN}'::regprocedure)) as payroll_fn_md5;`))[0];
  log("post-verify:");
  log(`  P4b tables live   : ${r.tables_live} (expect ${EXPECTED.tables})`);
  log(`  RLS enabled tables: ${r.rls_enabled} (expect ${EXPECTED.tables})`);
  log(`  policies          : ${r.policies} (expect ${EXPECTED.policies})`);
  log(`  triggers          : ${r.triggers} (expect ${EXPECTED.triggers})`);
  log(`  slot registered   : ${r.slot_registered} (expect 0 — we do NOT write schema_migrations)`);
  log(`  calculate_dealer_payroll md5: ${r.payroll_fn_md5}`);
  const okShape = Number(r.tables_live) === EXPECTED.tables && Number(r.rls_enabled) === EXPECTED.tables
    && Number(r.policies) === EXPECTED.policies && Number(r.triggers) === EXPECTED.triggers
    && Number(r.slot_registered) === 0;
  if (want) {
    if (r.payroll_fn_md5 !== want) fail(`calculate_dealer_payroll md5 CHANGED (was ${want}) — Phase 1 must not touch the function.`);
    log("  payroll fn md5 UNCHANGED ✓");
  } else {
    log("  (pass EXPECTED_PAYROLL_FN_MD5 or run --preflight first to assert md5 is unchanged)");
  }
  if (!okShape) fail("post-verify shape mismatch.");
  log("post-verify PASS.");
}

function printUsage() {
  log("allowlisted migration:", ALLOWLISTED_MIGRATION);
  log("modes: --preflight | --dry-run | --apply | --post-verify");
  log(`--apply requires env  ${APPLY_CONFIRM_ENV}=${APPLY_CONFIRM_VALUE}`);
  log("DB modes need env  SUPABASE_PROJECT_REF  +  SUPABASE_ACCESS_TOKEN  (never committed).");
}

async function main() {
  const mode = process.argv[2] || "";
  const { sql } = loadMigration();
  log("allowlisted migration:", ALLOWLISTED_MIGRATION);

  // ALWAYS safety-scan the migration first — refuse anything non-additive.
  const violations = safetyScan(sql, { rollbackMode: false });
  if (violations.length) {
    console.error("[p4b-phase1] ✗ REFUSING — migration failed the safety scan:");
    violations.forEach((x) => console.error("    - " + x));
    process.exit(1);
  }
  log("safety scan PASS (additive DDL only: no payroll fn / DML / seed / non-P4b ALTER / DROP TABLE).");

  if (!["--preflight", "--dry-run", "--apply", "--post-verify"].includes(mode)) {
    printUsage();
    process.exit(0);
  }

  const creds = loadCreds();
  if (!creds) {
    log("no credentials present — NOTHING was contacted. To run a DB mode, set:");
    log("  SUPABASE_PROJECT_REF   = <project ref>");
    log("  SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>   (never commit/print)");
    log(`then: node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs ${mode}`);
    process.exit(0); // safe exit
  }

  if (mode === "--preflight") await preflight(creds);
  else if (mode === "--dry-run") await dryRun(creds, sql);
  else if (mode === "--apply") await apply(creds, sql);
  else if (mode === "--post-verify") await postVerify(creds);
}

main().catch((e) => fail(mask(e?.message ?? String(e))));
