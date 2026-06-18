#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// apply_dealer_swing_batch.mjs — controlled, owner-gated apply of the 4 merged
// source-only Dealer Swing migrations, in order:
//   1. 20260922000000  (#299) canonical teardown + reconcile fix + cleanup on_break
//   2. 20260924000000  (#312) perform_swing race-lost rollback marker identity
//   3. 20260925000000  (#314) orphan dealer_breaks cleanup on race-lost
//   4. 20260926000000  (#317) cleanup_stale_attendance skips actively-rotating dealers
//
//   --preflight : READ-ONLY. schema_migrations + per-fix "already applied?" markers +
//                 perform_swing overload count. Prints expected rollback file paths.
//                 Makes NO changes.
//   --apply     : Requires CONFIRM_DSWING_BATCH === APPLY_DEALER_SWING_DB_BATCH_299_312_314_317.
//                 Applies each migration file's SQL (idempotent CREATE OR REPLACE) in
//                 order, records its version in supabase_migrations.schema_migrations,
//                 post-verifies the fix marker after each, STOPS on first failure.
//                 Final smoke + PASS/FAIL. NO auto-rollback (prints paths only).
//
// Hard rules: NO supabase db push, NO deploy_db. Credentials come from GitHub Secrets
// (SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF) — never a plaintext Variable; never
// printed (masked). Each migration body is guarded: top-level statements must be only
// CREATE OR REPLACE / REVOKE / GRANT / COMMENT (function bodies are dollar-quoted and
// stripped before the guard, so the in-body DELETE in #314 is allowed).
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--apply") ? "apply" : "preflight";
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const CONFIRM = process.env.CONFIRM_DSWING_BATCH;
const CONFIRM_STR = "APPLY_DEALER_SWING_DB_BATCH_299_312_314_317";

const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9]+/g, "sbp_****").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
const log = (...a) => console.log("[dswing-batch]", ...a);
const fail = (...a) => { console.error("[dswing-batch] ✗", ...a); process.exit(1); };

const PERFORM_SWING_8ARG = "public.perform_swing(uuid, integer, uuid, boolean, integer, integer, timestamp with time zone, integer)";

// The 8-arg perform_swing body (the overload the wrapper delegates to / #312 & #314 patch).
const PS = `pg_get_functiondef('${PERFORM_SWING_8ARG}'::regprocedure)`;
const RECONCILE = `pg_get_functiondef('public.reconcile_ghost_assignments(uuid)'::regprocedure)`;
const CLEANUP = `pg_get_functiondef('public.cleanup_stale_attendance(uuid,integer)'::regprocedure)`;

// Each migration + the marker proving it is live (post-verify / already-applied check).
const MIGRATIONS = [
  {
    ver: "20260922000000", pr: "#299", file: "supabase/migrations/20260922000000_dealer_assignment_canonical_teardown.sql",
    rollback: "VinPoker/docs/emergency_rollbacks/PRE_20260922_canonical_teardown.sql",
    markers: [
      { label: "release_dealer_assignments() exists", sql: `select (count(*)>0) as ok from pg_proc where proname='release_dealer_assignments'` },
      { label: "reconcile Pass A (checked-out orphans)", sql: `select position('reconcile_checked_out_orphan' in ${RECONCILE})>0 as ok` },
      // NB: only check that the fixed code path uses ->>'ok'. Do NOT also assert the
      // absence of ->>'success' — #299's explanatory COMMENT contains the literal
      // ->>'success', which a naive text scan would match (false-negative). The old
      // (unapplied) body has NO ->>'ok' anywhere, so this presence check is decisive.
      { label: "reconcile success->ok fix", sql: `select (position($q$->>'ok'$q$ in ${RECONCILE})>0) as ok` },
      { label: "cleanup_stale releases on_break", sql: `select (position('on_break' in ${CLEANUP})>0) as ok` },
    ],
  },
  {
    ver: "20260924000000", pr: "#312", file: "supabase/migrations/20260924000000_perform_swing_racelost_rollback_identity.sql",
    rollback: "VinPoker/docs/emergency_rollbacks/PRE_20260924_perform_swing_racelost.sql",
    markers: [
      { label: "perform_swing rollback captures v_prev_last_released", sql: `select position('v_prev_last_released' in ${PS})>0 as ok` },
    ],
  },
  {
    ver: "20260925000000", pr: "#314", file: "supabase/migrations/20260925000000_perform_swing_orphan_break_cleanup.sql",
    rollback: "VinPoker/docs/emergency_rollbacks/PRE_20260925_perform_swing_orphan_break.sql",
    markers: [
      { label: "perform_swing orphan-break DELETE path (v_created_break_id)", sql: `select position('v_created_break_id' in ${PS})>0 as ok` },
    ],
  },
  {
    ver: "20260926000000", pr: "#317", file: "supabase/migrations/20260926000000_cleanup_stale_skip_active_dealer.sql",
    rollback: "VinPoker/docs/emergency_rollbacks/PRE_20260926_cleanup_stale_active_guard.sql",
    markers: [
      { label: "cleanup_stale active-dealer guard", sql: `select position('COALESCE(fa.swing_due_at, fa.assigned_at)' in ${CLEANUP})>0 as ok` },
    ],
  },
];

async function run(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${mask(t).slice(0, 400)}`);
  return JSON.parse(t);
}
async function marker(m) { const rows = await run(m.sql); return rows && rows[0] && rows[0].ok === true; }

// top-level guard: strip dollar-quoted bodies + comments, then ensure only allowed DDL.
function assertSafeMigration(name, sql) {
  const stripped = sql.replace(/\$[a-zA-Z_]*\$[\s\S]*?\$[a-zA-Z_]*\$/g, " '' ").replace(/--[^\n]*/g, " ");
  const bad = stripped.match(/\b(drop\s+(table|schema|database|type)|truncate|delete\s+from|alter\s+table|insert\s+into\s+supabase_migrations|supabase\s+db\s+push|deploy_db)\b/i);
  if (bad) fail(`migration ${name} contains a forbidden top-level statement (${bad[1]}) — aborting`);
  if (!/create\s+or\s+replace\s+function/i.test(stripped)) fail(`migration ${name} has no CREATE OR REPLACE FUNCTION — unexpected; aborting`);
}

async function preflight() {
  log("── PREFLIGHT (read-only) ──");
  const sm = await run(`select version from supabase_migrations.schema_migrations order by version desc limit 5`);
  log("schema_migrations top 5:", JSON.stringify(sm.map((x) => x.version)));
  const cnt = await run(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='perform_swing'`);
  log(`perform_swing overload count: ${cnt[0].n} (expect 3; no new overload may be created)`);
  for (const mg of MIGRATIONS) {
    const already = await run(`select (count(*)>0) as present from supabase_migrations.schema_migrations where version='${mg.ver}'`);
    const states = [];
    for (const m of mg.markers) states.push(`${m.label}=${await marker(m)}`);
    log(`${mg.pr} ${mg.ver}: schema_migrations_present=${already[0].present} | ${states.join(" | ")}`);
  }
  log("Expected rollback files (re-run on regression, in reverse order):");
  for (const mg of [...MIGRATIONS].reverse()) log(`  ${mg.pr}: ${mg.rollback}`);
}

async function apply() {
  if (CONFIRM !== CONFIRM_STR) fail(`refusing to apply: set confirm='${CONFIRM_STR}' (got: ${CONFIRM ? "<mismatch>" : "<empty>"})`);
  log("── APPLY (owner-gated, confirm matched) ──");
  await preflight();
  const cntBefore = (await run(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='perform_swing'`))[0].n;

  for (const mg of MIGRATIONS) {
    log(`\n──── applying ${mg.pr} ${mg.ver} ────`);
    let sql;
    // Paths are relative to the workflow working-directory (./VinPoker), so mg.file
    // ('supabase/migrations/...') is used as-is — do NOT prefix 'VinPoker/'.
    try { sql = readFileSync(mg.file, "utf8"); } catch (e) { fail(`cannot read ${mg.file} (cwd must be ./VinPoker): ${e.message}`); }
    assertSafeMigration(mg.ver, sql);
    try { await run(sql); } catch (e) { fail(`${mg.pr} ${mg.ver} apply FAILED: ${mask(e.message)}\n→ STOP. Roll back applied migrations via the rollback files (reverse order).`); }

    // Record the migration version (bookkeeping). version-only insert is robust against
    // schema_migrations column variations; ON CONFLICT keeps it idempotent.
    try { await run(`insert into supabase_migrations.schema_migrations (version) values ('${mg.ver}') on conflict (version) do nothing`); }
    catch (e) { log(`⚠ schema_migrations record warning for ${mg.ver}: ${mask(e.message)} (function DDL already applied; bookkeeping only)`); }

    // Post-verify markers
    for (const m of mg.markers) {
      const ok = await marker(m);
      if (!ok) fail(`${mg.pr} ${mg.ver} POST-VERIFY FAILED: "${m.label}" not present after apply.\n→ STOP. Roll back via ${mg.rollback} (and prior, reverse order).`);
      log(`  ✓ ${m.label}`);
    }
    const present = (await run(`select (count(*)>0) as p from supabase_migrations.schema_migrations where version='${mg.ver}'`))[0].p;
    log(`  ✓ schema_migrations has ${mg.ver}: ${present}`);
  }

  // ── Final smoke ──
  log("\n── FINAL SMOKE ──");
  const cntAfter = (await run(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='perform_swing'`))[0].n;
  if (cntAfter !== cntBefore) fail(`perform_swing overload count changed ${cntBefore}→${cntAfter} — a new overload was created! Investigate before trusting the apply.`);
  log(`  ✓ perform_swing overload count unchanged (${cntAfter}; no new overload)`);
  const smoke = [
    { label: "reconcile success->ok fix live", sql: `select (position($q$->>'ok'$q$ in ${RECONCILE})>0) as ok` },
    { label: "perform_swing race-lost markers restored (v_prev_last_released + worked_minutes_since_last_break in rollback)", sql: `select (position('v_prev_last_released' in ${PS})>0 and position('v_prev_worked_since_break' in ${PS})>0) as ok` },
    { label: "perform_swing orphan-break DELETE path present", sql: `select (position('v_created_break_id' in ${PS})>0 and position('DELETE FROM dealer_breaks' in ${PS})>0) as ok` },
    { label: "cleanup_stale skips active dealer (guard present)", sql: `select position('COALESCE(fa.swing_due_at, fa.assigned_at)' in ${CLEANUP})>0 as ok` },
  ];
  let allOk = true;
  for (const s of smoke) { const ok = await marker(s); allOk = allOk && ok; log(`  ${ok ? "✓" : "✗"} ${s.label}`); }
  if (!allOk) fail("FINAL SMOKE FAILED — see ✗ above. Roll back via the rollback files (reverse order).");
  log("\n════ PASS: all 4 migrations applied + verified; no new overload; smoke green. schema_migrations recorded. db push / deploy_db NOT used. ════");
}

(async () => {
  if (!ref || !token) { log("no credentials — set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN (GitHub Secrets). Nothing contacted."); process.exit(0); }
  log(`mode=${MODE}`);
  if (MODE === "preflight") { await preflight(); log("preflight complete — READ-ONLY, no changes."); }
  else await apply();
})().catch((e) => fail(mask(e?.message ?? String(e))));
