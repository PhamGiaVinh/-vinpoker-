-- =============================================================================
-- Migration: Pre-assign cleanup infrastructure
--
-- Bug #5 fix: Index + trigger function for defense-in-depth pre_assigned field cleanup.
-- Phase 1 of 5-phase deployment.
--
-- Components:
--   1A. Partial index for stale pre-assignment queries
--   1B. Statistics update + enhanced validation (with schema filter)
--   1D. Trigger function (not yet activated — that's Phase 3)
-- =============================================================================

-- 1A. Create partial index (non-blocking, concurrent)
SET statement_timeout = '60s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignments_stale_priority
ON dealer_assignments(status, pre_assigned_at, swing_due_at)
WHERE pre_assigned_attendance_id IS NOT NULL;

RESET statement_timeout;

-- 1B. Update statistics
ANALYZE dealer_assignments;

-- 1C. Validate index creation
DO $$
DECLARE
  idx_exists BOOLEAN;
  idx_valid BOOLEAN;
  idx_size BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_assignments_stale_priority'
  ) INTO idx_exists;

  IF NOT idx_exists THEN
    RAISE EXCEPTION 'Index creation failed or timed out!';
  END IF;

  SELECT i.indisvalid INTO idx_valid
  FROM pg_index i
  JOIN pg_class c ON i.indexrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE c.relname = 'idx_assignments_stale_priority'
    AND n.nspname = 'public';

  IF idx_valid = false OR idx_valid IS NULL THEN
    RAISE EXCEPTION 'Index created but marked invalid — may need rebuild';
  END IF;

  SELECT pg_relation_size('idx_assignments_stale_priority') INTO idx_size;
  RAISE NOTICE 'Index validated successfully. Size: % bytes', idx_size;
END;
$$;

-- 1D. Create trigger function (not activated yet — activated in Phase 3)
CREATE OR REPLACE FUNCTION cleanup_pre_assign_selective()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.current_state = 'pre_assigned'
     AND NEW.current_state IN ('assigned', 'available', 'on_break', 'in_transition')
     AND (OLD.pre_assigned_table_id IS NOT NULL OR OLD.pre_assigned_at IS NOT NULL) THEN
    NEW.pre_assigned_table_id := NULL;
    NEW.pre_assigned_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;