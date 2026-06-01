-- ═══════════════════════════════════════════════════════════════════════════════
-- Backfill: Set overtime_started_at for backlogged assignments
--
-- After deploying the in_transition fix (20260707000001), the next cron tick
-- will process all assignments correctly. But assignments that have been stuck
-- for hours need overtime_started_at populated so:
--   (a) isOtDealer = true → Level 2/3 fallback kicks in next tick if needed
--   (b) OT alerts fire at appropriate intervals
--   (c) All-tables-OT escalation works correctly
--
-- This SQL sets overtime_started_at ≈ swing_due_at for assignments past due
-- by more than 10 minutes. swing_due_at is the closest approximation of when
-- the dealer started accumulating OT.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE dealer_assignments
SET overtime_started_at = swing_due_at
WHERE status = 'assigned'
  AND swing_processed_at IS NULL
  AND swing_due_at < NOW() - INTERVAL '10 minutes'
  AND overtime_started_at IS NULL;

-- Notify how many were backfilled
DO $$
DECLARE
  v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '✓ Backfilled overtime_started_at for % stuck assignments', v_count;
END;
$$;
