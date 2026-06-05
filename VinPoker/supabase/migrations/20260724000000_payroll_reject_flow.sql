BEGIN;

-- =============================================================================
-- Payroll Reject Flow Migration
--
-- Adds reject columns to payroll_periods and extends the
-- transition_payroll_status RPC to support the new 'rejected' state.
--
-- Changes:
--   1. Add rejected_by, rejected_at, rejection_reason columns
--   2. Update chk_payroll_status to include 'rejected'
--   3. Replace transition_payroll_status RPC with reject support
-- =============================================================================

-- 1. Add reject columns
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Update status check constraint
ALTER TABLE payroll_periods
  DROP CONSTRAINT IF EXISTS chk_payroll_status,
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft', 'submitted', 'approved', 'locked', 'rejected'));

-- 3. Extend transition_payroll_status RPC
CREATE OR REPLACE FUNCTION transition_payroll_status(
  p_period_id UUID,
  p_expected_status TEXT,
  p_new_status TEXT,
  p_user_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- Lock the row
  SELECT status INTO v_current_status
  FROM payroll_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;

  -- Validate current status matches expectation
  IF v_current_status != p_expected_status THEN
    RAISE EXCEPTION 'Expected status %, but current status is %',
      p_expected_status, v_current_status;
  END IF;

  -- Apply transition based on target status
  IF p_new_status = 'rejected' THEN
    -- submitted -> rejected: store reject metadata
    UPDATE payroll_periods
    SET status = 'rejected',
        rejected_by = p_user_id,
        rejected_at = now(),
        rejection_reason = COALESCE(p_rejection_reason, ''),
        updated_at = now()
    WHERE id = p_period_id;
  ELSIF p_new_status = 'draft' THEN
    -- rejected -> draft: clear reject metadata (resubmit flow)
    UPDATE payroll_periods
    SET status = 'draft',
        rejected_by = NULL,
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_period_id;
  ELSIF p_new_status = 'submitted' THEN
    -- draft -> submitted OR rejected -> submitted (resubmit)
    UPDATE payroll_periods
    SET status = 'submitted',
        submitted_by = p_user_id,
        submitted_at = now(),
        rejected_by = NULL,
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_period_id;
  ELSIF p_new_status = 'approved' THEN
    -- submitted -> approved
    UPDATE payroll_periods
    SET status = 'approved',
        approved_by = p_user_id,
        approved_at = now(),
        updated_at = now()
    WHERE id = p_period_id;
  ELSIF p_new_status = 'locked' THEN
    -- approved -> locked
    UPDATE payroll_periods
    SET status = 'locked',
        locked_by = p_user_id,
        locked_at = now(),
        updated_at = now()
    WHERE id = p_period_id;
  ELSE
    RAISE EXCEPTION 'Unsupported target status: %', p_new_status;
  END IF;

  RETURN TRUE;
END;
$$;

-- Grant execute to authenticated (same as original)
GRANT EXECUTE ON FUNCTION transition_payroll_status TO authenticated;

COMMIT;

-- =============================================================================
-- VERIFY (run manually in Supabase SQL editor before Wave 3):
--
-- 1. Get a draft period id:
--    SELECT id, status FROM payroll_periods WHERE status = 'draft' LIMIT 1;
--
-- 2. Test reject flow:
--    SELECT transition_payroll_status('period-id-here', 'submitted', 'rejected',
--      'user-id-here', 'Test reject reason');
--    -- Expected: returns TRUE
--
-- 3. Verify columns populated:
--    SELECT status, rejected_by, rejected_at, rejection_reason
--    FROM payroll_periods WHERE id = 'period-id-here';
--    -- Expected: status='rejected', rejected_by/at populated
-- =============================================================================
