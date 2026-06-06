-- ════════════════════════════════════════════════════════════════════════════
-- Bàn 10 Regression Fix - Smoke Test Suite
--
-- Safe, read-only validation. NO STATE MODIFICATIONS.
-- All phases can be run against production.
--
-- Usage:
--   psql -d vinpoker -f tests/ban10_smoke_test.sql
--
-- Phases:
--   1. Schema verification
--   2. Backfill verification
--   3. dl 10 read-only behavior analysis
--   4. Dry-run calculation (creates and drops test function)
--   5. Post-deploy log verification (run AFTER next cron tick, ~60s)
-- ════════════════════════════════════════════════════════════════════════════

\echo ''
\echo '╔════════════════════════════════════════════════════════╗'
\echo '║  Bàn 10 Regression Fix - Smoke Test Suite             ║'
\echo '║  Phases 1-5: Schema, Backfill, Behavior, Dry-Run, Log  ║'
\echo '╚════════════════════════════════════════════════════════╝'
\echo ''

-- ════════════════════════════════════════════════════════════════════
-- PHASE 1: Schema Verification
-- ════════════════════════════════════════════════════════════════════
\echo '--- Phase 1: Schema Verification ---'
\echo ''

-- Test 1.1: pre_assigned_at column exists
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_assignments' AND column_name = 'pre_assigned_at'
  ) THEN '✅ PASS' ELSE '❌ FAIL' END AS "Test 1.1",
  'pre_assigned_at column exists' AS "Description";

-- Test 1.2: pre_assign_next_dealer_for_table returns rest_deficit_min
SELECT
  CASE WHEN pg_get_function_result(oid)::text LIKE '%rest_deficit_min%'
  THEN '✅ PASS' ELSE '❌ FAIL' END AS "Test 1.2",
  'pre_assign_next_dealer_for_table returns rest_deficit_min' AS "Description"
FROM pg_proc
WHERE proname = 'pre_assign_next_dealer_for_table'
  AND pronamespace = 'public'::regnamespace;

-- Test 1.3: execute_pre_assigned_swing body contains released_at = v_now
SELECT
  CASE WHEN pg_get_functiondef(oid)::text LIKE '%released_at% = v_now%'
  THEN '✅ PASS' ELSE '❌ FAIL' END AS "Test 1.3",
  'execute_pre_assigned_swing sets released_at = v_now' AS "Description"
FROM pg_proc
WHERE proname = 'execute_pre_assigned_swing'
  AND pronamespace = 'public'::regnamespace;

-- Test 1.4: execute_pre_assigned_swing body has version = version + 1
SELECT
  CASE WHEN pg_get_functiondef(oid)::text LIKE '%version% = version + 1%'
  THEN '✅ PASS' ELSE '❌ FAIL' END AS "Test 1.4",
  'execute_pre_assigned_swing increments version' AS "Description"
FROM pg_proc
WHERE proname = 'execute_pre_assigned_swing'
  AND pronamespace = 'public'::regnamespace;

-- Test 1.5: diagnostic_logs schema has diagnostic_type column
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'diagnostic_logs' AND column_name = 'diagnostic_type'
  ) THEN '✅ PASS' ELSE '❌ FAIL' END AS "Test 1.5",
  'diagnostic_logs.diagnostic_type column exists' AS "Description";

\echo ''

-- ════════════════════════════════════════════════════════════════════
-- PHASE 2: Backfill Verification
-- ════════════════════════════════════════════════════════════════════
\echo '--- Phase 2: Backfill Verification ---'
\echo ''

WITH backfill_stats AS (
  SELECT
    COUNT(*) AS total_completed,
    COUNT(*) FILTER (WHERE released_at IS NOT NULL) AS has_released_at,
    COUNT(*) FILTER (WHERE released_at IS NULL AND swing_processed_at IS NOT NULL) AS missing_released_at
  FROM dealer_assignments
  WHERE status = 'completed'
    AND swing_processed_at IS NOT NULL
    AND swing_processed_at > NOW() - INTERVAL '7 days'
)
SELECT
  CASE WHEN missing_released_at = 0 THEN '✅ PASS' ELSE '⚠️ PARTIAL' END AS "Test 2.1",
  CONCAT(has_released_at::text, '/', total_completed::text, ' rows have released_at') AS "Result",
  CASE WHEN missing_released_at > 0
    THEN CONCAT('⚠️ ', missing_released_at::text, ' rows still missing')
    ELSE 'All rows backfilled'
  END AS "Status"
FROM backfill_stats;

\echo ''

-- ════════════════════════════════════════════════════════════════════
-- PHASE 3: Read-Only Behavior Analysis (dl 10)
-- ════════════════════════════════════════════════════════════════════
\echo '--- Phase 3: dl 10 Recent Activity Analysis ---'
\echo ''

WITH dl10_activity AS (
  SELECT
    a.id,
    a.assigned_at,
    a.released_at,
    COALESCE(a.pre_assigned_at, a.assigned_at) AS effective_pre_assign,
    LAG(a.released_at) OVER (ORDER BY a.assigned_at) AS prev_released,
    EXTRACT(EPOCH FROM (
      COALESCE(a.pre_assigned_at, a.assigned_at) -
      LAG(a.released_at) OVER (ORDER BY a.assigned_at)
    )) / 60 AS rest_minutes
  FROM dealer_assignments a
  JOIN dealer_attendance da ON da.id = a.attendance_id
  JOIN dealers d ON d.id = da.dealer_id
  WHERE d.full_name = 'dl 10'
    AND a.assigned_at > NOW() - INTERVAL '24 hours'
    AND a.status IN ('assigned', 'completed')
)
SELECT
  TO_CHAR(assigned_at, 'HH24:MI') AS "Assigned",
  TO_CHAR(prev_released, 'HH24:MI') AS "Prev Released",
  TO_CHAR(effective_pre_assign, 'HH24:MI') AS "Pre-Assigned",
  ROUND(rest_minutes::numeric, 1) AS "Rest (min)",
  CASE
    WHEN rest_minutes IS NULL THEN '⏸️ First'
    WHEN rest_minutes < 10 THEN '⚠️ Should delay'
    ELSE '✅ OK'
  END AS "Status"
FROM dl10_activity
ORDER BY assigned_at DESC
LIMIT 10;

\echo ''
\echo 'ℹ️  Rows with "⚠️ Should delay" prove the fix was needed.'
\echo 'ℹ️  After fix, these should trigger rest_deficit_min > 0 in logs.'
\echo ''

-- ════════════════════════════════════════════════════════════════════
-- PHASE 4: Dry-Run Calculation (creates and drops test function)
-- ════════════════════════════════════════════════════════════════════
\echo '--- Phase 4: Dry-Run Calculation Test ---'
\echo ''

CREATE OR REPLACE FUNCTION test_rest_deficit_calculation(
  p_dealer_id UUID,
  p_last_released_at TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(
  dealer_name TEXT,
  last_released TIMESTAMPTZ,
  rest_minutes INT,
  rest_deficit_min INT,
  would_delay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_released TIMESTAMPTZ;
  v_rest_min INT;
  v_deficit INT;
  v_name TEXT;
BEGIN
  SELECT full_name INTO v_name FROM dealers WHERE id = p_dealer_id;

  IF p_last_released_at IS NULL THEN
    SELECT MAX(a.released_at) INTO v_last_released
    FROM dealer_assignments a
    JOIN dealer_attendance da ON da.id = a.attendance_id
    WHERE da.dealer_id = p_dealer_id
      AND a.released_at IS NOT NULL;
  ELSE
    v_last_released := p_last_released_at;
  END IF;

  IF v_last_released IS NULL THEN
    v_rest_min := 999;
  ELSE
    v_rest_min := EXTRACT(EPOCH FROM (NOW() - v_last_released))::INT / 60;
  END IF;

  v_deficit := GREATEST(0, 10 - v_rest_min);

  RETURN QUERY SELECT
    v_name,
    v_last_released,
    v_rest_min,
    v_deficit,
    v_deficit > 0;
END;
$$;

SELECT
  CASE WHEN would_delay THEN '⚠️ DELAY' ELSE '✅ OK' END AS "Test 4",
  dealer_name AS "Dealer",
  TO_CHAR(last_released, 'HH24:MI:SS') AS "Last Released",
  rest_minutes AS "Rest (min)",
  rest_deficit_min AS "Deficit",
  CASE
    WHEN would_delay THEN CONCAT('Will delay ', rest_deficit_min, ' min')
    ELSE 'No delay needed'
  END AS "Action"
FROM test_rest_deficit_calculation('49ad1e6a-07b8-426c-bdcf-86c64442396b');

DROP FUNCTION test_rest_deficit_calculation;

\echo ''

-- ════════════════════════════════════════════════════════════════════
-- PHASE 5: Post-Deploy Log Verification
-- (Run AFTER next cron tick, ~60 seconds)
-- ════════════════════════════════════════════════════════════════════
\echo '--- Phase 5: Production Log Verification ---'
\echo ''
\echo 'ℹ️  Run this AFTER next cron tick (wait max 60 seconds)'
\echo ''

-- Test 5.1: soft_min_rest_delay logs appearing with rest_deficit_min > 0
WITH recent_delays AS (
  SELECT
    dl.created_at,
    dl.diagnostic_type,
    dl.result->>'dealer_name' AS dealer,
    (dl.result->>'rest_deficit_min')::int AS deficit,
    (dl.result->>'current_rest_min')::int AS current_rest
  FROM diagnostic_logs dl
  WHERE dl.diagnostic_type = 'soft_min_rest_delay'
    AND dl.created_at > NOW() - INTERVAL '30 minutes'
  ORDER BY dl.created_at DESC
  LIMIT 20
),
summary AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE deficit > 0) AS delayed_count
  FROM recent_delays
)
SELECT
  CASE
    WHEN total = 0 THEN '⏸️ PENDING'
    WHEN delayed_count > 0 THEN '✅ PASS'
    ELSE '⚠️ NO DELAYS LOGGED'
  END AS "Test 5.1",
  CONCAT(delayed_count::text, '/', total::text, ' entries have deficit > 0') AS "Result"
FROM summary;

\echo ''
\echo 'Sample delay log entries (most recent 5):'

SELECT
  TO_CHAR(created_at, 'HH24:MI:SS') AS "Time",
  dealer AS "Dealer",
  deficit AS "Deficit (min)",
  current_rest AS "Rest (min)"
FROM (
  SELECT
    dl.created_at,
    dl.result->>'dealer_name' AS dealer,
    (dl.result->>'rest_deficit_min')::int AS deficit,
    (dl.result->>'current_rest_min')::int AS current_rest
  FROM diagnostic_logs dl
  WHERE dl.diagnostic_type = 'soft_min_rest_delay'
    AND dl.created_at > NOW() - INTERVAL '30 minutes'
  ORDER BY dl.created_at DESC
  LIMIT 5
) sample;

\echo ''
\echo '╔════════════════════════════════════════════════════════╗'
\echo '║  Smoke Test Complete                                  ║'
\echo '║  ✅ PASS = working   ❌ FAIL = needs attention         ║'
\echo '║  ⏸️ PENDING = wait for cron tick                      ║'
\echo '║  ⚠️ WARNING = investigate before merge               ║'
\echo '╚════════════════════════════════════════════════════════╝'
