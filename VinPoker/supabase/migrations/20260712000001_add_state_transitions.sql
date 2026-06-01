-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Add missing state transitions to transition_dealer_state RPC
--
-- Adds:
--   available     → on_break     (manage-break, enforceBreakBalance)
--   *             → checked_out  (checkout-dealer — terminal state)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Update valid transition matrix ────────────────────────────────────────────
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
  -- New in this migration:
  --   available → on_break       (manage-break, enforceBreakBalance)
  --   *         → checked_out    (checkout-dealer — terminal, exit any active state)
  v_valid := CASE
    WHEN v_old_state = 'available'     AND p_new_state IN ('pre_assigned','assigned','in_transition','on_break','checked_out') THEN true
    WHEN v_old_state = 'pre_assigned'  AND p_new_state IN ('assigned','available','checked_out')                              THEN true
    WHEN v_old_state = 'assigned'      AND p_new_state IN ('on_break','in_transition','available','checked_out')              THEN true
    WHEN v_old_state = 'in_transition' AND p_new_state IN ('assigned','available','on_break','checked_out')                   THEN true
    WHEN v_old_state = 'on_break'      AND p_new_state IN ('available','in_transition','checked_out')                         THEN true
    WHEN v_old_state = 'swing_ready'   AND p_new_state IN ('in_transition','available','checked_out')                         THEN true
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

-- ── Verify ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'transition_dealer_state'
  ), 'transition_dealer_state function missing';

  RAISE NOTICE '✓ Migration 20260712000001 passed all assertions';
END;
$$;

COMMIT;
