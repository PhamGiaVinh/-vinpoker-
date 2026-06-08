-- Phase 5 PR #5: Final rollout — cron_execution_log cleanup + performance indexes

-- 1. Schedule cron to purge old cron_execution_log entries (older than 7 days, daily at 3:30 AM)
SELECT cron.schedule(
  'cleanup-cron-execution-log',
  '30 3 * * *',
  $$
  DELETE FROM public.cron_execution_log
  WHERE executed_at < now() - interval '7 days';
  $$
);

-- 2. Add composite index for count_available_dealers query
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_available_lookup
  ON public.dealer_attendance (status, current_state, check_out_time, dealer_id)
  WHERE status = 'checked_in' AND current_state = 'available' AND check_out_time IS NULL;

-- 3. Add index on diagnostic_logs for cleanup query (club_id + created_at)
CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_club_created
  ON public.diagnostic_logs (club_id, created_at DESC);

-- 4. Add index on dealer_assignments for overdue swing detection
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_overdue_swing
  ON public.dealer_assignments (club_id, status, swing_due_at)
  WHERE status = 'assigned' AND released_at IS NULL AND swing_in_progress = false;

COMMENT ON INDEX public.idx_dealer_attendance_available_lookup IS
  'Phase 5 PR #5: Partial composite index for count_available_dealers and canary_health_check queries';
COMMENT ON INDEX public.idx_diagnostic_logs_club_created IS
  'Phase 5 PR #5: Index for diagnostic log queries by club and recency';
COMMENT ON INDEX public.idx_dealer_assignments_overdue_swing IS
  'Phase 5 PR #5: Partial index for Pass 3 overdue swing detection';