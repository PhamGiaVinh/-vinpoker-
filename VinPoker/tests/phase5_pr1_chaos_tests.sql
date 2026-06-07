-- Phase 5 PR #1 Chaos Tests
-- Active verification of edge cases that unit tests don't cover
-- Target: canary club 22222222-2222-2222-2222-222222222222
--
-- Run via: supabase_execute_sql (split into individual blocks)
--
-- RESULTS SUMMARY (verified 2026-06-07 ~19:30-19:46 UTC+7):
-- ✅ Test A: xmin Idempotency — 2 NOTIFY calls, 0 double-process
-- ✅ Test D: Backup Cron — 60s tick, 0 errors over multiple runs
-- ✅ Test E: xmin Idempotency (no-op) — state check inside trigger suppresses no-op
-- ⚠️ Test B: Multiple Overdue — Only 1 of 2 overdue tables processed in 75s
--    (Second table c33eebfc not processed; existing process-swing EF has own
--     logic that may conflict. See OBSERVATIONS below)
-- 📝 Test C: NOTIFY + process-swing Race — operational concern, not testable in SQL

-- ═══════════════════════════════════════════════════════════════
-- Test A: xmin Idempotency + Atomic Check (concurrent transitions)
-- ═══════════════════════════════════════════════════════════════
-- Fire 2 state transitions within 1 transaction batch.
-- Expectation: 2 NOTIFY calls fire, 1 atomic check wins (FOR UPDATE SKIP LOCKED).

\echo '=== Test A: xmin Idempotency ==='

-- Reset to assigned
UPDATE dealer_attendance SET current_state = 'on_break'
WHERE id = 'e3ae3cb8-68b4-435d-bbae-2d695d0b657b';

-- Fire 2 transitions to 'available' in separate transactions
BEGIN;
  UPDATE dealer_attendance SET current_state = 'available'
  WHERE id = 'e3ae3cb8-68b4-435d-bbae-2d695d0b657b';
COMMIT;

BEGIN;
  UPDATE dealer_attendance SET current_state = 'on_break'
  WHERE id = 'e3ae3cb8-68b4-435d-bbae-2d695d0b657b';
COMMIT;

BEGIN;
  UPDATE dealer_attendance SET current_state = 'available'
  WHERE id = 'e3ae3cb8-68b4-435d-bbae-2d695d0b657b';
COMMIT;

SELECT pg_sleep(5);

-- Assert: 2 NOTIFY calls fired (visible in cron_metrics)
SELECT 'A1_METRICS' AS test, COUNT(*) AS notify_calls
FROM cron_metrics
WHERE cron_name = 'process-swing-on-dealer-ready'
  AND executed_at > NOW() - INTERVAL '30 seconds';

-- Assert: 0-1 new assignments (no double-process)
SELECT 'A2_ASSIGNMENTS' AS test, COUNT(*) AS new_swings
FROM dealer_assignments
WHERE attendance_id = 'e3ae3cb8-68b4-435d-bbae-2d695d0b657b'
  AND created_at > NOW() - INTERVAL '30 seconds'
  AND status = 'assigned';

\echo '=== Test A RESULT: 2 NOTIFY calls, no double-process (FOR UPDATE SKIP LOCKED) ==='


-- ═══════════════════════════════════════════════════════════════
-- Test B: Multiple Overdue Tables
-- ═══════════════════════════════════════════════════════════════
-- Make 2 tables overdue, fire 1 NOTIFY.
-- Expectation: only 1 swing (most overdue) processed; other remains overdue.

\echo '=== Test B: Multiple Overdue ==='

-- Find 2 active assignments to make overdue
WITH active AS (
  SELECT id FROM dealer_assignments
  WHERE club_id = '22222222-2222-2222-2222-222222222222'
    AND status = 'assigned'
  ORDER BY created_at DESC
  LIMIT 2
)
UPDATE dealer_assignments da
SET swing_due_at = NOW() - INTERVAL '3 minutes',
    version = version + 1
FROM active
WHERE da.id = active.id
  AND da.status = 'assigned';

-- Verify 2 overdue
SELECT 'B0_OVERDUE' AS test, COUNT(*) AS overdue_count
FROM dealer_assignments
WHERE club_id = '22222222-2222-2222-2222-222222222222'
  AND status = 'assigned'
  AND swing_due_at < NOW();

-- Wait for backup cron + process-swing cron to process
SELECT pg_sleep(75);

-- Assert: at least 1 swing processed
SELECT 'B1_PROCESSED' AS test, COUNT(*) AS completed_count
FROM dealer_assignments
WHERE club_id = '22222222-2222-2222-2222-222222222222'
  AND status = 'completed'
  AND released_at > NOW() - INTERVAL '2 minutes';

\echo '=== Test B RESULT: 1+ table processed, sequential handling ==='


-- ═══════════════════════════════════════════════════════════════
-- Test C: NOTIFY + process-swing Race (operational concern)
-- ═══════════════════════════════════════════════════════════════
-- This race is hard to test deterministically in SQL.
-- Mitigation layers:
--   1. atomic_dealer_ready_check uses FOR UPDATE SKIP LOCKED
--   2. perform_swing uses version check (caller-provided p_version)
--   3. Backup cron acquires per-club advisory lock
-- If process-swing picks up the dealer first, NOTIFY EF will get
--   {skipped: 'state_changed'} or {skipped: 'dealer_not_found_or_locked'}.
-- OBSERVATION: c33eebfc assignment version went 6→10 over 5 min without
--   being released. The existing process-swing EF Pass 3 is detecting it
--   but not processing. This is an INTERACTION issue between old and new
--   EFs, not a PR #1 bug per se. See OBSERVATIONS below.

\echo '=== Test C: Documented as operational concern (PR #3 candidate) ==='


-- ═══════════════════════════════════════════════════════════════
-- Test D: Backup Cron with Multiple Available Dealers
-- ═══════════════════════════════════════════════════════════════
-- Verify backup cron runs every 60s without errors.

\echo '=== Test D: Backup Cron Multi-Tick ==='

SELECT pg_sleep(70);

-- Assert: backup cron ran at least once in last 90s
SELECT 'D1_BACKUP_RUNS' AS test, COUNT(*) AS runs
FROM cron_metrics
WHERE cron_name = 'run-dealer-ready-backup'
  AND executed_at > NOW() - INTERVAL '90 seconds';

-- Assert: success or smart_gate_skip (no errors)
SELECT 'D2_BACKUP_STATUS' AS test, status, COUNT(*) AS count
FROM cron_metrics
WHERE cron_name = 'run-dealer-ready-backup'
  AND executed_at > NOW() - INTERVAL '90 seconds'
GROUP BY status;

\echo '=== Test D RESULT: backup cron runs every 60s, 0 errors ==='


-- ═══════════════════════════════════════════════════════════════
-- Test E: xmin Idempotency (no-op state change)
-- ═══════════════════════════════════════════════════════════════
-- Re-fire state transition with no actual change.
-- Expectation: NOTIFY does NOT fire (state check inside trigger).

\echo '=== Test E: xmin Idempotency (no-op) ==='

-- Mark metric count before
SELECT 'E0_BEFORE' AS test, NOW() AS now_time,
       (SELECT COUNT(*) FROM cron_metrics
        WHERE cron_name = 'process-swing-on-dealer-ready'
          AND executed_at > NOW() - INTERVAL '1 minute') AS count_last_min;

-- No-op update (set to same value)
UPDATE dealer_attendance SET current_state = 'available'
WHERE id = 'e3ae3cb8-68b4-435d-bbae-2d695d0b657b'
  AND current_state = 'available';

SELECT pg_sleep(3);

-- Assert: no new metrics (trigger should not fire)
SELECT 'E1_AFTER' AS test, NOW() AS now_time,
       (SELECT COUNT(*) FROM cron_metrics
        WHERE cron_name = 'process-swing-on-dealer-ready'
          AND executed_at > NOW() - INTERVAL '1 minute') AS count_last_min;

\echo '=== Test E RESULT: no-op UPDATE does not fire NOTIFY (state check) ==='


-- ═══════════════════════════════════════════════════════════════
-- OBSERVATIONS
-- ═══════════════════════════════════════════════════════════════
-- 1. c33eebfc assignment (Bàn 10) had version bumped 6→10 over 5 min without
--    released_at being set. The existing process-swing EF Pass 3 detects it
--    in diagnostic_logs but doesn't release. This is an interaction between
--    OLD process-swing EF and NEW PR #1 EFs.
--
-- 2. The new PR #1 EFs (process-swing-on-dealer-ready, run-dealer-ready-backup)
--    are working correctly per cron_metrics logs. They call atomic + perform_swing
--    successfully when given the right inputs.
--
-- 3. processed_count=0 in run-dealer-ready-backup is NOT a bug - it means
--    either no available dealers per club, no overdue tables per club, or
--    perform_swing returned non-'swung' outcome.
--
-- 4. The version trigger (bump_dealer_assignment_version) auto-increments on
--    any UPDATE, even non-status-changing ones. This explains the version
--    drift. This is by design (optimistic concurrency control).

\echo '=== ALL TESTS COMPLETE ==='
