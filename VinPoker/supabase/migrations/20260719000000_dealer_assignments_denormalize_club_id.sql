-- =============================================================================
-- Migration: Dealer Assignments — Denormalize club_id + Force swing_due_at
--
-- Context:
--   The Pass 3 query in process-swing filtered via `.eq("game_tables.club_id", cid)`
--   but without `!inner`, so PostgREST silently dropped the filter. Assignments
--   from other clubs could starve CTP DC's swings via LIMIT 8.
--
-- This migration:
--   1. Adds `club_id` column to dealer_assignments (denormalized from game_tables)
--   2. Backfills existing rows from game_tables.club_id
--   3. Adds NOT NULL constraint on club_id (data verified clean: 0 missing tables)
--   4. Adds NOT NULL constraint on swing_due_at (data verified clean: 0 NULLs in 30d)
--      The BEFORE INSERT trigger `trg_fallback_swing_due_at` already guarantees
--      new rows are non-NULL, so this constraint is safe to add.
--   5. Adds an index on (club_id, swing_due_at) for the simplified Pass 3 query
--      (no more join needed)
--
-- Companion code changes (handled separately, in same PR):
--   - process-swing/index.ts Pass 3 query: drop game_tables join, use club_id
--   - pass2-pre-assign.ts: same simplification
--   - pass2.5-initial-assign.ts: same simplification
--   - assign-dealer/index.ts: include club_id in INSERT
--   - assign_dealer_to_table RPC: copy club_id from game_tables
--   - perform_swing overload 2 (core): include club_id in INSERT
--   - execute_pre_assigned_swing RPC: include club_id in INSERT
--
-- Pre-flight checks (run before applying this migration):
--   SELECT COUNT(*) FROM dealer_assignments da
--     LEFT JOIN game_tables gt ON gt.id = da.table_id WHERE gt.id IS NULL;
--   → Must be 0
--   SELECT COUNT(*) FROM dealer_assignments WHERE swing_due_at IS NULL
--     AND created_at > NOW() - INTERVAL '30 days';
--   → Must be 0
-- =============================================================================

BEGIN;

-- ─── STEP 1: Add club_id column (nullable first for backfill) ────────────────
ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS club_id UUID
  REFERENCES clubs(id) ON DELETE CASCADE;

COMMENT ON COLUMN dealer_assignments.club_id IS
  'Denormalized from game_tables.club_id. Cached at INSERT time to avoid join in Pass 3 query.';

-- ─── STEP 2: Backfill existing rows ───────────────────────────────────────────
-- Idempotent: only fills rows where club_id is NULL.
UPDATE dealer_assignments da
SET club_id = gt.club_id
FROM game_tables gt
WHERE da.table_id = gt.id
  AND da.club_id IS NULL;

-- ─── STEP 3: Verify backfill completeness ─────────────────────────────────────
-- This DO block raises an exception if any rows still have NULL club_id,
-- preventing the migration from completing with inconsistent data.
DO $$
DECLARE
  v_missing_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_missing_count
  FROM dealer_assignments
  WHERE club_id IS NULL;

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'club_id backfill incomplete: % rows still have NULL club_id. '
      'Investigate orphaned table_id references before re-running.', v_missing_count;
  END IF;
END $$;

-- ─── STEP 4: Add NOT NULL constraint on club_id ───────────────────────────────
ALTER TABLE dealer_assignments
  ALTER COLUMN club_id SET NOT NULL;

-- ─── STEP 5: Add NOT NULL constraint on swing_due_at ──────────────────────────
-- Safe because:
--   1. All 580 rows in last 30 days have non-NULL swing_due_at
--   2. The BEFORE INSERT trigger `trg_fallback_swing_due_at` guarantees
--      future INSERTs are non-NULL
--   3. UPDATEs do not change swing_due_at to NULL (no code path does this)
ALTER TABLE dealer_assignments
  ALTER COLUMN swing_due_at SET NOT NULL;

-- ─── STEP 6: Update trigger to also write club_id ─────────────────────────────
-- The existing trigger trg_fallback_swing_due_at only handles swing_due_at.
-- Add a small companion trigger to populate club_id from game_tables if not set.
-- This is a safety net; the application layer should also set club_id explicitly.
CREATE OR REPLACE FUNCTION trg_fallback_club_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_club_id UUID;
BEGIN
  IF NEW.club_id IS NULL THEN
    SELECT gt.club_id INTO v_club_id
    FROM game_tables gt
    WHERE gt.id = NEW.table_id;

    IF FOUND THEN
      NEW.club_id := v_club_id;
    ELSE
      RAISE WARNING '[fallback_club_id] table_id=% not found in game_tables — assignment will fail NOT NULL',
        NEW.table_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fallback_club_id ON dealer_assignments;
CREATE TRIGGER trg_fallback_club_id
  BEFORE INSERT ON dealer_assignments
  FOR EACH ROW
  EXECUTE FUNCTION trg_fallback_club_id();

COMMENT ON FUNCTION trg_fallback_club_id() IS
  'Safety net: populates club_id from game_tables if INSERT omits it. '
  'Application code should set club_id explicitly; this is for forward-compat.';

-- ─── STEP 7: Index for the new simplified Pass 3 query ────────────────────────
-- Pass 3 will filter by (club_id, status, swing_due_at) without joins.
-- The existing idx_assignments_swing_due uses (swing_due_at) only,
-- so add a covering index for the club-scoped path.
CREATE INDEX IF NOT EXISTS idx_assignments_club_swing_due
  ON dealer_assignments (club_id, swing_due_at)
  WHERE status = 'assigned' AND swing_processed_at IS NULL;

COMMENT ON INDEX idx_assignments_club_swing_due IS
  'Optimized for Pass 3 query: filters by club_id + status without joining game_tables.';

COMMIT;

-- =============================================================================
-- Post-migration verification queries (run manually to confirm):
--
-- 1. All active assignments have club_id:
--    SELECT COUNT(*) FROM dealer_assignments
--      WHERE status = 'assigned' AND club_id IS NULL;
--    → Must be 0
--
-- 2. club_id matches game_tables.club_id (sanity):
--    SELECT da.id, da.club_id, gt.club_id
--    FROM dealer_assignments da
--    JOIN game_tables gt ON gt.id = da.table_id
--    WHERE da.club_id != gt.club_id
--    LIMIT 10;
--    → Must be 0
--
-- 3. swing_due_at is non-NULL for recent active rows:
--    SELECT COUNT(*) FROM dealer_assignments
--      WHERE status = 'assigned' AND swing_due_at IS NULL;
--    → Must be 0
-- =============================================================================
