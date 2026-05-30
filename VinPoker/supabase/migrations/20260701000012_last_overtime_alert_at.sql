-- Add last_ot_alert_at to dealer_assignments for drift-proof repeat OT alert tracking
ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS last_ot_alert_at TIMESTAMPTZ;
