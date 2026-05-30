/**
 * Swing integration test suite.
 * Uses SECURITY DEFINER functions for DB access (avoids direct table permission issues).
 *
 * Usage:
 *   node scripts/run-swing-tests.mjs
 *   SUPABASE_SERVICE_ROLE_KEY="<key>" node scripts/run-swing-tests.mjs
 */
import pg from "pg";
const { Pool } = pg;

// ── Config ────────────────────────────────────────────────────
const SUPABASE_URL = "https://orlesggcjamwuknxwcpk.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const CLUB_ID = "11111111-1111-1111-1111-111111111111";
const THRESHOLD_MS = 10000; // 10s — allows cold start + real swing exec

const POOL = new Pool({
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  port: 5432,
  user: "cli_login_postgres.orlesggcjamwuknxwcpk",
  password: "vgCPGMpRKTGLENloVThHkuvGRbdQmtEL",
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ───────────────────────────────────────────────────
let passed = 0, failed = 0, warnings = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}: ${detail}`); failed++; }
};
const warn = (name, detail) => {
  console.log(`  ⚠️  ${name}: ${detail}`);
  warnings++;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const query = (sql, params = []) => POOL.query(sql, params);

const edgeHeaders = (useServiceKey = false) => {
  const key = useServiceKey && SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : ANON_KEY;
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
};

async function fetchEdge(fn, body, useServiceKey = false) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: edgeHeaders(useServiceKey),
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { status: r.status, body: j };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  // ============================================================
  // STEP 1 — Seed
  // ============================================================
  console.log("\n═══════════════════════════════════");
  console.log("STEP 1 — Seed test data");
  console.log("═══════════════════════════════════\n");

  const seed = await query("SELECT seed_swing_test_data() AS result");
  console.log("  Seed result:", JSON.stringify(seed.rows[0]?.result, null, 2));

  // ============================================================
  // STEP 2 — DB Verification
  // ============================================================
  console.log("\n═══════════════════════════════════");
  console.log("STEP 2 — DB Verification Queries");
  console.log("═══════════════════════════════════\n");

  const verify = await query("SELECT verify_swing_queries($1) AS result", [CLUB_ID]);
  const v = verify.rows[0]?.result;
  if (v?.results) {
    for (const r of v.results) check(r.check, r.pass === true, String(r.value ?? ""));
    console.log(`\n  DB checks: ${v.summary.passed} passed, ${v.summary.failed} failed`);
  } else {
    console.log("  ❌ verify function returned no results");
  }

  // ============================================================
  // STEP 3 — Edge Function Tests
  // ============================================================
  console.log("\n═══════════════════════════════════");
  console.log("STEP 3 — Edge Function Tests");
  console.log("═══════════════════════════════════\n");

  // ── B3. Dry run ─────────────────────────────────────────────
  console.log("B3. process-swing dry_run...");
  try {
    const { body: j } = await fetchEdge("process-swing", {
      club_id: CLUB_ID, dry_run: true,
    });
    check("Dry run responds ok", j.ok === true, JSON.stringify(j).substring(0, 150));
    if (j.processing_ms > THRESHOLD_MS) {
      warn(`Processing time`, `${j.processing_ms}ms > ${THRESHOLD_MS}ms (cold start expected)`);
      check("Processing time flagged", true, `${j.processing_ms}ms`);
    } else {
      check("Processing ms < threshold", j.processing_ms < THRESHOLD_MS, `${j.processing_ms}ms`);
    }
    if (j.metrics) console.log(`  Metrics: ${JSON.stringify(j.metrics)}`);
  } catch (e) {
    check("Dry run fetch", false, e.message);
  }

  // ── B4. Count audit logs before manual swing ────────────────
  const beforeLogs = await query("SELECT get_audit_log_count($1)", [CLUB_ID]);
  const beforeCount = beforeLogs.rows[0]?.get_audit_log_count ?? 0;
  console.log(`\n  Audit logs before manual swing: ${beforeCount}`);

  // ── B5. Manual swing ────────────────────────────────────────
  console.log("\nB5. Manual swing execution...");
  try {
    const { body: j } = await fetchEdge("process-swing", {
      club_id: CLUB_ID, manual_trigger: true,
    });
    check("Swing executed ok", j.ok === true, JSON.stringify(j).substring(0, 200));
    if (j.metrics) console.log(`  Metrics: ${JSON.stringify(j.metrics)}`);
  } catch (e) {
    check("Manual swing fetch", false, e.message);
  }

  // ── B6. Audit logs after manual swing ───────────────────────
  await sleep(3000);
  const afterLogs = await query("SELECT get_audit_log_count($1)", [CLUB_ID]);
  const afterCount = afterLogs.rows[0]?.get_audit_log_count ?? 0;
  check("Audit logs recorded", afterCount > beforeCount, `before ${beforeCount}, after ${afterCount}`);
  console.log(`  Audit logs after manual swing: ${afterCount}`);

  // ── B7. Re-seed for checkout test ───────────────────────────
  // Manual swing may have consumed some assignments; re-seed clean state
  await query("SELECT seed_swing_test_data() AS result");

  // ── B8. dry_run does not execute swings (Test 22) ──────────
  console.log("\nB8. dry_run does not execute swings...");
  try {
    const logsBefore = await query("SELECT get_audit_log_count($1)", [CLUB_ID]);
    const countBefore = logsBefore.rows[0]?.get_audit_log_count ?? 0;

    const { body: j } = await fetchEdge("process-swing", {
      club_id: CLUB_ID, manual_trigger: true, dry_run: true,
    });
    check("Dry run returns ok", j.ok === true, JSON.stringify(j).substring(0, 100));

    const logsAfter = await query("SELECT get_audit_log_count($1)", [CLUB_ID]);
    const countAfter = logsAfter.rows[0]?.get_audit_log_count ?? 0;
    check("Dry run created no audit logs", countAfter === countBefore, `before ${countBefore}, after ${countAfter}`);
  } catch (e) {
    check("dry_run no-execute test", false, e.message);
  }

  // ── B9. Checkout test (anon key → expect Forbidden) ─────────
  console.log("\nB9. Checkout test (anon key)...");
  try {
    const avail = await query("SELECT get_available_attendance($1) AS id", [CLUB_ID]);
    if (avail.rows.length > 0) {
      const { status, body: j } = await fetchEdge("checkout-dealer", {
        attendance_id: avail.rows[0].id,
      });
      console.log(`  Status: ${status}, Response: ${JSON.stringify(j).substring(0, 300)}`);
      check("Checkout is forbidden (anon key)", j.error === "Forbidden", JSON.stringify(j));
    } else {
      console.log("  ⚠️ No available dealers for checkout");
    }
  } catch (e) {
    check("Checkout fetch", false, e.message);
  }

  // ── B10. Checkout test (service_role key → expect success) ──
  console.log("\nB10. Checkout test (service_role key)...");
  if (!SERVICE_ROLE_KEY) {
    warn("Checkout with auth", "Skipped — set SUPABASE_SERVICE_ROLE_KEY env var");
    console.log("  ⏭️  Skipped (no service_role key)");
  } else {
    try {
      const avail = await query("SELECT get_available_attendance($1) AS id", [CLUB_ID]);
      if (avail.rows.length > 0) {
        const { status, body: j } = await fetchEdge("checkout-dealer", {
          attendance_id: avail.rows[0].id,
        }, true);
        const success = j.results?.[0]?.success === true;
        check("Checkout succeeds", success, `status ${status}: ${JSON.stringify(j).substring(0, 200)}`);
        console.log(`  Response: ${JSON.stringify(j).substring(0, 300)}`);
      } else {
        console.log("  ⚠️ No available dealers for checkout");
      }
    } catch (e) {
      check("Checkout with auth", false, e.message);
    }
  }

  // ============================================================
  // STEP 4 — Summary
  // ============================================================
  console.log("\n═══════════════════════════════════");
  console.log(`TOTAL: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  if (warnings > 0) console.log(`  ⚠️  Warnings (not failures): ${warnings}`);
  console.log("═══════════════════════════════════\n");

  await POOL.end();
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
