-- supabase/migrations/20260605_idx_assignments_due_swing.sql
-- Partial index for Pass 3 query performance
-- Created before Phase 1 fix to improve query performance from day 1

CREATE INDEX IF NOT EXISTS idx_assignments_due_swing
ON dealer_assignments(club_id, swing_due_at)
WHERE status = 'assigned'
  AND released_at IS NULL
  AND swing_processed_at IS NULL;

ANALYZE dealer_assignments;
