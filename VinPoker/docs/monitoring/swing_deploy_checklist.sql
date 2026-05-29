-- ═══════════════════════════════════════════════════════════════════════════════
-- Post-deploy Monitoring: Auto-swing enable verification
-- Date: 2026-05-29 | Club: Hanoi Royal
--
-- Run these queries after the next 2 cron cycles (approx 20:06 and 21:06)
-- to confirm the system is working correctly.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Query 1: Latest swing outcomes ──────────────────────────────────────────
-- Expected: action='swing_executed' entries, error_message IS NULL
SELECT id, club_id, table_id, action, details, error_message, created_at
FROM swing_audit_logs
WHERE club_id = '22222222-2222-2222-2222-222222222222'
  AND action = 'swing_executed'
ORDER BY created_at DESC
LIMIT 20;

-- ── Query 2: All active assignments with swing_due_at ───────────────────────
-- Expected: swing_due_at values should be consistent (same HH:MM) within batch
SELECT da.id, da.swing_due_at, da.status, da.pre_assigned_attendance_id,
       da.overtime_started_at, da.version,
       gt.table_name, d.full_name AS dealer
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
JOIN dealer_attendance datt ON datt.id = da.attendance_id
JOIN dealers d ON d.id = datt.dealer_id
WHERE gt.club_id = '22222222-2222-2222-2222-222222222222'
  AND da.status = 'assigned'
ORDER BY da.swing_due_at;

-- ── Query 3: Dealer pool state ──────────────────────────────────────────────
-- Expected: most dealers 'available', few 'assigned', some 'on_break'
SELECT datt.current_state, COUNT(*) AS count
FROM dealer_attendance datt
JOIN dealers d ON d.id = datt.dealer_id
WHERE d.club_id = '22222222-2222-2222-2222-222222222222'
GROUP BY datt.current_state
ORDER BY datt.current_state;

-- ── Query 4: Overtime tracking (should be 0 under normal conditions) ─────────
SELECT COUNT(*) AS overtime_count
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
WHERE gt.club_id = '22222222-2222-2222-2222-222222222222'
  AND da.status = 'assigned'
  AND da.overtime_started_at IS NOT NULL;

-- ── Query 5: Pre-assigned swings (should reflect Pass 2 pre-announce) ────────
SELECT da.id, gt.table_name, d.full_name AS outgoing,
       da.pre_assigned_attendance_id, da.swing_due_at
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
JOIN dealer_attendance datt ON datt.id = da.attendance_id
JOIN dealers d ON d.id = datt.dealer_id
WHERE gt.club_id = '22222222-2222-2222-2222-222222222222'
  AND da.status = 'assigned'
  AND da.pre_assigned_attendance_id IS NOT NULL;
