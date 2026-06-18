#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// apply_teardown_299.mjs — controlled apply of migration
//   20260922000000_dealer_assignment_canonical_teardown.sql
// (canonical release_dealer_assignments + reconcile Pass A + success→ok fix +
//  cleanup on_break). Spec: docs/dealer-swing/ASSIGNMENT_TEARDOWN_ROOT_CAUSE.md
//
//   --preflight : READ-ONLY. Prints BEFORE state + a rollback snapshot of the two
//                 function bodies being replaced. Makes NO changes.
//   --apply     : Applies the migration file's SQL via the Management API
//                 (idempotent CREATE OR REPLACE), then verifies. Requires
//                 CONFIRM_APPLY_TEARDOWN_299=APPLY_TEARDOWN_299.
//
// Does NOT: supabase db push, deploy_db, write schema_migrations, or run any
// destructive statement. Rollback: docs/emergency_rollbacks/PRE_20260922_canonical_teardown.sql
// Secrets read from env; never printed (masked).
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--apply") ? "apply" : "preflight";
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const CONFIRM = process.env.CONFIRM_APPLY_TEARDOWN_299;
const MIG = "supabase/migrations/20260922000000_dealer_assignment_canonical_teardown.sql";

const mask = (s) => String(s)
  .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
  .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
const log = (...a) => console.log("[299]", ...a);
const fail = (...a) => { console.error("[299] ✗", ...a); process.exit(1); };

async function run(sql) {
  let r;
  try {
    r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
  } catch (e) { fail("network:", mask(e.message)); }
  const t = await r.text();
  if (!r.ok) fail(`Management API ${r.status}: ${mask(t).slice(0, 500)}`);
  return JSON.parse(t);
}

async function state() {
  const rows = await run(`select
    (select count(*) from pg_proc where proname='release_dealer_assignments') as helper,
    position('reconcile_checked_out_orphan' in pg_get_functiondef('public.reconcile_ghost_assignments(uuid)'::regprocedure))>0 as reconcile_passa,
    position($q$->>'ok'$q$ in pg_get_functiondef('public.reconcile_ghost_assignments(uuid)'::regprocedure))>0 as reconcile_fixed,
    position('on_break' in pg_get_functiondef('public.cleanup_stale_attendance(uuid,integer)'::regprocedure))>0 as cleanup_on_break,
    (select count(*) from dealer_assignments da join dealer_attendance att on att.id=da.attendance_id
       where da.released_at is null and da.status in ('assigned','on_break','pre_assigned') and att.status='checked_out') as orphans;`);
  return rows[0];
}

if (!ref || !token) {
  log("no credentials — set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN. Nothing contacted.");
  process.exit(0);
}

log(`mode=${MODE}`);
const before = await state();
log("BEFORE:", JSON.stringify(before));

// Rollback snapshot of the two bodies being replaced (logged for the record).
const snap = await run(`select 'reconcile' as fn, pg_get_functiondef('public.reconcile_ghost_assignments(uuid)'::regprocedure) as def
  union all select 'cleanup', pg_get_functiondef('public.cleanup_stale_attendance(uuid,integer)'::regprocedure);`);
log("── ROLLBACK SNAPSHOT (prior bodies; canonical copy in docs/emergency_rollbacks/PRE_20260922_canonical_teardown.sql) ──");
for (const s of snap) console.log(`\n### PRIOR ${s.fn} ###\n${s.def}\n`);

if (MODE === "preflight") {
  log("preflight complete — READ-ONLY, no changes made.");
  process.exit(0);
}

// ── APPLY ──
if (CONFIRM !== "APPLY_TEARDOWN_299") {
  fail("refusing to apply: set CONFIRM_APPLY_TEARDOWN_299=APPLY_TEARDOWN_299");
}
let sql;
try { sql = readFileSync(MIG, "utf8"); } catch (e) { fail(`cannot read ${MIG}: ${e.message}`); }
// Guard: the migration must be CREATE-OR-REPLACE/REVOKE/COMMENT only — refuse anything
// destructive or out-of-scope (db push, schema_migrations writes, drops/deletes).
const stripped = sql.replace(/--[^\n]*/g, " ").replace(/\$function\$[\s\S]*?\$function\$/g, " '' ");
const bad = stripped.match(/\b(drop\s+(table|schema|database)|delete\s+from|truncate|alter\s+table|insert\s+into\s+supabase_migrations|schema_migrations|db\s+push)\b/i);
if (bad) fail(`migration contains a forbidden/destructive statement (${bad[1]}) — aborting apply`);

log(`applying ${MIG} (${sql.length} bytes, idempotent CREATE OR REPLACE) ...`);
await run(sql);

const after = await state();
log("AFTER:", JSON.stringify(after));

// Non-blocking grant info: cron invokes reconcile as postgres (owner) so it works
// regardless; service_role grant is belt-and-suspenders only.
const grant = await run(`select has_function_privilege('service_role','public.release_dealer_assignments(uuid,uuid,timestamptz,text)','EXECUTE') as svc_exec;`);
log(`service_role EXECUTE on release_dealer_assignments: ${grant[0].svc_exec} (cron runs as postgres; non-blocking)`);

const ok = Number(after.helper) > 0 && after.reconcile_passa === true && after.reconcile_fixed === true && after.cleanup_on_break === true;
if (!ok) fail("post-apply verification FAILED — see AFTER state above. Rollback via docs/emergency_rollbacks/PRE_20260922_canonical_teardown.sql");
log("✓ APPLY VERIFIED: release_dealer_assignments created; reconcile Pass A + ok-fix live; cleanup on_break live.");
log("schema_migrations NOT written (controlled function apply; idempotent). db push / deploy_db NOT used.");
log("Note: reconcile-ghost-assignments cron (every 15 min) will now exercise the fixed path naturally — no forced run here.");
