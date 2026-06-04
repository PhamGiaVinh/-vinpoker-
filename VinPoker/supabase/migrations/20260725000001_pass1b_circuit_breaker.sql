-- ═══════════════════════════════════════════════════════════════════════════
-- Pass 1b Circuit Breaker + Club Processing Locks v8.1
-- Date: 2026-07-25
--
-- Changes:
--   1. club_processing_locks table (idempotent — CREATE IF NOT EXISTS)
--   2. locked_by column (ADD IF NOT EXISTS for existing table)
--   3. last_critical_alert_at column on clubs (ADD IF NOT EXISTS)
--   4. try_acquire_club_lock — jsonb return, ON CONFLICT DO NOTHING, dynamic timeout
--   5. release_club_lock — delete lock
--   6. cleanup_expired_club_locks — hourly pg_cron job
--   7. GRANTs for service_role
--   8. Partial index for Pass 1b stale query
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- Part 1: Transactional changes
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

-- 1. Create/update club processing locks table
CREATE TABLE IF NOT EXISTS club_processing_locks (
  club_id uuid PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT NOW(),
  locked_by text NOT NULL DEFAULT 'process-swing',
  expires_at timestamptz NOT NULL
);

-- Add locked_by column if table exists without it
ALTER TABLE club_processing_locks ADD COLUMN IF NOT EXISTS locked_by text NOT NULL DEFAULT 'process-swing';

CREATE INDEX IF NOT EXISTS idx_club_processing_locks_expires
  ON club_processing_locks (expires_at);

-- 2. Add alert throttle column to clubs
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS last_critical_alert_at timestamptz;

-- 3. Lock acquisition function (plpgsql + ON CONFLICT DO NOTHING)
--    Returns jsonb {acquired: true/false} instead of nullable boolean
CREATE OR REPLACE FUNCTION try_acquire_club_lock(
  p_club_id uuid,
  p_timeout_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := NOW();
  v_lock_id uuid;
BEGIN
  -- Cleanup expired locks first (no buffer - immediate cleanup)
  DELETE FROM club_processing_locks WHERE expires_at < v_now;

  -- Try to acquire lock (DO NOTHING if already locked)
  INSERT INTO club_processing_locks (club_id, locked_by, expires_at)
  VALUES (
    p_club_id,
    'process-swing',
    v_now + (p_timeout_seconds || ' seconds')::interval
  )
  ON CONFLICT (club_id) DO NOTHING
  RETURNING club_id INTO v_lock_id;

  IF v_lock_id IS NOT NULL THEN
    RETURN jsonb_build_object('acquired', true);
  ELSE
    RETURN jsonb_build_object('acquired', false);
  END IF;
END;
$$;

-- 4. Lock release function
CREATE OR REPLACE FUNCTION release_club_lock(p_club_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM club_processing_locks WHERE club_id = p_club_id;
$$;

-- 5. Cleanup expired locks (no buffer - pg_cron hourly is sufficient)
CREATE OR REPLACE FUNCTION cleanup_expired_club_locks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM club_processing_locks WHERE expires_at < NOW();
$$;

-- 6. Schedule cleanup with pg_cron
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule old job if exists
    BEGIN
      PERFORM cron.unschedule('cleanup-locks-pass1b');
      RAISE NOTICE 'pg_cron: unscheduled old job';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron: unschedule skipped (OK)';
    END;

    -- Schedule new job (hourly)
    BEGIN
      PERFORM cron.schedule(
        'cleanup-locks-pass1b',
        '0 * * * *',
        $cron$SELECT cleanup_expired_club_locks()$cron$
      );
      RAISE NOTICE 'pg_cron: scheduled cleanup-locks-pass1b (hourly)';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pg_cron: schedule FAILED - %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron not available - cleanup in try_acquire_club_lock';
  END IF;
END;
$outer$;

-- 7. Grant permissions
GRANT EXECUTE ON FUNCTION try_acquire_club_lock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION release_club_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_club_locks() TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Part 2: Concurrent index (cannot run in transaction)
-- ─────────────────────────────────────────────────────────────────────────

-- Drop old index if exists (safe - CONCURRENTLY drops without blocking)
DROP INDEX CONCURRENTLY IF EXISTS idx_dealer_assignments_pass1b_stale;

-- Create with correct definition: table_id first for .in() queries,
-- swing_due_at DESC for .lt() ordering, INCLUDE for index-only scan
CREATE INDEX CONCURRENTLY idx_dealer_assignments_pass1b_stale
  ON dealer_assignments (table_id, swing_due_at DESC)
  INCLUDE (id, pre_assigned_attendance_id, pre_assigned_at, version)
  WHERE status = 'assigned'
    AND pre_assigned_attendance_id IS NOT NULL;