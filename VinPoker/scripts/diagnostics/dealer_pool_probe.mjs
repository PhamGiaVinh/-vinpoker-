#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// dealer_pool_probe.mjs — why is a dealer stuck in the pool without assignment?
//
// PURE READ-ONLY. Every query is SELECT/WITH only.
// No credentials in this file. Missing creds → prints env names, exits 0.
// Tokens masked in all output.
//
// Transport: Supabase Management SQL API
//   POST https://api.supabase.com/v1/projects/{ref}/database/query
//
// Required env vars:
//   SUPABASE_PROJECT_REF   = <project ref>
//   SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>
//
// Optional:
//   DEALER_NAME_FILTER = partial name to search (default: pgv)
// ════════════════════════════════════════════════════════════════════════════

const log = (...a) => console.log("[probe]", ...a);
const fail = (...a) => { console.error("[probe] ✗", ...a); process.exit(1); };

function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
}

function assertReadOnly(label, sql) {
  let s = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
  if (!/^\s*(with|select|explain)\b/i.test(s))
    fail(`query "${label}" is not a SELECT/WITH/EXPLAIN`);
  const bad = s.match(
    /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|merge)\b/i
  );
  if (bad) fail(`query "${label}" contains write keyword: ${bad[1]}`);
}

async function run(ref, token, sql) {
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
  } catch (e) {
    fail("network error:", mask(e.message));
  }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const nameFilter = process.env.DEALER_NAME_FILTER || "pgv";

  if (!ref || !token) {
    log("no credentials present — NOTHING contacted. To run, set:");
    log("  SUPABASE_PROJECT_REF   = <project ref>");
    log("  SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>");
    log("  DEALER_NAME_FILTER     = <partial dealer name, default: pgv>");
    process.exit(0);
  }

  // ── 1. Find dealer by name ──────────────────────────────────────────────
  const q1 = `
    SELECT d.id AS dealer_id, d.full_name, d.club_id, d.status AS dealer_status,
           d.tier, d.skills, d.telegram_username
    FROM dealers d
    WHERE d.full_name ILIKE '%${nameFilter}%'
       OR d.telegram_username ILIKE '%${nameFilter}%'
    ORDER BY d.full_name
    LIMIT 10;
  `;
  assertReadOnly("1-find-dealer", q1);

  log("══════════════════════════════════════════════════════════════════");
  log(`1) Searching for dealer matching "${nameFilter}"...`);
  const dealers = await run(ref, token, q1);
  console.log(JSON.stringify(dealers, null, 2));

  if (!dealers || dealers.length === 0) {
    log(`No dealer found matching "${nameFilter}". Check the name spelling.`);
    process.exit(0);
  }

  const dealer = dealers[0];
  const dealerId = dealer.dealer_id;
  const clubId = dealer.club_id;
  log(`Found dealer: ${dealer.full_name} | dealer_id=${dealerId} | club_id=${clubId}`);

  // ── 2. All dealer_attendance rows for this dealer (24h window) ──────────
  const q2 = `
    SELECT da.id AS attendance_id,
           da.current_state,
           da.status,
           da.check_in_time,
           da.check_out_time,
           da.last_released_at,
           da.pool_entered_at,
           da.priority_break_flag,
           da.worked_minutes_since_last_break,
           now() - da.last_released_at AS time_since_release,
           now() - da.pool_entered_at  AS time_since_pool_entry,
           EXTRACT(EPOCH FROM (now() - da.last_released_at))/60 AS minutes_since_release,
           EXTRACT(EPOCH FROM (now() - da.pool_entered_at))/60  AS minutes_since_pool_entry
    FROM dealer_attendance da
    WHERE da.dealer_id = '${dealerId}'
      AND da.check_in_time >= now() - interval '24 hours'
    ORDER BY da.check_in_time DESC
    LIMIT 5;
  `;
  assertReadOnly("2-attendance-rows", q2);

  log("══════════════════════════════════════════════════════════════════");
  log("2) dealer_attendance rows (last 24h) — all guard-relevant fields:");
  const attendance = await run(ref, token, q2);
  console.log(JSON.stringify(attendance, null, 2));

  if (!attendance || attendance.length === 0) {
    log("⚠ No attendance row found in last 24h. Dealer may not be checked in.");
    process.exit(0);
  }

  const att = attendance[0];
  const attId = att.attendance_id;

  // ── 3. Check busy-guard: is dealer in assigned/pre_assigned/in_transition? ──
  const q3 = `
    SELECT da.id AS attendance_id,
           da.current_state,
           da.dealer_id,
           da.check_in_time,
           da.check_out_time
    FROM dealer_attendance da
    WHERE da.dealer_id = '${dealerId}'
      AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition')
      AND da.check_out_time IS NULL
      AND da.check_in_time >= now() - interval '24 hours';
  `;
  assertReadOnly("3-busy-guard", q3);

  log("══════════════════════════════════════════════════════════════════");
  log("3) Busy-guard check — is dealer marked as assigned/pre_assigned/in_transition?");
  const busyRows = await run(ref, token, q3);
  console.log(JSON.stringify(busyRows, null, 2));
  if (busyRows && busyRows.length > 0) {
    log("⚠ BLOCKED: dealer is excluded by busy-guard (has an active assignment state)");
  } else {
    log("✓ busy-guard: NOT excluded (dealer_id not in assigned/pre_assigned/in_transition)");
  }

  // ── 4. Active assignments for this dealer ─────────────────────────────
  const q4 = `
    SELECT asm.id, asm.table_id, asm.status, asm.assigned_at,
           asm.swing_due_at, asm.priority_swing_at, asm.swing_processed_at,
           asm.attendance_id,
           gt.table_name, gt.status AS table_status
    FROM dealer_assignments asm
    LEFT JOIN game_tables gt ON gt.id = asm.table_id
    WHERE asm.attendance_id = '${attId}'
    ORDER BY asm.assigned_at DESC
    LIMIT 5;
  `;
  assertReadOnly("4-active-assignments", q4);

  log("══════════════════════════════════════════════════════════════════");
  log("4) Recent dealer_assignments for this attendance_id:");
  const assignments = await run(ref, token, q4);
  console.log(JSON.stringify(assignments, null, 2));

  // ── 5. Inter-swing rest guard check ──────────────────────────────────
  const q5 = `
    SELECT
      '${attId}' AS attendance_id,
      da.last_released_at,
      now() AS now_ts,
      EXTRACT(EPOCH FROM (now() - da.last_released_at))/60 AS minutes_since_release,
      CASE
        WHEN da.last_released_at IS NULL THEN 'no_last_release (new hire / never released)'
        WHEN now() - da.last_released_at < interval '13 minutes' THEN
          '⚠ BLOCKED by inter-swing rest guard (< 13 min since release)'
        ELSE '✓ inter-swing rest guard: PASSED (>= 13 min since release)'
      END AS rest_guard_status
    FROM dealer_attendance da
    WHERE da.id = '${attId}';
  `;
  assertReadOnly("5-rest-guard", q5);

  log("══════════════════════════════════════════════════════════════════");
  log("5) Inter-swing rest guard (13-min hard cap):");
  const restGuard = await run(ref, token, q5);
  console.log(JSON.stringify(restGuard, null, 2));

  // ── 6. Pool cooldown guard ─────────────────────────────────────────────
  const q6 = `
    SELECT
      '${attId}' AS attendance_id,
      da.pool_entered_at,
      now() AS now_ts,
      EXTRACT(EPOCH FROM (now() - da.pool_entered_at))/60 AS minutes_since_pool_entry,
      CASE
        WHEN da.pool_entered_at IS NULL THEN 'pool_entered_at is NULL — cooldown skipped (new hire / first check-in)'
        WHEN now() - da.pool_entered_at < interval '1 minute' THEN
          '⚠ BLOCKED by pool cooldown guard (< 1 min since pool entry)'
        ELSE '✓ pool cooldown guard: PASSED (>= 1 min since pool entry)'
      END AS pool_cooldown_status
    FROM dealer_attendance da
    WHERE da.id = '${attId}';
  `;
  assertReadOnly("6-pool-cooldown", q6);

  log("══════════════════════════════════════════════════════════════════");
  log("6) Pool cooldown guard (1-min Telegram pre-notify buffer):");
  const poolCooldown = await run(ref, token, q6);
  console.log(JSON.stringify(poolCooldown, null, 2));

  // ── 7. Empty active tables (Pass 1 fillEmptyTables targets) ───────────
  const q7 = `
    SELECT gt.id AS table_id,
           gt.table_name,
           gt.status AS table_status,
           gt.club_id,
           gt.current_blind_level,
           gt.shift_id,
           asm.id AS active_assignment_id,
           asm.status AS assignment_status,
           asm.attendance_id
    FROM game_tables gt
    LEFT JOIN dealer_assignments asm
      ON asm.table_id = gt.id
     AND asm.status IN ('assigned', 'pre_assigned')
    WHERE gt.club_id = '${clubId}'
      AND gt.status = 'active'
    ORDER BY asm.id NULLS FIRST, gt.table_name;
  `;
  assertReadOnly("7-empty-tables", q7);

  log("══════════════════════════════════════════════════════════════════");
  log("7) Active tables for this club (NULL assignment_id = EMPTY = Pass 1 target):");
  const tables = await run(ref, token, q7);
  console.log(JSON.stringify(tables, null, 2));

  const emptyTables = (tables || []).filter(t => t.active_assignment_id === null);
  const occupiedTables = (tables || []).filter(t => t.active_assignment_id !== null);
  log(`Total active tables: ${(tables || []).length}`);
  log(`Empty (no assignment): ${emptyTables.length}${emptyTables.length > 0 ? " — Pass 1 should fill these!" : ""}`);
  log(`Occupied (has assignment): ${occupiedTables.length}`);

  // ── 8. Upcoming swing windows (Pass 1.5 targets) ──────────────────────
  const q8 = `
    SELECT asm.id AS assignment_id,
           asm.table_id,
           gt.table_name,
           asm.status,
           asm.swing_due_at,
           asm.pre_assigned_attendance_id,
           now() AS now_ts,
           asm.swing_due_at - now() AS time_until_swing,
           EXTRACT(EPOCH FROM (asm.swing_due_at - now()))/60 AS minutes_until_swing
    FROM dealer_assignments asm
    JOIN game_tables gt ON gt.id = asm.table_id
    WHERE gt.club_id = '${clubId}'
      AND asm.status = 'assigned'
      AND asm.swing_due_at IS NOT NULL
      AND asm.swing_processed_at IS NULL
      AND asm.swing_due_at BETWEEN now() + interval '60 seconds' AND now() + interval '15 minutes'
    ORDER BY asm.swing_due_at ASC;
  `;
  assertReadOnly("8-swing-windows", q8);

  log("══════════════════════════════════════════════════════════════════");
  log("8) Tables with swing_due_at in next 15min (Pass 1.5 rotation planner targets):");
  const swingWindows = await run(ref, token, q8);
  console.log(JSON.stringify(swingWindows, null, 2));
  log(`Swing windows in next 15min: ${(swingWindows || []).length}`);

  // ── 9. swing_config for this club ─────────────────────────────────────
  const q9 = `
    SELECT *
    FROM swing_configs
    WHERE club_id = '${clubId}'
    ORDER BY scope_type, created_at
    LIMIT 20;
  `;
  assertReadOnly("9-swing-config", q9);

  log("══════════════════════════════════════════════════════════════════");
  log("9) swing_config for this club:");
  const swingConfig = await run(ref, token, q9);
  console.log(JSON.stringify(swingConfig, null, 2));

  // ── 10. dealer_shift_metrics for this attendance ───────────────────────
  const q10 = `
    SELECT *
    FROM dealer_shift_metrics
    WHERE attendance_id = '${attId}'
    LIMIT 5;
  `;
  assertReadOnly("10-shift-metrics", q10);

  log("══════════════════════════════════════════════════════════════════");
  log("10) dealer_shift_metrics for this attendance (scoring inputs):");
  const metrics = await run(ref, token, q10);
  console.log(JSON.stringify(metrics, null, 2));

  // ── 11. Other available dealers in this club right now ─────────────────
  const q11 = `
    SELECT da.id AS attendance_id,
           d.full_name,
           d.tier,
           da.current_state,
           da.priority_break_flag,
           da.last_released_at,
           da.pool_entered_at,
           EXTRACT(EPOCH FROM (now() - da.last_released_at))/60 AS minutes_since_release,
           EXTRACT(EPOCH FROM (now() - da.pool_entered_at))/60  AS minutes_since_pool_entry,
           dsm.total_assignments,
           dsm.minutes_since_rest
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = da.id
    WHERE d.club_id = '${clubId}'
      AND da.current_state IN ('available', 'on_break')
      AND da.status = 'checked_in'
      AND da.check_out_time IS NULL
      AND da.check_in_time >= now() - interval '24 hours'
    ORDER BY da.last_released_at ASC NULLS FIRST
    LIMIT 20;
  `;
  assertReadOnly("11-available-pool", q11);

  log("══════════════════════════════════════════════════════════════════");
  log("11) All available/on_break dealers in pool right now:");
  const pool = await run(ref, token, q11);
  console.log(JSON.stringify(pool, null, 2));
  log(`Total in available pool: ${(pool || []).length}`);

  // ── 12. SUMMARY ────────────────────────────────────────────────────────
  log("══════════════════════════════════════════════════════════════════");
  log("SUMMARY:");
  log(`  Dealer: ${dealer.full_name} (${dealer.tier})`);
  log(`  Attendance ID: ${attId}`);
  log(`  Current state: ${att.current_state}`);
  log(`  Priority break flag: ${att.priority_break_flag}`);
  log(`  Minutes since last release: ${att.minutes_since_release ? Number(att.minutes_since_release).toFixed(1) : "N/A (never released)"}`);
  log(`  Minutes since pool entry: ${att.minutes_since_pool_entry ? Number(att.minutes_since_pool_entry).toFixed(1) : "N/A"}`);
  log(`  Empty tables needing fill: ${emptyTables.length}`);
  log(`  Upcoming swing windows: ${(swingWindows || []).length}`);
  log("");
  log("  POSSIBLE REASONS NOT ASSIGNED:");
  if (att.current_state !== "available") {
    log(`  ❌ current_state='${att.current_state}' — dealer not in 'available' state`);
  }
  if (att.priority_break_flag) {
    log("  ❌ priority_break_flag=true — dealer flagged for priority break (-500 penalty)");
  }
  if (att.minutes_since_release !== null && Number(att.minutes_since_release) < 13) {
    log(`  ❌ inter-swing rest guard: only ${Number(att.minutes_since_release).toFixed(1)}min since release (need 13min)`);
  }
  if (emptyTables.length === 0 && (swingWindows || []).length === 0) {
    log("  ❌ No empty tables AND no swing windows — dealer is waiting for a rotation event");
    log("     → All tables occupied; dealer enters rotation when a swing_due_at fires");
  }
  if (busyRows && busyRows.length > 0) {
    log("  ❌ Busy-guard: dealer has active assigned/pre_assigned state row → excluded as 'busy'");
  }
  log("");
  log("probe done (read-only).");
}

main().catch((e) => fail(mask(e?.message ?? String(e))));
