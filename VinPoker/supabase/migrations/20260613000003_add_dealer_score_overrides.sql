BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
--  Fix: dealer_scores VIEW missing worked_hours column
--  Root cause: DealerAdjustDialog.tsx SELECTs & UPSERTs "worked_hours" but
--  dealer_scores is a VIEW (read-only) and had no such column → Supabase
--  schema cache throws "Could not find the 'worked_hours' column".
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create real table for manual overrides (score & worked_hours)
CREATE TABLE IF NOT EXISTS dealer_score_overrides (
  dealer_id UUID PRIMARY KEY REFERENCES dealers(id) ON DELETE CASCADE,
  score NUMERIC,
  worked_hours NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: club dealer control can manage overrides (matching dealers table policy)
ALTER TABLE dealer_score_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dealer_score_overrides_select" ON dealer_score_overrides;
CREATE POLICY "dealer_score_overrides_select"
  ON dealer_score_overrides FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM dealers WHERE id = dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "dealer_score_overrides_insert" ON dealer_score_overrides;
CREATE POLICY "dealer_score_overrides_insert"
  ON dealer_score_overrides FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM dealers WHERE id = dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "dealer_score_overrides_update" ON dealer_score_overrides;
CREATE POLICY "dealer_score_overrides_update"
  ON dealer_score_overrides FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM dealers WHERE id = dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Grant to service_role for edge functions
GRANT ALL ON dealer_score_overrides TO service_role;

COMMENT ON TABLE dealer_score_overrides IS
  'Manual overrides for dealer score & worked_hours. Populated when admin adjusts in DealerAdjustDialog.';

-- 2. Recreate dealer_scores VIEW with worked_hours + overridden_score columns
DROP VIEW IF EXISTS dealer_scores;
CREATE OR REPLACE VIEW dealer_scores AS
SELECT
  d.id AS dealer_id,
  d.full_name,
  d.tier,
  d.club_id,
  d.employment_type,
  COALESCE(d.hourly_rate_vnd, 0) AS hourly_rate_vnd,
  COALESCE(d.base_rate_vnd, 0) AS base_rate_vnd,
  COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) AS total_hours,
  COALESCE(SUM(dsm.total_assignments), 0) AS total_swings,
  COALESCE(SUM(da.overtime_minutes), 0) AS overtime_minutes,
  COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) * 1.0
    + COALESCE(SUM(dsm.total_assignments), 0) * 0.5
    + CASE d.tier
        WHEN 'A' THEN 20
        WHEN 'B' THEN 10
        ELSE 0
      END AS score,
  -- worked_hours: manual override if set, otherwise falls back to computed total_hours
  COALESCE(dso.worked_hours, COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0)) AS worked_hours,
  -- overridden_score: manual override if set, otherwise the computed score
  COALESCE(dso.score, COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) * 1.0
    + COALESCE(SUM(dsm.total_assignments), 0) * 0.5
    + CASE d.tier
        WHEN 'A' THEN 20
        WHEN 'B' THEN 10
        ELSE 0
      END) AS overridden_score
FROM dealers d
LEFT JOIN dealer_attendance da ON da.dealer_id = d.id AND da.shift_date >= CURRENT_DATE - 30
LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = da.id
LEFT JOIN dealer_score_overrides dso ON dso.dealer_id = d.id
GROUP BY d.id, d.full_name, d.tier, d.club_id, d.employment_type, d.hourly_rate_vnd, d.base_rate_vnd, dso.worked_hours, dso.score;

COMMENT ON VIEW dealer_scores IS
  'Dealer scores + pay rates based on 30‑day history, with optional manual overrides from dealer_score_overrides. score = computed, overridden_score = COALESCE(override, computed), worked_hours = COALESCE(override, total_hours).';

COMMIT;
