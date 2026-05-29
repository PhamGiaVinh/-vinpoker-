BEGIN;

-- =============================================================================
-- Dealer Management: employment columns + dealer_scores VIEW
-- Wrapped in transaction for atomic apply. Rollback companion at bottom.
-- =============================================================================

-- 1. ALTER dealers: add employment-type columns
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time')),
  ADD COLUMN IF NOT EXISTS hourly_rate_vnd INT,
  ADD COLUMN IF NOT EXISTS base_rate_vnd INT,
  ADD COLUMN IF NOT EXISTS joined_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. ALTER dealer_pay_rates: add rate columns used by payroll
ALTER TABLE dealer_pay_rates
  ADD COLUMN IF NOT EXISTS overtime_rate INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS part_time_rate INT DEFAULT 0;

-- 3. CREATE dealer_scores VIEW (read‑only, zero migration risk)
--    Score formula: total_hours × 1.0 + total_swings × 0.5 + tier_bonus
--    Tier bonus: A=20, B=10, C=0
CREATE OR REPLACE VIEW dealer_scores AS
SELECT
  d.id AS dealer_id,
  d.full_name,
  d.tier,
  d.club_id,
  d.employment_type,
  COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) AS total_hours,
  COALESCE(SUM(dsm.total_assignments), 0) AS total_swings,
  COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) * 1.0
    + COALESCE(SUM(dsm.total_assignments), 0) * 0.5
    + CASE d.tier
        WHEN 'A' THEN 20
        WHEN 'B' THEN 10
        ELSE 0
      END AS score
FROM dealers d
LEFT JOIN dealer_attendance da ON da.dealer_id = d.id AND da.shift_date >= CURRENT_DATE - 30
LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = da.id
GROUP BY d.id, d.full_name, d.tier, d.club_id, d.employment_type;

COMMENT ON VIEW dealer_scores IS 'Dealer performance score based on 30‑day history. Score = hours×1 + swings×0.5 + tier_bonus(A=20,B=10). Used by DealerManagementTab.';

-- 4. Index for performance on date-range queries via dealer_attendance
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_dealer_date
  ON dealer_attendance(dealer_id, shift_date);

COMMIT;

-- =============================================================================
-- ROLLBACK COMPANION (run manually if rollback required):
--   DROP VIEW IF EXISTS dealer_scores;
--   ALTER TABLE dealers DROP COLUMN IF EXISTS employment_type;
--   ALTER TABLE dealers DROP COLUMN IF EXISTS hourly_rate_vnd;
--   ALTER TABLE dealers DROP COLUMN IF EXISTS base_rate_vnd;
--   ALTER TABLE dealers DROP COLUMN IF EXISTS joined_date;
--   ALTER TABLE dealers DROP COLUMN IF EXISTS notes;
--   ALTER TABLE dealer_pay_rates DROP COLUMN IF EXISTS overtime_rate;
--   ALTER TABLE dealer_pay_rates DROP COLUMN IF EXISTS part_time_rate;
--   DROP INDEX IF EXISTS idx_dealer_attendance_club_date;
-- =============================================================================
