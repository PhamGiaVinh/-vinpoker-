-- ═══════════════════════════════════════════════════════════════════════════════
-- PATCH H dry-run — read-only counts of what reconcile_dealer_states WILL touch
--                   on its first successful run after the ambiguity fix.
--
-- Purpose: reconcile_dealer_states (OID 150751) has thrown on every cron tick
-- (`column reference "id" is ambiguous`), so it has been a complete no-op. PATCH H
-- makes it run for real. Run these SELECTs BEFORE applying PATCH H to learn the
-- size of the accumulated drift it will clear on first execution. None of these
-- statements mutate data — they mirror each step's WHERE clause as a COUNT.
--
-- Replace :club_id with the target club UUID (run once per active club). The two
-- live clubs seen in logs are:
--   11111111-1111-1111-1111-111111111111
--   22222222-2222-2222-2222-222222222222
-- Run via the Management API SQL executor (read-only). Review counts, then approve apply.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: available + has active assigned → would flip to 'assigned' ──────────
SELECT 'step1_fixed_available' AS step, COUNT(*) AS rows
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND da.status = 'checked_in'
  AND da.current_state = 'available'
  AND EXISTS (
    SELECT 1 FROM dealer_assignments dass
    WHERE dass.attendance_id = da.id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
  );

-- ── STEP 1.5: orphan on_break/pre_assigned at a DIFFERENT table while assigned ──
--    (this is one of the two statements the ambiguity bug was blocking)
SELECT 'step1_5_orphan_other_table' AS step, COUNT(*) AS rows
FROM dealer_assignments dass
JOIN dealer_attendance da ON da.id = dass.attendance_id
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND da.status = 'checked_in'
  AND dass.status IN ('on_break', 'pre_assigned')
  AND dass.released_at IS NULL
  AND EXISTS (
    SELECT 1 FROM dealer_assignments dass2
    WHERE dass2.attendance_id = da.id
      AND dass2.id != dass.id
      AND dass2.status = 'assigned'
      AND dass2.released_at IS NULL
      AND dass2.table_id != dass.table_id
  );

-- ── STEP 1.6: dangling on_break/pre_assigned for an available dealer, age >2min ─
--    (the other statement the ambiguity bug was blocking; overlaps Pass 0c step 4b)
SELECT 'step1_6_dangling_available' AS step, COUNT(*) AS rows
FROM dealer_assignments dass
JOIN dealer_attendance da ON da.id = dass.attendance_id
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND da.status = 'checked_in'
  AND da.current_state = 'available'
  AND dass.status IN ('on_break', 'pre_assigned')
  AND dass.released_at IS NULL
  AND dass.assigned_at < NOW() - INTERVAL '2 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM dealer_assignments dass2
    WHERE dass2.attendance_id = da.id
      AND dass2.status = 'assigned'
      AND dass2.released_at IS NULL
  );

-- ── STEP 2: assigned but NO active assigned row → would flip to 'available' ─────
SELECT 'step2_fixed_assigned' AS step, COUNT(*) AS rows
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND da.status = 'checked_in'
  AND da.current_state = 'assigned'
  AND NOT EXISTS (
    SELECT 1 FROM dealer_assignments dass
    WHERE dass.attendance_id = da.id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
  );

-- ── STEP 3: pre_assigned with NO assignment reference (B6) → 'available' ────────
SELECT 'step3_pre_assigned_orphan' AS step, COUNT(*) AS rows
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND da.status = 'checked_in'
  AND da.current_state = 'pre_assigned'
  AND NOT EXISTS (
    SELECT 1 FROM dealer_assignments dass
    WHERE dass.attendance_id = da.id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM dealer_assignments dass
    WHERE dass.pre_assigned_attendance_id = da.id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
  );

-- ── STEP 4: pre_assigned stale (dual-clock: pre_assigned_at >15min AND swing overdue >10min) ──
--    PATCH H v2: was `pre_assigned_at < NOW() - 30 seconds` — too aggressive, released valid
--    active pre-assigns. New guard requires BOTH the reservation AND the swing itself to be stale.
SELECT 'step4_pre_assigned_timeout' AS step, COUNT(*) AS rows
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND da.status = 'checked_in'
  AND da.current_state = 'pre_assigned'
  AND da.pre_assigned_at < NOW() - INTERVAL '15 minutes'
  AND EXISTS (
    SELECT 1 FROM dealer_assignments dass
    WHERE dass.pre_assigned_attendance_id = da.id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
      AND dass.swing_due_at < NOW() - INTERVAL '10 minutes'
  );

-- ── STEP 5: assigned rows carrying an orphaned pre_assigned_attendance_id ───────
SELECT 'step5_cleared_orphaned_pointer' AS step, COUNT(*) AS rows
FROM dealer_assignments dass
JOIN dealer_attendance da ON da.id = dass.attendance_id
JOIN dealers d ON d.id = da.dealer_id
WHERE d.club_id = :club_id
  AND dass.status = 'assigned'
  AND dass.released_at IS NULL
  AND dass.pre_assigned_attendance_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dealer_attendance da2
    WHERE da2.id = dass.pre_assigned_attendance_id
      AND da2.current_state = 'pre_assigned'
  );

-- Interpretation:
--   All-zero  → safe to apply; revived reconcile will be a no-op this tick.
--   Non-zero  → expected first-run cleanup; confirm the numbers are plausible for
--               the current pool size before approving apply. Steps 1.6 may be
--               near-zero already because Pass 0c step 4b has been compensating.
--
-- PATCH H v2 note: STEP 4 now requires BOTH da.pre_assigned_at > 15 min AND
--   dass.swing_due_at overdue > 10 min. Dry-run (2026-06-11) showed old 30s
--   threshold would have returned 1 (dl 18, valid active pre-assign). New
--   condition returns 0. If STEP 4 is still non-zero, inspect sample rows:
--   any row here should be a genuinely stale swing (both clocks expired).
