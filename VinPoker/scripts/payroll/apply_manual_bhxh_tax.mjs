#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// PAYROLL manual BHXH + tax override — allowlisted controlled-op runner (owner-gated)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY two reviewed migrations, with a GOLDEN before/after diff of
// calculate_dealer_payroll itself (called for real active dealers) proving net_pay +
// every deduction is BYTE-IDENTICAL when manual_bhxh_vnd/manual_tax_vnd are NULL (no
// silent recompute of saved periods):
//   20261001000000_dealers_manual_bhxh_tax.sql          (ALTER TABLE dealers ADD COLUMN ×2)
//   20261001000001_payroll_manual_bhxh_tax_override.sql (CREATE OR REPLACE calculate_dealer_payroll)
//
//   node scripts/payroll/apply_manual_bhxh_tax.mjs --preflight
//   node scripts/payroll/apply_manual_bhxh_tax.mjs --apply        (gated)
//
// SAFETY: allowlist hardcoded; each file safety-scanned (col file → only ADD COLUMN on
// dealers; fn file → only CREATE OR REPLACE calculate_dealer_payroll). Refuses DML / DROP /
// other-table ALTER / other-function CREATE / schema_migrations writes. --apply needs
// CONFIRM_APPLY_MANUAL_BHXH_TAX=APPLY_MANUAL_BHXH_TAX. NO db push / deploy_db. Secrets masked.
// No creds → prints env names, exits 0.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const COL_MIG = "supabase/migrations/20261001000000_dealers_manual_bhxh_tax.sql";
const FN_MIG = "supabase/migrations/20261001000001_payroll_manual_bhxh_tax_override.sql";
const FN = "public.calculate_dealer_payroll(uuid,date,date,integer)";
const CONFIRM_ENV = "CONFIRM_APPLY_MANUAL_BHXH_TAX", CONFIRM_VAL = "APPLY_MANUAL_BHXH_TAX";
// Golden-diff period (a recent month with attendance). Date strings are passed verbatim.
const GSTART = "2026-06-01", GEND = "2026-06-30";
// Fields that MUST be identical before/after when overrides are NULL.
const CMP = ["net_pay_vnd", "net_pay_after_tax_vnd", "gross_pay_vnd", "bhxh_deduction_vnd",
  "bhyt_deduction_vnd", "bhtn_deduction_vnd", "pit_deduction_vnd", "taxable_income_vnd", "base_salary_vnd"];

const log = (...a) => console.log("[mbt]", ...a);
const fail = (...a) => { console.error("[mbt] ✗", ...a); process.exit(1); };
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");

function strip(sql) {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:''|[^'])*'/g, "''");
}
function scanCommon(c, v) {
  if (/\bINSERT\s+INTO\b|\bDELETE\s+FROM\b/i.test(c)) v.push("contains DML");
  if (/\bDROP\b/i.test(c)) v.push("contains DROP");
  if (/schema_migrations/i.test(c)) v.push("touches schema_migrations");
}
function scanCol(sql) {
  const c = strip(sql), v = []; scanCommon(c, v);
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(c)) v.push("col migration must not CREATE FUNCTION");
  for (const m of c.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi))
    if (m[1].toLowerCase() !== "dealers") v.push(`ALTER on non-dealers table: ${m[1]}`);
  if (!/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+manual_bhxh_vnd\b/i.test(c)) v.push("col migration must ADD manual_bhxh_vnd");
  if (!/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+manual_tax_vnd\b/i.test(c)) v.push("col migration must ADD manual_tax_vnd");
  return v;
}
function scanFn(sql) {
  const c = strip(sql), v = []; scanCommon(c, v);
  if (/\bALTER\s+TABLE\b/i.test(c)) v.push("fn migration must not ALTER TABLE");
  for (const m of c.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi))
    if (m[1].toLowerCase() !== "calculate_dealer_payroll") v.push(`creates unexpected function: ${m[1]}`);
  if (!/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.calculate_dealer_payroll\b/i.test(c)) v.push("must CREATE OR REPLACE calculate_dealer_payroll");
  return v;
}
function load(path, scan) {
  let sql; try { sql = readFileSync(resolve(ROOT, path), "utf8"); } catch { fail(`migration not found: ${path}`); }
  const v = scan(sql);
  if (v.length) { console.error(`[mbt] ✗ REFUSING — ${path}:`); v.forEach((x) => console.error("  - " + x)); process.exit(1); }
  return sql;
}

const colSql = load(COL_MIG, scanCol);
const fnSql = load(FN_MIG, scanFn);
log("allowlisted migrations:", COL_MIG, "+", FN_MIG);
log("safety scan PASS (col=ADD COLUMN on dealers · fn=CREATE OR REPLACE calculate_dealer_payroll).");

const mode = process.argv[2] || "";
if (!["--preflight", "--apply"].includes(mode)) { log("modes: --preflight | --apply"); log(`--apply needs ${CONFIRM_ENV}=${CONFIRM_VAL}`); process.exit(0); }

const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { log("no credentials — set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN. Exiting safely."); process.exit(0); }

async function mgmt(q) {
  let res;
  try { res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); }
  catch (e) { fail("network:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

const PRE_SQL = `select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='dealers' and column_name in ('manual_bhxh_vnd','manual_tax_vnd')) as cols_present,
  (select md5(pg_get_functiondef('${FN}'::regprocedure))) as fn_md5,
  (select count(*) from public.dealers where status='active') as active_dealers;`;

// Golden snapshot: net + deductions per active dealer for the golden period.
const GOLDEN_SQL = `
select d.id::text as dealer_id,
  (r->>'net_pay_vnd') as net_pay_vnd,
  (r->>'net_pay_after_tax_vnd') as net_pay_after_tax_vnd,
  (r->>'gross_pay_vnd') as gross_pay_vnd,
  (r->>'bhxh_deduction_vnd') as bhxh_deduction_vnd,
  (r->>'bhyt_deduction_vnd') as bhyt_deduction_vnd,
  (r->>'bhtn_deduction_vnd') as bhtn_deduction_vnd,
  (r->>'pit_deduction_vnd') as pit_deduction_vnd,
  (r->>'taxable_income_vnd') as taxable_income_vnd,
  (r->>'base_salary_vnd') as base_salary_vnd
from public.dealers d
cross join lateral (select public.calculate_dealer_payroll(d.id, '${GSTART}'::date, '${GEND}'::date, 0) as r) x
where d.status='active'
order by d.id
limit 50;`;

function index(rows) { const m = new Map(); for (const r of rows) m.set(r.dealer_id, r); return m; }
function diffGolden(before, after) {
  const b = index(before), a = index(after), problems = [];
  if (b.size !== a.size) problems.push(`dealer count ${b.size} -> ${a.size}`);
  for (const [id, br] of b) {
    const ar = a.get(id); if (!ar) { problems.push(`dealer ${id} missing after`); continue; }
    for (const f of CMP) if (String(br[f]) !== String(ar[f])) problems.push(`dealer ${id.slice(0,8)} ${f}: ${br[f]} -> ${ar[f]}`);
  }
  return problems;
}

const pre = (await mgmt(PRE_SQL))[0];
log("preflight:");
log(`  manual_bhxh_vnd/manual_tax_vnd cols present : ${pre.cols_present} (expect 0 before apply)`);
log(`  calculate_dealer_payroll md5 : ${pre.fn_md5}`);
log(`  active dealers : ${pre.active_dealers}`);
if (mode === "--preflight") { log("preflight done (read-only)."); process.exit(0); }

if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`APPLY blocked. Set ${CONFIRM_ENV}=${CONFIRM_VAL}`);

log(`golden BEFORE — calculate_dealer_payroll for ${pre.active_dealers} active dealers, ${GSTART}..${GEND} …`);
const before = await mgmt(GOLDEN_SQL);
log(`  captured ${before.length} dealer payrolls`);

log(`applying ${COL_MIG} …`);
await mgmt(`BEGIN;\n${colSql}\nCOMMIT;`);
log(`applying ${FN_MIG} (BEGIN…COMMIT; schema_migrations NOT touched) …`);
await mgmt(`BEGIN;\n${fnSql}\nCOMMIT;`);

log("golden AFTER — recompute the same dealers (all overrides NULL) …");
const after = await mgmt(GOLDEN_SQL);
const problems = diffGolden(before, after);
if (problems.length) { console.error("[mbt] ✗ GOLDEN DIFF FAIL — net/deductions changed with NULL overrides:"); problems.slice(0, 30).forEach((p) => console.error("  - " + p)); fail("golden diff did not match (must be a no-op when overrides are NULL)."); }
log(`GOLDEN DIFF PASS — net + all deductions byte-identical for ${after.length} dealers (true no-op until an override is set).`);

const post = (await mgmt(`select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='dealers' and column_name in ('manual_bhxh_vnd','manual_tax_vnd')) as cols_present,
  (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='calculate_dealer_payroll' limit 1) as secdef,
  (select md5(pg_get_functiondef('${FN}'::regprocedure))) as fn_md5;`))[0];
log("post-verify:");
log(`  cols present : ${post.cols_present} (expect 2)`);
log(`  fn SECURITY DEFINER : ${post.secdef} (expect true)`);
log(`  fn md5 ${post.fn_md5 === pre.fn_md5 ? "UNCHANGED ⚠ (expected to change)" : "changed ✓ (override body applied)"}`);
if (Number(post.cols_present) !== 2 || post.secdef !== true || post.fn_md5 === pre.fn_md5) fail("post-verify shape mismatch.");
log("apply PASS. Next: regen types.ts (manual_bhxh_vnd/manual_tax_vnd) + the dealer-edit UI is owner-gated behind the build.");
