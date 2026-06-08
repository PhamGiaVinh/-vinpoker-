-- Migration: Add is_emergency_pre_assign flag for Emergency Pre-assign feature
-- Purpose: Track when a pre-assign was created as an emergency (no prior pre-assign existed)

ALTER TABLE public.dealer_assignments
  ADD COLUMN IF NOT EXISTS is_emergency_pre_assign BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast filtering in Pass 2/3 queries
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_emergency
  ON public.dealer_assignments (is_emergency_pre_assign)
  WHERE is_emergency_pre_assign = TRUE;

COMMENT ON COLUMN public.dealer_assignments.is_emergency_pre_assign IS
  'True when pre_assigned_attendance_id was set via Emergency Pre-assign (Pass 3 found dealer at swing time). Used for analytics and overwrite decisions.';
