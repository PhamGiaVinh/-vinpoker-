-- =============================================================================
-- File: cleanup_duplicates_dry_run.sql
-- Purpose: Identify duplicate attendance records in dealer_attendance
-- Usage: psql -f cleanup_duplicates_dry_run.sql > review.txt
-- =============================================================================

\echo '============================================'
\echo 'DUPLICATE ATTENDANCE RECORDS REVIEW'
\echo '============================================'

CREATE TEMP TABLE duplicates_review AS
WITH dup_groups AS (
  SELECT
    da.dealer_id,
    da.shift_date,
    d.full_name,
    d.tier,
    ARRAY_AGG(da.id ORDER BY da.check_in_time, da.created_at) AS record_ids,
    ARRAY_AGG(da.check_in_time ORDER BY da.check_in_time, da.created_at) AS check_ins,
    ARRAY_AGG(da.check_out_time ORDER BY da.check_in_time, da.created_at) AS check_outs,
    ARRAY_AGG(
      ROUND(
        EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, NOW()) - da.check_in_time)) / 3600.0,
        2
      )
      ORDER BY da.check_in_time, da.created_at
    ) AS durations_hours,
    COUNT(*) AS dup_count
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.status = 'checked_out'
    AND da.check_out_time IS NOT NULL
  GROUP BY da.dealer_id, da.shift_date, d.full_name, d.tier
  HAVING COUNT(*) > 1
)
SELECT
  full_name,
  tier,
  shift_date,
  dup_count,
  record_ids,
  check_ins,
  check_outs,
  durations_hours,
  CASE
    WHEN ABS(EXTRACT(EPOCH FROM (check_ins[1] - check_ins[2]))) < 60 THEN
      'TRUE_DUPLICATE'
    WHEN ABS(EXTRACT(EPOCH FROM (check_ins[1] - check_ins[2]))) > 14400 THEN
      'MULTI_SHIFT'
    ELSE
      'UNCERTAIN'
  END AS classification,
  CASE
    WHEN ABS(EXTRACT(EPOCH FROM (check_ins[1] - check_ins[2]))) < 60 THEN
      'DELETE_ID: ' || record_ids[1]::TEXT
    WHEN ABS(EXTRACT(EPOCH FROM (check_ins[1] - check_ins[2]))) > 14400 THEN
      'KEEP_BOTH (legit multi-shift)'
    ELSE
      'MANUAL_REVIEW_NEEDED'
  END AS suggested_action
FROM dup_groups
ORDER BY shift_date DESC, full_name;

\echo ''
\echo '--- Summary by classification ---'

SELECT
  classification,
  COUNT(*) AS count,
  string_agg(full_name || ' (' || shift_date || ')', ', ' ORDER BY shift_date DESC) AS dealers
FROM duplicates_review
GROUP BY classification
ORDER BY
  CASE classification
    WHEN 'TRUE_DUPLICATE' THEN 1
    WHEN 'UNCERTAIN' THEN 2
    WHEN 'MULTI_SHIFT' THEN 3
  END;

\echo ''
\echo '--- Detailed review (ordered by priority) ---'

SELECT
  full_name,
  tier,
  shift_date,
  classification,
  to_char(check_ins[1] AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') AS first_checkin_local,
  to_char(check_ins[2] AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') AS second_checkin_local,
  ROUND(EXTRACT(EPOCH FROM (check_ins[2] - check_ins[1])) / 60.0, 1) AS minutes_between,
  durations_hours[1] AS first_duration_h,
  durations_hours[2] AS second_duration_h,
  suggested_action
FROM duplicates_review
ORDER BY
  CASE classification
    WHEN 'TRUE_DUPLICATE' THEN 1
    WHEN 'UNCERTAIN' THEN 2
    WHEN 'MULTI_SHIFT' THEN 3
  END,
  shift_date DESC;

\echo ''
\echo '============================================'
\echo 'ACTION REQUIRED'
\echo '============================================'
\echo 'Expected: 4 rows total (known duplicates from prior audit)'
\echo '  TRUE_DUPLICATE: Safe to DELETE (check-ins <1min apart)'
\echo '  MULTI_SHIFT:    Keep both (legit separate shifts)'
\echo '  UNCERTAIN:      Manual review needed (1min-4h apart)'
\echo ''
\echo 'Reply with list of record IDs to DELETE.'
\echo '============================================'
