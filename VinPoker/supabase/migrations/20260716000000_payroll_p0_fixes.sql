BEGIN;

-- =============================================================================
-- P0 Bug Fixes: Payroll Data Loss + Audit + Security
--
-- Fixes:
--   1. Bug 2: DELETE dealer_payroll cascade-deletes adjustments → UPSERT
--   2. Bug 1: auth.uid() returns NULL in SECURITY DEFINER trigger → session var
--   3. Gap 1: No RLS on payroll tables → add policies
--   4. Schema: payroll_audit_log table + triggers
--   5. Schema: status enum columns for approval workflow
--   6. RPC: save_payroll_period (transaction-safe with SELECT FOR UPDATE)
--   7. RPC: transition_payroll_status (optimistic locking for approval)
--
-- Rollback companion at bottom.
-- =============================================================================

-- ==========================================
-- 1. Unique constraint for UPSERT
-- ==========================================
ALTER TABLE dealer_payroll
  DROP CONSTRAINT IF EXISTS dealer_payroll_period_dealer_unique;

ALTER TABLE dealer_payroll
  ADD CONSTRAINT dealer_payroll_period_dealer_unique
    UNIQUE (period_id, dealer_id);

-- ==========================================
-- 2. Status columns for approval workflow
-- ==========================================
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Status check constraint
ALTER TABLE payroll_periods
  DROP CONSTRAINT IF EXISTS chk_payroll_status,
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft', 'submitted', 'approved', 'locked'));

ALTER TABLE dealer_payroll
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ==========================================
-- 3. Audit log table
-- ==========================================
CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  club_id UUID,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values JSONB,
  new_values JSONB,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_record
  ON payroll_audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at
  ON payroll_audit_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_club
  ON payroll_audit_log(club_id);

-- ==========================================
-- 4. Audit trigger (fixed auth.uid() NULL)
-- ==========================================
CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_club_id UUID;
BEGIN
  -- Try auth.uid() first, fall back to session variable
  v_user_id := COALESCE(
    auth.uid(),
    NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
  );

  -- Extract club_id from the row (all payroll tables have club_id)
  IF TG_TABLE_NAME = 'payroll_periods' THEN
    v_club_id := NEW.club_id;
  ELSIF TG_TABLE_NAME = 'dealer_payroll' THEN
    v_club_id := NEW.club_id;
  ELSIF TG_TABLE_NAME = 'payroll_adjustments' THEN
    -- payroll_adjustments doesn't have club_id directly, skip
    v_club_id := NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO payroll_audit_log (table_name, record_id, club_id, action, old_values, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, v_club_id, 'DELETE', to_jsonb(OLD), v_user_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO payroll_audit_log (table_name, record_id, club_id, action, old_values, new_values, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, v_club_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_user_id);
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, v_club_id, 'INSERT', to_jsonb(NEW), v_user_id);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_dealer_payroll_audit ON dealer_payroll;
CREATE TRIGGER trg_dealer_payroll_audit
  AFTER INSERT OR UPDATE OR DELETE ON dealer_payroll
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_payroll_adjustments_audit ON payroll_adjustments;
CREATE TRIGGER trg_payroll_adjustments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_payroll_periods_audit ON payroll_periods;
CREATE TRIGGER trg_payroll_periods_audit
  AFTER INSERT OR UPDATE ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

COMMENT ON FUNCTION fn_audit_trigger IS
  'Audit trigger for payroll tables. Uses auth.uid() or app.current_user_id session variable. NEVER delete this function.';

-- ==========================================
-- 5. RLS (Row-Level Security)
-- ==========================================
ALTER TABLE dealer_payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid duplicates
DROP POLICY IF EXISTS payroll_club_isolation ON dealer_payroll;
DROP POLICY IF EXISTS audit_log_club_isolation ON payroll_audit_log;
DROP POLICY IF EXISTS payroll_periods_club_isolation ON payroll_periods;
DROP POLICY IF EXISTS payroll_adjustments_club_isolation ON payroll_adjustments;

-- Policy: user must be member of the club (club_members uses player_user_id not user_id)
CREATE POLICY payroll_club_isolation ON dealer_payroll
  USING (club_id IN (
    SELECT club_id FROM club_members WHERE player_user_id = auth.uid()
  ));

CREATE POLICY audit_log_club_isolation ON payroll_audit_log
  USING (club_id IS NULL OR club_id IN (
    SELECT club_id FROM club_members WHERE player_user_id = auth.uid()
  ));

CREATE POLICY payroll_periods_club_isolation ON payroll_periods
  USING (club_id IN (
    SELECT club_id FROM club_members WHERE player_user_id = auth.uid()
  ));

CREATE POLICY payroll_adjustments_club_isolation ON payroll_adjustments
  USING (payroll_id IN (
    SELECT dp.id FROM dealer_payroll dp
    WHERE dp.club_id IN (SELECT club_id FROM club_members WHERE player_user_id = auth.uid())
  ));

-- ==========================================
-- 6. RPC: save_payroll_period (transaction-safe UPSERT)
-- ==========================================
CREATE OR REPLACE FUNCTION save_payroll_period(
  p_club_id UUID,
  p_year INT,
  p_month INT,
  p_start_date DATE,
  p_end_date DATE,
  p_payroll_rows JSONB,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_row JSONB;
BEGIN
  -- Set session variable for audit trigger
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  -- 1. Lock period row
  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id AND period_year = p_year AND period_month = p_month
  FOR UPDATE;

  -- 2. Create or verify period
  IF v_period_id IS NULL THEN
    INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
    VALUES (p_club_id, p_year, p_month, p_start_date, p_end_date, 'draft', p_user_id)
    RETURNING id INTO v_period_id;
  ELSE
    -- Reject if locked
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = v_period_id AND status = 'locked') THEN
      RAISE EXCEPTION 'Payroll period is locked and cannot be modified. Period ID: %', v_period_id;
    END IF;
    -- Update calculated_by on re-save
    UPDATE payroll_periods
    SET calculated_by = p_user_id, updated_at = now()
    WHERE id = v_period_id;
  END IF;

  -- 3. Upsert dealer_payroll rows (NOT delete+insert)
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
    INSERT INTO dealer_payroll (
      dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
      hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
      ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
      total_adjustments_vnd, net_pay_vnd, status, calculated_by
    ) VALUES (
      (v_row->>'dealer_id')::UUID, p_club_id, v_period_id,
      v_row->>'employment_type',
      NULLIF(v_row->>'monthly_salary_vnd', '')::NUMERIC,
      NULLIF(v_row->>'hourly_rate_vnd', '')::NUMERIC,
      NULLIF(v_row->>'ot_multiplier', '')::NUMERIC,
      NULLIF(v_row->>'total_shifts', '')::INT,
      NULLIF(v_row->>'total_hours', '')::NUMERIC,
      NULLIF(v_row->>'regular_hours', '')::NUMERIC,
      NULLIF(v_row->>'ot_hours', '')::NUMERIC,
      NULLIF(v_row->>'base_salary_vnd', '')::NUMERIC,
      NULLIF(v_row->>'regular_pay_vnd', '')::NUMERIC,
      NULLIF(v_row->>'ot_pay_vnd', '')::NUMERIC,
      NULLIF(v_row->>'gross_pay_vnd', '')::NUMERIC,
      NULLIF(v_row->>'total_adjustments_vnd', '')::NUMERIC,
      NULLIF(v_row->>'net_pay_vnd', '')::NUMERIC,
      'draft', p_user_id
    )
    ON CONFLICT (period_id, dealer_id) DO UPDATE SET
      employment_type = EXCLUDED.employment_type,
      monthly_salary_vnd = EXCLUDED.monthly_salary_vnd,
      hourly_rate_vnd = EXCLUDED.hourly_rate_vnd,
      ot_multiplier = EXCLUDED.ot_multiplier,
      total_shifts = EXCLUDED.total_shifts,
      total_hours = EXCLUDED.total_hours,
      regular_hours = EXCLUDED.regular_hours,
      ot_hours = EXCLUDED.ot_hours,
      base_salary_vnd = EXCLUDED.base_salary_vnd,
      regular_pay_vnd = EXCLUDED.regular_pay_vnd,
      ot_pay_vnd = EXCLUDED.ot_pay_vnd,
      gross_pay_vnd = EXCLUDED.gross_pay_vnd,
      total_adjustments_vnd = EXCLUDED.total_adjustments_vnd,
      net_pay_vnd = EXCLUDED.net_pay_vnd,
      status = EXCLUDED.status,
      calculated_by = EXCLUDED.calculated_by,
      updated_at = now();
  END LOOP;

  -- 4. Delete dealer_payroll rows NOT in p_payroll_rows
  -- (dealer removed or became inactive)
  DELETE FROM dealer_payroll
  WHERE period_id = v_period_id
    AND dealer_id NOT IN (
      SELECT (elem->>'dealer_id')::UUID
      FROM jsonb_array_elements(p_payroll_rows) AS elem
    );

  RETURN v_period_id;
END;
$$;

COMMENT ON FUNCTION save_payroll_period IS
  'Transaction-safe save of payroll period. Uses UPSERT (not DELETE+INSERT) to preserve adjustments. '
  'Locks period row with SELECT FOR UPDATE. Rejects if status=locked.';

-- ==========================================
-- 7. RPC: transition_payroll_status (optimistic locking)
-- ==========================================
CREATE OR REPLACE FUNCTION transition_payroll_status(
  p_period_id UUID,
  p_expected_status VARCHAR(20),
  p_new_status VARCHAR(20),
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  -- Set session variable for audit trigger
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  UPDATE payroll_periods
  SET
    status = p_new_status,
    updated_at = now(),
    submitted_by = CASE WHEN p_new_status = 'submitted' THEN p_user_id ELSE submitted_by END,
    submitted_at = CASE WHEN p_new_status = 'submitted' THEN now() ELSE submitted_at END,
    approved_by = CASE WHEN p_new_status = 'approved' THEN p_user_id ELSE approved_by END,
    approved_at = CASE WHEN p_new_status = 'approved' THEN now() ELSE approved_at END,
    locked_by = CASE WHEN p_new_status = 'locked' THEN p_user_id ELSE locked_by END,
    locked_at = CASE WHEN p_new_status = 'locked' THEN now() ELSE locked_at END
  WHERE id = p_period_id AND status = p_expected_status
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Status transition failed: expected % but period % was already modified',
      p_expected_status, p_period_id;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION transition_payroll_status IS
  'Atomic status transition with optimistic locking. Returns TRUE on success, raises exception on conflict.';

COMMIT;

-- =============================================================================
-- ROLLBACK COMPANION (run manually if rollback required):
--
-- DROP TRIGGER IF EXISTS trg_dealer_payroll_audit ON dealer_payroll;
-- DROP TRIGGER IF EXISTS trg_payroll_adjustments_audit ON payroll_adjustments;
-- DROP TRIGGER IF EXISTS trg_payroll_periods_audit ON payroll_periods;
-- DROP FUNCTION IF EXISTS fn_audit_trigger();
-- DROP TABLE IF EXISTS payroll_audit_log;
-- DROP FUNCTION IF EXISTS save_payroll_period(UUID, INT, INT, DATE, DATE, JSONB, UUID);
-- DROP FUNCTION IF EXISTS transition_payroll_status(UUID, VARCHAR, VARCHAR, UUID);
-- ALTER TABLE payroll_periods
--   DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS submitted_by,
--   DROP COLUMN IF EXISTS submitted_at,
--   DROP COLUMN IF EXISTS approved_by,
--   DROP COLUMN IF EXISTS approved_at,
--   DROP COLUMN IF EXISTS locked_by,
--   DROP COLUMN IF EXISTS locked_at,
--   DROP COLUMN IF EXISTS updated_at,
--   DROP CONSTRAINT IF EXISTS chk_payroll_status;
-- ALTER TABLE dealer_payroll
--   DROP COLUMN IF EXISTS updated_at,
--   DROP CONSTRAINT IF EXISTS dealer_payroll_period_dealer_unique;
-- ALTER TABLE dealer_payroll DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE payroll_audit_log DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE payroll_periods DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE payroll_adjustments DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS payroll_club_isolation ON dealer_payroll;
-- DROP POLICY IF EXISTS audit_log_club_isolation ON payroll_audit_log;
-- DROP POLICY IF EXISTS payroll_periods_club_isolation ON payroll_periods;
-- DROP POLICY IF EXISTS payroll_adjustments_club_isolation ON payroll_adjustments;
-- =============================================================================
