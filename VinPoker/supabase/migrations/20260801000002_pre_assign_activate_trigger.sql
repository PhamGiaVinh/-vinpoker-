-- =============================================================================
-- Migration: Activate pre-assign cleanup trigger
--
-- Bug #5 fix: Activate the trigger on dealer_attendance state transitions
-- to clear pre_assigned_table_id and pre_assigned_at when a dealer leaves
-- the 'pre_assigned' state.
-- Phase 3 of 5-phase deployment.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_cleanup_pre_assign ON dealer_attendance;
DROP TRIGGER IF EXISTS trg_cleanup_pre_assign_selective ON dealer_attendance;

CREATE TRIGGER trg_cleanup_pre_assign_selective
BEFORE UPDATE OF current_state ON dealer_attendance
FOR EACH ROW
WHEN (OLD.current_state = 'pre_assigned'
  AND NEW.current_state != OLD.current_state
  AND (OLD.pre_assigned_table_id IS NOT NULL OR OLD.pre_assigned_at IS NOT NULL))
EXECUTE FUNCTION cleanup_pre_assign_selective();

-- Validate trigger created
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_pre_assign_selective') THEN
    RAISE EXCEPTION 'Migration 3 validation failed: trigger not created';
  END IF;
  RAISE NOTICE 'Migration 3 validated successfully — trigger active';
END;
$$;