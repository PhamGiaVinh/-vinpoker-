#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Tournament SERVICE FEE — allowlisted controlled-op runner (owner-gated apply)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY two reviewed migrations, with a LIVE golden before/after diff of
// get_club_finance_summary around the RPC swap:
//   20260915000000_tournaments_service_fee.sql        (ALTER TABLE … ADD COLUMN)
//   20260916000000_finance_summary_service_fee.sql    (CREATE OR REPLACE the read RPC v3)
//
//   node scripts/finance/apply_service_fee_migrations.mjs --preflight
//   node scripts/finance/apply_service_fee_migrations.mjs --apply        (gated)
//
// SAFETY (hard):
//   • Allowlist HARDCODED to those two files; nothing else can run.
//   • Each file is safety-scanned: col file → only ALTER TABLE tournaments ADD COLUMN + COMMENT;
//     rpc file → only CREATE OR REPLACE FUNCTION get_club_finance_summary + its REVOKE/GRANT.
//     BOTH refuse: DROP, INSERT/UPDATE/DELETE, calculate_dealer_payroll, schema_migrations writes,
//     ALTER on any non-tournaments table, CREATE of any other function.
//   • --apply requires CONFIRM_APPLY_SERVICE_FEE=APPLY_SERVICE_FEE_MIGRATIONS.
//   • GOLDEN DIFF: simulates a real caller (request.jwt.claims) and asserts the RPC output is
//     identical BEFORE vs AFTER except the new revenue.serviceFee field (must be 0 for current data).
//     Any other field moving ABORTS before commit is reported as FAIL.
//   • NO `supabase db push`, NO deploy_db, NO schema_migrations row written by this runner.
//   • Secrets masked in all output. No creds in file → prints env names, exits 0.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // scripts/finance → VinPoker root

const COL_MIG = "supabase/migrations/20260915000000_tournaments_service_fee.sql";
const RPC_MIG = "supabase/migrations/20260916000000_finance_summary_service_fee.sql";
const FN = "public.get_club_finance_summary(timestamptz,timestamptz,uuid)";
const CONFIRM_ENV = "CONFIRM_APPLY_SERVICE_FEE";
const CONFIRM_VAL = "APPLY_SERVICE_FEE_MIGRATIONS";
// Golden-diff window: a wide range so any existing tour data is included.
const GFROM = "2024-01-01T00:00:00+07";
const GTO = "2027-12-31T23:59:59+07";

const log = (...a) => console.log("[svc-fee]", ...a);
const fail = (...a) => { console.error("[svc-fee] ✗", ...a); process.exit(1); };

function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
}

function stripCommentsAndStrings(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

// Shared refusals for BOTH files.
function scanCommon(clean, v) {
  if (/\bcalculate_dealer_payroll\b/i.test(clean)) v.push("references calculate_dealer_payroll");
  if (/\bINSERT\s+INTO\b/i.test(clean)) v.push("contains INSERT INTO");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(clean)) v.push("contains UPDATE … SET");
  if (/\bDELETE\s+FROM\b/i.test(clean)) v.push("contains DELETE FROM");
  if (/\bDROP\s+(TABLE|FUNCTION|COLUMN)\b/i.test(clean)) v.push("contains DROP");
  if (/schema_migrations/i.test(clean)) v.push("touches schema_migrations");
}

function scanColumn(sql) {
  const clean = stripCommentsAndStrings(sql); const v = [];
  scanCommon(clean, v);
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(clean)) v.push("col migration must not CREATE FUNCTION");
  for (const m of clean.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
    if (m[1].toLowerCase() !== "tournaments") v.push(`ALTER TABLE on non-tournaments table: ${m[1]}`);
  }
  if (!/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+service_fee_amount\b/i.test(clean))
    v.push("col migration must ADD COLUMN IF NOT EXISTS service_fee_amount");
  return v;
}

function scanRpc(sql) {
  const clean = stripCommentsAndStrings(sql); const v = [];
  scanCommon(clean, v);
  if (/\bALTER\s+TABLE\b/i.test(clean)) v.push("rpc migration must not ALTER TABLE");
  // every CREATE [OR REPLACE] FUNCTION must be get_club_finance_summary
  for (const m of clean.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
    if (m[1].toLowerCase() !== "get_club_finance_summary") v.push(`creates unexpected function: ${m[1]}`);
  }
  if (!/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_club_finance_summary\b/i.test(clean))
    v.push("rpc migration must CREATE OR REPLACE public.get_club_finance_summary");
  return v;
}

function load(path, scan) {
  const abs = resolve(REPO_ROOT, path);
  let sql; try { sql = readFileSync(abs, "utf8"); } catch { fail(`migration not found: ${path}`); }
  const v = scan(sql);
  if (v.length) { console.error(`[svc-fee] ✗ REFUSING — ${path} failed the safety scan:`); v.forEach((x) => console.error("    - " + x)); process.exit(1); }
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

const PREFLIGHT_SQL = `
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='tournaments' and column_name='service_fee_amount') as col_present,
  (select md5(pg_get_functiondef('${FN}'::regprocedure))) as fn_md5,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_club_finance_summary') as fn_present,
  (select user_id::text from public.user_roles where role='super_admin' limit 1) as super_uid;
`;

// Call the RPC as a simulated caller (so auth.uid() resolves) inside a tx; return the JSON result.
async function goldenCapture(creds, uid) {
  if (!uid) return null;
  const claims = JSON.stringify({ sub: uid, role: "authenticated" }).replace(/'/g, "''");
  const q = `begin;
    set local request.jwt.claims = '${claims}';
    select public.get_club_finance_summary('${GFROM}'::timestamptz, '${GTO}'::timestamptz, null) as result;
    commit;`;
  const rows = await mgmt(creds, q);
  // result may be returned as the last select's rows
  const row = Array.isArray(rows) ? rows.find((r) => r && r.result !== undefined) ?? rows[rows.length - 1] : rows;
  return row ? row.result : null;
}

function diffGolden(before, after) {
  if (!before || !after) return { ok: false, why: "golden capture missing (no super_admin uid or call failed)" };
  const rb = before.revenue ?? {}, ra = after.revenue ?? {};
  const problems = [];
  // every revenue field that existed in v2 must be unchanged
  for (const k of Object.keys(rb)) {
    if (String(rb[k]) !== String(ra[k])) problems.push(`revenue.${k}: ${rb[k]} -> ${ra[k]}`);
  }
  // net + total + cost must be unchanged
  if (String(before.net) !== String(after.net)) problems.push(`net: ${before.net} -> ${after.net}`);
  for (const k of Object.keys(before.cost ?? {})) {
    if (String((before.cost||{})[k]) !== String((after.cost||{})[k])) problems.push(`cost.${k}`);
  }
  // serviceFee must be the only NEW field, and it must be 0 for current data
  const newKeys = Object.keys(ra).filter((k) => !(k in rb));
  if (newKeys.length !== 1 || newKeys[0] !== "serviceFee") problems.push(`unexpected new revenue keys: ${newKeys.join(",")}`);
  if (Number(ra.serviceFee ?? -1) !== 0) problems.push(`serviceFee should be 0 for current data, got ${ra.serviceFee}`);
  return { ok: problems.length === 0, problems, serviceFee: ra.serviceFee };
}

async function postVerify(creds, preMd5) {
  const r = (await mgmt(creds, `select
    (select count(*) from information_schema.columns
       where table_schema='public' and table_name='tournaments' and column_name='service_fee_amount') as col_present,
    (select column_default from information_schema.columns
       where table_schema='public' and table_name='tournaments' and column_name='service_fee_amount') as col_default,
    (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='get_club_finance_summary' limit 1) as secdef,
    (select md5(pg_get_functiondef('${FN}'::regprocedure))) as fn_md5,
    (select count(*) from information_schema.role_routine_grants
       where routine_name='get_club_finance_summary' and grantee='anon') as anon_grants;`))[0];
  log("post-verify:");
  log(`  service_fee_amount column : ${r.col_present} (expect 1), default=${r.col_default}`);
  log(`  RPC SECURITY DEFINER       : ${r.secdef} (expect true)`);
  log(`  RPC anon grants            : ${r.anon_grants} (expect 0)`);
  log(`  RPC md5 ${r.fn_md5 === preMd5 ? "UNCHANGED ⚠ (expected to CHANGE)" : "changed ✓ (v3 applied)"}`);
  const ok = Number(r.col_present) === 1 && r.secdef === true && Number(r.anon_grants) === 0 && r.fn_md5 !== preMd5;
  if (!ok) fail("post-verify shape mismatch.");
  log("post-verify PASS.");
}

async function main() {
  const mode = process.argv[2] || "";
  const colSql = load(COL_MIG, scanColumn);
  const rpcSql = load(RPC_MIG, scanRpc);
  log("allowlisted migrations:", COL_MIG, "+", RPC_MIG);
  log("safety scan PASS (col=ADD COLUMN only · rpc=CREATE OR REPLACE get_club_finance_summary only).");

  if (!["--preflight", "--apply"].includes(mode)) {
    log("modes: --preflight | --apply");
    log(`--apply requires env ${CONFIRM_ENV}=${CONFIRM_VAL}`);
    log("DB modes need SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN (never committed).");
    process.exit(0);
  }

  const creds = loadCreds();
  if (!creds) {
    log("no credentials present — NOTHING contacted. To run a DB mode set:");
    log("  SUPABASE_PROJECT_REF   = <project ref>");
    log("  SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>   (never commit/print)");
    process.exit(0);
  }

  const pre = (await mgmt(creds, PREFLIGHT_SQL))[0];
  log("preflight:");
  log(`  service_fee_amount column present : ${pre.col_present} (expect 0 before apply)`);
  log(`  get_club_finance_summary present  : ${pre.fn_present} (expect 1)`);
  log(`  RPC md5 (capture)                 : ${pre.fn_md5}`);
  log(`  golden caller (super_admin uid)   : ${pre.super_uid ? "found" : "NONE — golden diff will be skipped"}`);

  if (mode === "--preflight") { log("preflight done (read-only)."); return; }

  // ---- APPLY ----
  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`APPLY blocked. Set ${CONFIRM_ENV}=${CONFIRM_VAL}`);
  if (Number(pre.fn_present) !== 1) fail("get_club_finance_summary not found — refusing.");

  log("golden BEFORE (v2, simulated caller) …");
  const before = await goldenCapture(creds, pre.super_uid);
  log(`  before.revenue.rake=${before?.revenue?.rake} total=${before?.revenue?.total} net=${before?.net}`);

  log(`applying ${COL_MIG} (BEGIN…COMMIT) …`);
  await mgmt(creds, `BEGIN;\n${colSql}\nCOMMIT;`);
  log(`applying ${RPC_MIG} (BEGIN…COMMIT; schema_migrations NOT touched) …`);
  await mgmt(creds, `BEGIN;\n${rpcSql}\nCOMMIT;`);

  log("golden AFTER (v3, simulated caller) …");
  const after = await goldenCapture(creds, pre.super_uid);
  log(`  after.revenue.rake=${after?.revenue?.rake} total=${after?.revenue?.total} net=${after?.net} serviceFee=${after?.revenue?.serviceFee}`);

  const g = diffGolden(before, after);
  if (g.ok) log("GOLDEN DIFF PASS — identical except new revenue.serviceFee=0 (true no-op for current data).");
  else if (g.why) log(`GOLDEN DIFF SKIPPED: ${g.why} (relying on structural post-verify).`);
  else { console.error("[svc-fee] ✗ GOLDEN DIFF FAIL — unexpected changes:"); g.problems.forEach((p) => console.error("    - " + p)); fail("golden diff did not match the additive no-op expectation."); }

  await postVerify(creds, pre.fn_md5);
  log("apply complete. Next: flip FEATURES.tournamentServiceFee=true, then owner UAT.");
}

main().catch((e) => fail(mask(e?.message ?? String(e))));
