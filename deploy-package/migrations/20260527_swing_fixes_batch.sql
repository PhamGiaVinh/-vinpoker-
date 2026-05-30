-- Migration: swing_fixes_batch.sql
-- Date: 2026-05-27
-- Applies all DB-level fixes in one migration file.

-- ════════════════════════════════════════════════════════════════════════════
--  FIX 1: Add pre_assigned_at column for stale cleanup
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS pre_assigned_at TIMESTAMPTZ;

UPDATE dealer_assignments
SET pre_assigned_at = updated_at
WHERE pre_assigned_attendance_id IS NOT NULL
  AND pre_assigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dealer_assignments_pre_assigned_at
  ON dealer_assignments (pre_assigned_at)
  WHERE pre_assigned_attendance_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
--  FIX 2: Swing config table_type + min duration constraints
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE swing_config
  DROP CONSTRAINT IF EXISTS swing_config_table_type_check;

ALTER TABLE swing_config
  ADD CONSTRAINT swing_config_table_type_check
  CHECK (table_type IN ('tournament', 'cash', 'highhand'));

ALTER TABLE swing_config
  DROP CONSTRAINT IF EXISTS swing_config_min_duration_check;

ALTER TABLE swing_config
  ADD CONSTRAINT swing_config_min_duration_check
  CHECK (swing_duration_minutes >= 30);

-- ════════════════════════════════════════════════════════════════════════════
--  FIX 3: Atomic tournament_break_all_tables RPC
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION tournament_break_all_tables(
  p_club_id UUID,
  p_duration_minutes INT DEFAULT 20,
  p_reason TEXT DEFAULT 'tournament_break'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignment RECORD;
  v_affected JSONB := '[]'::JSONB;
  v_break_started_at TIMESTAMPTZ := now();
BEGIN
  FOR v_assignment IN
    SELECT
      da.id AS assignment_id,
      da.attendance_id,
      da.version,
      da.table_id,
      gt.table_name,
      d.full_name,
      d.telegram_user_id,
      d.telegram_username
    FROM dealer_assignments da
    JOIN game_tables gt ON gt.id = da.table_id
    JOIN dealer_attendance datt ON datt.id = da.attendance_id
    JOIN dealers d ON d.id = datt.dealer_id
    WHERE gt.club_id = p_club_id
      AND da.status = 'assigned'
    FOR UPDATE OF da SKIP LOCKED
  LOOP
    UPDATE dealer_assignments
    SET
      status = 'on_break',
      version = v_assignment.version + 1,
      swing_processed_at = v_break_started_at
    WHERE id = v_assignment.assignment_id;

    INSERT INTO dealer_breaks (
      attendance_id, assignment_id, started_at, duration_minutes, reason
    ) VALUES (
      v_assignment.attendance_id,
      v_assignment.assignment_id,
      v_break_started_at,
      p_duration_minutes,
      p_reason
    );

    UPDATE dealer_attendance
    SET current_state = 'on_break'
    WHERE id = v_assignment.attendance_id;

    INSERT INTO audit_logs (
      club_id, action, metadata, created_at
    ) VALUES (
      p_club_id,
      'tournament_break',
      jsonb_build_object(
        'assignment_id', v_assignment.assignment_id,
        'attendance_id', v_assignment.attendance_id,
        'table_name', v_assignment.table_name,
        'duration_minutes', p_duration_minutes
      ),
      now()
    );

    v_affected := v_affected || jsonb_build_array(jsonb_build_object(
      'attendance_id', v_assignment.attendance_id,
      'full_name', v_assignment.full_name,
      'telegram_user_id', v_assignment.telegram_user_id,
      'table_name', v_assignment.table_name
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'affected_dealers', v_affected,
    'count', jsonb_array_length(v_affected),
    'started_at', v_break_started_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION tournament_break_all_tables(UUID, INT, TEXT)
  TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  FIX 4: Index for priority_break_flag lookups
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_dealer_attendance_priority_break
  ON dealer_attendance (priority_break_flag, current_state)
  WHERE priority_break_flag = TRUE;

-- ════════════════════════════════════════════════════════════════════════════
--  FIX 5: Update cron schedule for enforceBreakBalance (5 min)
-- ════════════════════════════════════════════════════════════════════════════

SELECT cron.unschedule('enforce-break-balance')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'enforce-break-balance'
  );

SELECT cron.schedule(
  'enforce-break-balance',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.edge_function_url') || '/enforceBreakBalance',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify the migration worked
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_assignments'
      AND column_name = 'pre_assigned_at'
  ), 'pre_assigned_at column missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'tournament_break_all_tables'
  ), 'tournament_break_all_tables RPC missing';

  RAISE NOTICE 'Migration swing_fixes_batch.sql: all assertions passed';
END;
$$;
