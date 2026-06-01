-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Dealer State Machine + Audit Trail  — CORRECTED
--
-- Fixes from review:
--   [FIX-TYPO]        COALESED → COALESCE in trigger function
--   [FIX-DOUBLE-WRITE] function does NOT INSERT; trigger is single writer
--   [FIX-IN_TRANSITION] documented; used by perform_swing for race prevention
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Audit table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dealer_state_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id   UUID NOT NULL REFERENCES dealer_attendance(id) ON DELETE CASCADE,
  from_state      TEXT NOT NULL,
  to_state        TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_transitions_attendance
  ON dealer_state_transitions(attendance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_state_transitions_created
  ON dealer_state_transitions(created_at DESC);

COMMENT ON TABLE dealer_state_transitions IS
  'Audit log for every dealer attendance state change. '
  'Written exclusively by trg_dealer_state_change trigger. '
  'Do not INSERT directly — use transition_dealer_state() or direct UPDATE.';

-- ── 2. Trigger function — single writer for audit log ─────────────────────────--
-- [FIX-DOUBLE-WRITE] Only the trigger writes to dealer_state_transitions.
-- transition_dealer_state() validates and UPDATEs; the trigger captures it.
CREATE OR REPLACE FUNCTION public.log_dealer_state_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.current_state IS DISTINCT FROM NEW.current_state THEN
    INSERT INTO dealer_state_transitions (attendance_id, from_state, to_state, reason)
    VALUES (
      NEW.id,
      OLD.current_state,
      NEW.current_state,
      COALESCE(
        current_setting('app.state_reason', true),
        'direct_update'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealer_state_change ON dealer_attendance;
CREATE TRIGGER trg_dealer_state_change
  AFTER UPDATE OF current_state ON dealer_attendance
  FOR EACH ROW
  WHEN (OLD.current_state IS DISTINCT FROM NEW.current_state)
  EXECUTE FUNCTION log_dealer_state_change();

COMMENT ON TRIGGER trg_dealer_state_change ON dealer_attendance IS
  'Captures every current_state change regardless of caller. '
  'transition_dealer_state() sets app.state_reason before UPDATE to provide context.';

-- ── 3. Validated transition function ───────────────────────────────────────────
-- [FIX-DOUBLE-WRITE] Function does NOT insert into dealer_state_transitions.
-- It sets app.state_reason session variable, then UPDATEs dealer_attendance.
-- The trigger (above) handles the INSERT.
--
-- Valid transitions:
--   available     → pre_assigned, assigned, in_transition
--   pre_assigned  → assigned, available (available = cancel pre-assign)
--   assigned      → on_break, in_transition, available
--   in_transition → assigned, available, on_break
--   on_break      → available, in_transition
--   swing_ready   → in_transition, available
--
-- in_transition usage:
--   Set at START of perform_swing RPC to lock the dealer during swing.
--   Cleared to 'assigned' (new dealer) or 'on_break' (old dealer) when complete.
--   Prevents race: two processes picking the same dealer simultaneously.

CREATE OR REPLACE FUNCTION public.transition_dealer_state(
  p_attendance_id UUID,
  p_new_state     TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_state TEXT;
  v_valid     BOOLEAN;
BEGIN
  -- Lock row for the duration of this transaction
  SELECT current_state INTO v_old_state
  FROM dealer_attendance
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTENDANCE_NOT_FOUND');
  END IF;

  -- Same state → idempotent no-op
  IF v_old_state = p_new_state THEN
    RETURN jsonb_build_object(
      'ok', true, 'from', v_old_state, 'to', p_new_state, 'noop', true
    );
  END IF;

  -- Validate transition
  v_valid := CASE
    WHEN v_old_state = 'available'     AND p_new_state IN ('pre_assigned','assigned','in_transition')   THEN true
    WHEN v_old_state = 'pre_assigned'  AND p_new_state IN ('assigned','available')                      THEN true
    WHEN v_old_state = 'assigned'      AND p_new_state IN ('on_break','in_transition','available')      THEN true
    WHEN v_old_state = 'in_transition' AND p_new_state IN ('assigned','available','on_break')           THEN true
    WHEN v_old_state = 'on_break'      AND p_new_state IN ('available','in_transition')                 THEN true
    WHEN v_old_state = 'swing_ready'   AND p_new_state IN ('in_transition','available')                 THEN true
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INVALID_TRANSITION',
      'from', v_old_state,
      'to', p_new_state
    );
  END IF;

  -- Set session variable so trigger can log the reason
  PERFORM set_config(
    'app.state_reason',
    COALESCE(p_reason, 'transition_dealer_state'),
    true
  );

  -- Execute transition (trigger will fire and log it)
  UPDATE dealer_attendance
  SET current_state = p_new_state
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object('ok', true, 'from', v_old_state, 'to', p_new_state);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_dealer_state(UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.transition_dealer_state IS
  'Validates and executes a dealer state transition. '
  'Does NOT write to dealer_state_transitions directly; trigger handles audit. '
  'For batch cleanup, use direct UPDATE (trigger still captures it).';

-- ── 4. detect_stuck_breaks() ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_stuck_breaks(p_club_id UUID)
RETURNS TABLE(
  attendance_id UUID,
  dealer_name   TEXT,
  expected_min  INT,
  overdue_min   INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    da.id                     AS attendance_id,
    d.full_name               AS dealer_name,
    db.expected_duration_minutes AS expected_min,
    GREATEST(0,
      EXTRACT(EPOCH FROM (NOW() - db.break_start))::INT / 60
      - db.expected_duration_minutes
    )::INT                    AS overdue_min
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  JOIN dealer_assignments das ON das.attendance_id = da.id
    AND das.status = 'on_break'
  JOIN LATERAL (
    SELECT break_start, expected_duration_minutes
    FROM dealer_breaks
    WHERE assignment_id = das.id
      AND break_end IS NULL
    ORDER BY break_start DESC
    LIMIT 1
  ) db ON true
  WHERE da.current_state = 'on_break'
    AND d.club_id = p_club_id
    AND db.break_start < NOW() - (db.expected_duration_minutes || ' minutes')::INTERVAL;
$$;

GRANT EXECUTE ON FUNCTION public.detect_stuck_breaks(UUID) TO service_role;

-- ── 5. table_priority column ───────────────────────────────────────────────────
ALTER TABLE game_tables
  ADD COLUMN IF NOT EXISTS table_priority INT NOT NULL DEFAULT 3
  CHECK (table_priority BETWEEN 1 AND 5);

COMMENT ON COLUMN game_tables.table_priority IS
  '1 = lowest (close first during shortage), 5 = highest (keep open).';

-- ── Verify ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'transition_dealer_state'
  ), 'transition_dealer_state function missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'dealer_state_transitions'
  ), 'dealer_state_transitions table missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_dealer_state_change'
  ), 'trg_dealer_state_change trigger missing';

  RAISE NOTICE '✓ Migration 20260704000000 passed all assertions';
END;
$$;

COMMIT;
