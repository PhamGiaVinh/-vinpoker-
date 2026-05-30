-- =============================================================================
-- Cleanup: fix stale assignments stuck on inactive/deleted tables
-- These happened because close-table only matched status='assigned',
-- missing 'on_break' assignments when dealer was sent to break first.
-- =============================================================================

UPDATE dealer_assignments
SET status = 'completed', released_at = now()
WHERE status IN ('assigned', 'on_break')
  AND table_id IN (SELECT id FROM game_tables WHERE status = 'inactive');
