-- Source-catalog containment: retain deadlock-recovery schema only. The legacy
-- scheduler targeted a fixed production Edge URL and is intentionally omitted.

ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS current_ot_display_minutes INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.dealer_attendance.current_ot_display_minutes IS
  'Live OT display for floor manager UI. Never used for payroll.';

ALTER TABLE public.dealer_assignments
  ADD COLUMN IF NOT EXISTS priority_swing_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dealer_assignments.priority_swing_at IS
  'Flag for priority swing; source scheduler is owner-gated separately.';

CREATE INDEX IF NOT EXISTS idx_dealer_assignments_swing_due_on_priority
  ON public.dealer_assignments(swing_due_at ASC, priority_swing_at ASC NULLS LAST)
  WHERE status = 'assigned' AND swing_processed_at IS NULL;

COMMENT ON INDEX public.idx_dealer_assignments_swing_due_on_priority IS
  'Covers process-swing priority ordering and fast priority lookups.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dealer_attendance'
      AND column_name = 'current_ot_display_minutes'
  ) THEN
    RAISE EXCEPTION 'Migration failed: dealer_attendance.current_ot_display_minutes not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dealer_assignments'
      AND column_name = 'priority_swing_at'
  ) THEN
    RAISE EXCEPTION 'Migration failed: dealer_assignments.priority_swing_at not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_dealer_assignments_swing_due_on_priority'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_dealer_assignments_swing_due_on_priority not found';
  END IF;
END $$;
