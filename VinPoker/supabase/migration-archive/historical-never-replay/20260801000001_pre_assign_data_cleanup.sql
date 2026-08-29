-- =============================================================================
-- Migration: Pre-assign data cleanup
--
-- Bug #5 fix: One-time cleanup of stale pre_assigned fields on dealer_attendance
-- rows where current_state = 'assigned' but pre_assigned_table_id/at are still set.
-- Phase 2 of 5-phase deployment.
--
-- Safety guards:
--   - version < 1000000: Prevents CAS overflow conflict
--   - last_updated_at < NOW() - 5min: Only clean rows older than 5 minutes
--   - statement_timeout = 30s: Prevents long-running cleanup
--   - No version increment: Avoids CAS race with concurrent Edge Function updates
-- =============================================================================

SET statement_timeout = '30s';

DO $$
DECLARE
  cleanup_count INTEGER;
BEGIN
  UPDATE dealer_attendance
  SET pre_assigned_table_id = NULL,
      pre_assigned_at = NULL,
      last_updated_at = NOW()
  WHERE current_state = 'assigned'
    AND (pre_assigned_table_id IS NOT NULL OR pre_assigned_at IS NOT NULL)
    AND last_updated_at < NOW() - INTERVAL '5 minutes'
    AND version < 1000000;

  GET DIAGNOSTICS cleanup_count = ROW_COUNT;
  RAISE NOTICE 'Cleaned % stale pre_assigned fields', cleanup_count;

  IF cleanup_count > 10 THEN
    RAISE WARNING 'Large cleanup: % records — manual review recommended', cleanup_count;
  END IF;
END;
$$;

RESET statement_timeout;