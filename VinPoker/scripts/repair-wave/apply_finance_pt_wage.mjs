#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// REPAIR WAVE R2 — restore PT-wage cost in get_club_finance_summary (owner-gated)
// ════════════════════════════════════════════════════════════════════════════
// Mirrors scripts/marketing/apply_marketing_migrations.mjs (proven runner pattern):
// Management API only — NO db push, NO deploy_db, NO schema_migrations write.
//
// Modes:
//   --preflight   read-only: live def dump, PT-ref count, table existence,
//                 impersonated BEFORE snapshot + independent pt_sum (saved to out/)
//   --apply       gated by CONFIRM_APPLY_REPAIR=APPLY_FINANCE_PT_WAGE:
//                 applies EXACTLY supabase/migrations/20261211000000_finance_summary_pt_wage_restore.sql
//   --verify      read-only: AFTER snapshot, golden diff vs BEFORE:
//                 payrollNet += pt_sum, net -= pt_sum, ptWagePaid == pt_sum,
//                 every other field byte-identical (aging warn-only: uses now())
//   --rollback    gated by CONFIRM_APPLY_REPAIR=APPLY_FINANCE_PT_ROLLBACK:
//                 applies supabase/migrations/_repair_finance_pt_wage_rollback.sql (exact pre-repair live body)
//
// SAFETY: file allowlist is HARDCODED; secondary lint refuses DROP/INSERT/UPDATE/DELETE/
// TRUNCATE-like statements and schema_migrations references outside the function body.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // scripts/repair-wave → VinPoker root
const OUT_DIR = resolve(REPO_ROOT, "scripts", "repair-wave", "out");

const FILES = {
  repair: "supabase/migrations/20261211000000_finance_summary_pt_wage_restore.sql",
  rollback: "supabase/migrations/_repair_finance_pt_wage_rollback.sql",
};
const MARQUEE = {
  repair: /CREATE OR REPLACE FUNCTION public\.get_club_finance_summary[\s\S]*pt_pay as \(/,
  rollback: /CREATE OR REPLACE FUNCTION public\.get_club_finance_summary/,
};

const CONFIRM_ENV = "CONFIRM_APPLY_REPAIR";
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "orlesggcjamwuknxwcpk";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
// Fixed window so BEFORE/AFTER snapshots are comparable (function-internal now() only affects 'aging').
const WIN_FROM = "2026-01-01T00:00:00+07:00";
const WIN_TO = "2026-12-31T23:59:59+07:00";

const log = (...a) => console.log("[pt-wage]", ...a);
const fail = (...a) => { console.error("[pt-wage] ✗", ...a); process.exit(1); };
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9_]+|eyJ[A-Za-z0-9._-]{20,}/g, "***");

async function mgmt(query) {
  if (!TOKEN) fail("SUPABASE_ACCESS_TOKEN not set");
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (e) { fail("network error:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

// -- secondary lint (defense in depth; primary control = hardcoded allowlist of reviewed files)
function lint(sqlRaw, which) {
  if (!MARQUEE[which].test(sqlRaw)) fail(`${which}: marquee statement missing — wrong file?`);
  // strip $function$..$function$ bodies, then line comments and strings, then scan the shell
  const shell = sqlRaw
    .replace(/\$function\$[\s\S]*?\$function\$/g, "$BODY$")
    .replace(/--[^\n]*/g, "")
    .replace(/'[^']*'/g, "''");
  for (const rx of [/\bdrop\s+/i, /\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i, /\btrunc\w*\b/i, /schema_migrations/i, /\bgrant\b[^;]*\banon\b/i]) {
    if (rx.test(shell)) fail(`${which}: lint refused pattern ${rx} outside function body`);
  }
  log(`${which}: lint OK (shell clean, marquee present)`);
}

const Q_DEF = `select pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure) as def`;
const Q_UID = `select owner_id::text as uid from public.clubs where owner_id is not null order by created_at asc limit 1`;
const Q_TABLE = `select (to_regclass('public.dealer_pt_wage_payments') is not null) as has_table`;
const qSnapshot = (uid) => `
select public.get_club_finance_summary('${WIN_FROM}'::timestamptz, '${WIN_TO}'::timestamptz, null) as summary
from (select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true)) _s;`;
const qPtSum = (uid) => `
select coalesce(sum(w.amount_vnd),0)::bigint as pt_sum
from public.dealer_pt_wage_payments w
join public.clubs c on c.id = w.club_id
where c.owner_id = '${uid}'::uuid
  and w.voided_at is null
  and w.paid_at between '${WIN_FROM}'::timestamptz and '${WIN_TO}'::timestamptz;`;

const rowsOf = (r) => (Array.isArray(r) ? r : (r.rows ?? r.result ?? []));
const one = (r, k) => rowsOf(r)[0]?.[k];

function ptRefCount(def) { return (def.match(/pt_pay|dealer_pt_wage_payments|ptWagePaid/gi) || []).length; }

async function preflight() {
  mkdirSync(OUT_DIR, { recursive: true });
  const def = one(await mgmt(Q_DEF), "def");
  if (!def) fail("could not dump live function def");
  writeFileSync(resolve(OUT_DIR, "def_before.sql"), def);
  const refs = ptRefCount(def);
  log(`live def: ${def.split("\n").length} lines, PT refs = ${refs} ${refs === 0 ? "(bug present — repair needed)" : "(already contains PT — idempotent re-run)"}`);
  if (one(await mgmt(Q_TABLE), "has_table") !== true) fail("dealer_pt_wage_payments does NOT exist live — abort (Salary B1 backend missing)");
  const uid = one(await mgmt(Q_UID), "uid");
  if (!uid) fail("no club owner uid found for impersonated snapshot");
  writeFileSync(resolve(OUT_DIR, "uid.txt"), uid);
  const before = one(await mgmt(qSnapshot(uid)), "summary");
  if (!before) fail("BEFORE snapshot returned nothing (impersonation failed?)");
  writeFileSync(resolve(OUT_DIR, "summary_before.json"), JSON.stringify(before, null, 2));
  const ptSum = Number(one(await mgmt(qPtSum(uid)), "pt_sum"));
  writeFileSync(resolve(OUT_DIR, "pt_sum.txt"), String(ptSum));
  log(`BEFORE snapshot saved. independent pt_sum(window ${WIN_FROM}..${WIN_TO}) = ${ptSum}`);
  log(`BEFORE payrollNet=${before?.cost?.payrollNet} net=${before?.net} ptWagePaid=${before?.cost?.ptWagePaid ?? "(absent)"}`);
}

async function apply(which) {
  const want = which === "repair" ? "APPLY_FINANCE_PT_WAGE" : "APPLY_FINANCE_PT_ROLLBACK";
  if (process.env[CONFIRM_ENV] !== want) fail(`refusing: ${CONFIRM_ENV} != ${want}`);
  const sql = readFileSync(resolve(REPO_ROOT, FILES[which]), "utf8");
  lint(sql, which);
  await mgmt(sql);
  log(`${which} applied via Management API (single call, no schema_migrations write).`);
}

async function verify() {
  const def = one(await mgmt(Q_DEF), "def");
  writeFileSync(resolve(OUT_DIR, "def_after.sql"), def);
  const refs = ptRefCount(def);
  if (refs < 6) fail(`AFTER def has only ${refs} PT refs — apply did not take effect?`);
  log(`AFTER def: PT refs = ${refs} OK`);
  const uid = readFileSync(resolve(OUT_DIR, "uid.txt"), "utf8").trim();
  const before = JSON.parse(readFileSync(resolve(OUT_DIR, "summary_before.json"), "utf8"));
  const ptSum = Number(readFileSync(resolve(OUT_DIR, "pt_sum.txt"), "utf8").trim());
  const after = one(await mgmt(qSnapshot(uid)), "summary");
  writeFileSync(resolve(OUT_DIR, "summary_after.json"), JSON.stringify(after, null, 2));

  const errs = [];
  const eq = (path, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${path} changed unexpectedly: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); };
  eq("revenue", before.revenue, after.revenue);
  eq("cost.payrollGross", before.cost.payrollGross, after.cost.payrollGross);
  eq("cost.adjustments", before.cost.adjustments, after.cost.adjustments);
  eq("cost.fnbCogs", before.cost.fnbCogs, after.cost.fnbCogs);
  eq("cost.compCogs", before.cost.compCogs, after.cost.compCogs);
  eq("statusTotals", before.statusTotals, after.statusTotals);
  eq("unpaidTotal", before.unpaidTotal, after.unpaidTotal);
  eq("reconciledTotal", before.reconciledTotal, after.reconciledTotal);
  eq("perPeriod", before.perPeriod, after.perPeriod);
  eq("clubs", before.clubs, after.clubs);
  if (Number(after.cost.payrollNet) !== Number(before.cost.payrollNet) + ptSum)
    errs.push(`payrollNet: expected ${Number(before.cost.payrollNet) + ptSum}, got ${after.cost.payrollNet}`);
  if (Number(after.cost.ptWagePaid ?? -1) !== ptSum)
    errs.push(`ptWagePaid: expected ${ptSum}, got ${after.cost.ptWagePaid}`);
  if (Number(after.net) !== Number(before.net) - ptSum)
    errs.push(`net: expected ${Number(before.net) - ptSum}, got ${after.net}`);
  if (JSON.stringify(before.aging) !== JSON.stringify(after.aging))
    log("WARN aging differs (function-internal now(); day-bucket race — informational only)");
  if (errs.length) fail("GOLDEN DIFF FAILED:\n  " + errs.join("\n  "));
  log(`GOLDEN DIFF PASS: payrollNet +${ptSum}, net -${ptSum}, ptWagePaid=${ptSum}, everything else identical.`);
}

const mode = process.argv[2];
if (mode === "--preflight") await preflight();
else if (mode === "--apply") await apply("repair");
else if (mode === "--verify") await verify();
else if (mode === "--rollback") await apply("rollback");
else fail("usage: apply_finance_pt_wage.mjs --preflight | --apply | --verify | --rollback");
