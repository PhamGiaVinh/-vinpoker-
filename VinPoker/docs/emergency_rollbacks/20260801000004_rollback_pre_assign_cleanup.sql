-- =============================================================================
-- Migration: EMERGENCY ROLLBACK — Pre-assign cleanup
--
-- Run ONLY if the deployment needs to be reverted.
-- This drops the trigger, function, and index created in Phases 1-3.
--
-- RPC changes (Phase 4) CANNOT be auto-reverted.
-- To revert RPC: manually re-run the CREATE FUNCTION statements from:
--   supabase/migrations/20260719000006_execute_pre_assigned_swing_set_club_id.sql
--
-- Data cleanup (Phase 2) cannot be reverted — pre_assigned fields are
-- already set to NULL and original values are lost.
-- =============================================================================

-- Step 1: Drop trigger
DROP TRIGGER IF EXISTS trg_cleanup_pre_assign_selective ON dealer_attendance;

-- Step 2: Drop trigger function
DROP FUNCTION IF EXISTS cleanup_pre_assign_selective();

-- Step 3: Drop index (concurrently to avoid locking)
DROP INDEX CONCURRENTLY IF EXISTS idx_assignments_stale_priority;

-- Step 4: Revert RPC — MUST BE DONE MANUALLY
-- Re-run the CREATE FUNCTION statements from:
--   supabase/migrations/20260719000006_execute_pre_assigned_swing_set_club_id.sql
-- This migration CANNOT revert RPC changes automatically.

DO $$
BEGIN
  RAISE NOTICE 'Rollback: trigger, function, and index dropped.';
  RAISE NOTICE 'IMPORTANT: RPC must be manually reverted by re-running 20260719000006 migration.';
  RAISE NOTICE 'IMPORTANT: Data cleanup (Phase 2) cannot be reverted — fields are already NULL.';
END;
$$;