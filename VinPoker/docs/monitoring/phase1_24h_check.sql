-- docs/monitoring/phase1_24h_check.sql
-- Phase 1 monitoring queries — run 24-48h after deploy
-- Expected: all 3 queries return empty/zero results

-- ═══════════════════════════════════════════════════════════════════
-- Query 1: Stuck pre-assigned assignments (run every 2-4 hours)
-- Expected: stuck_count = 0
-- ═══════════════════════════════════════════════════════════════════
SELECT
  COUNT(*) as stuck_count,
  MIN(swing_due_at) as oldest_stuck,
  array_agg(DISTINCT table_id) as affected_tables
FROM dealer_assignments
WHERE status = 'assigned'
  AND pre_assigned_attendance_id IS NOT NULL
  AND swing_due_at < NOW() - INTERVAL '5 minutes'
  AND released_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- Query 2: Diagnostic confirmed bugs (run after 24h)
-- Expected: 0 rows
-- ═══════════════════════════════════════════════════════════════════
SELECT
  timestamp,
  club_id,
  result->>'confirmed_bug' as confirmed_bug,
  result->>'lost_rows' as lost_rows,
  result->'simple_query'->>'count' as simple_count,
  result->'nested_query'->>'data_length' as nested_count
FROM diagnostic_logs
WHERE diagnostic_type = 'pass3_query_issue'
  AND timestamp > NOW() - INTERVAL '24 hours'
  AND (
    (result->>'confirmed_bug')::boolean = true
    OR (result->>'lost_rows')::int > 0
  )
ORDER BY timestamp DESC;

-- ═══════════════════════════════════════════════════════════════════
-- Query 3: Pass 3 execution consistency (run after 24h)
-- Expected: consistent runs every hour, no missing hours
-- ═══════════════════════════════════════════════════════════════════
SELECT
  date_trunc('hour', timestamp) as hour,
  COUNT(*) as diagnostic_runs,
  AVG((result->'simple_query'->>'count')::int) as avg_assignments_found,
  MAX((result->'simple_query'->>'count')::int) as max_assignments,
  MIN((result->'simple_query'->>'count')::int) as min_assignments
FROM diagnostic_logs
WHERE diagnostic_type = 'pass3_query_issue'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- ═══════════════════════════════════════════════════════════════════
-- Query 4: Diagnostic log total count (sanity check)
-- Expected: ~720 rows per day (60 cycles × 2 clubs × 6 hours)
-- ═══════════════════════════════════════════════════════════════════
SELECT
  date_trunc('day', created_at) as day,
  COUNT(*) as log_count,
  pg_size_pretty(pg_total_relation_size('diagnostic_logs')) as table_size
FROM diagnostic_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day DESC;
