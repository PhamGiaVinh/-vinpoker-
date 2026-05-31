-- ═══════════════════════════════════════════════════════════════════
-- Migration: Deadlock recovery schema changes
--
── Root causes from swing architecture analysis:
── 1. enforceBreakBalance force-free (direct UPDATE current_state='available')
──    creates phantom available dealers — downstream guards catch the
──    double-assign via idx_unique_active_dealer, but the force-free
──    achieves zero benefit.
──    Fix: Replace with manage-break invocation (edge function).
──
── 2. Batch swing duration has no jitter — weightedPool=0 means ALL tables
──    get swing_due_at = NOW() + max_duration, causing synchronized OT entry.
──    Fix: Add per-table jitter in process-swing code (not schema — done in .ts)
──
── 3. Pass 3 processes ALL OT tables every 60s tick — no SKIP LOCKED, no LIMIT.
──    Fix: Add LIMIT 8 to Pass 3 query + index for priority ordering. (code + index here)
──
── 4. OT display minutes overwrites payroll — enforceBreakBalance writes absolute
──    overtime_minutes, conflicting with perform_swing's cumulative addition.
──    Fix: Separate column current_ot_display_minutes on dealer_attendance.
──
── 5. priority_swing_at column missing — no way to flag a table for priority swing.
──    Fix: Add TIMESTAMPTZ column + partial index for fast priority ordering.
──
── 6. enforceBreakBalance cron too slow for deadlock recovery (15min → 5min).
──    Fix: Reschedule with pg_cron.
──
── 7. dealer_breaks.reason column — already added in 20260526000001. Skip.
── ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
── 1. current_ot_display_minutes on dealer_attendance
──    Purpose: Live OT duration for floor manager UI (overwrite-safe display).
──    Never used for payroll — use overtime_minutes for payroll accumulation.
──    enforceBreakBalance writes here; perform_swing writes to overtime_minutes.
── ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS current_ot_display_minutes INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.dealer_attendance.current_ot_display_minutes IS
  'Live OT display for floor manager UI. Updated by enforceBreakBalance every 5min. Overwrite-safe — NOT used for payroll.';

-- ═══════════════════════════════════════════════════════════════════
── 2. priority_swing_at on dealer_assignments
──    Purpose: TIMESTAMPTZ — timestamp when a table was flagged for priority swing.
──    Scoring in pickNextDealer: adds +300 bonus when priority_swing_at IS NOT NULL.
──    Auto-clears if no dealer found within 10min (checked in process-swing Pass 3).
──    Use TIMESTAMPTZ (not BOOLEAN) for audit trail and recency-based auto-clear.
── ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.dealer_assignments
  ADD COLUMN IF NOT EXISTS priority_swing_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dealer_assignments.priority_swing_at IS
  'Flag for priority swing. Set by enforceBreakBalance deadlock recovery. +300 scoring bonus in pickNextDealer. Auto-clears after 10min.';

-- ═══════════════════════════════════════════════════════════════════
── 3. Partial index for Pass 3 priority ordering + fast priority_swing queries
──    Purpose: process-swing Pass 3 queries .order("swing_due_at", { ascending: true }) LIMIT 8.
──    This index covers unswung active assignments, ordered by swing_due_at.
──    priority_swing_at ASC NULLS LAST so NULLs (non-priority) sort after timestamps,
──    but also serves lookups WHERE priority_swing_at IS NOT NULL.
── ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_swing_due_on_priority
  ON public.dealer_assignments(swing_due_at ASC, priority_swing_at ASC NULLS LAST)
  WHERE status = 'assigned' AND swing_processed_at IS NULL;

COMMENT ON INDEX public.idx_dealer_assignments_swing_due_on_priority IS
  'Covers process-swing Pass 3: ORDER BY swing_due_at ASC LIMIT 8, also fast WHERE priority_swing_at IS NOT NULL.';

-- ═══════════════════════════════════════════════════════════════════
── 4. Reschedule enforceBreakBalance cron: 15min → 5min
──    Purpose: Deadlock recovery is time-sensitive. At 15min intervals, a table
──    stuck with no available dealer waits up to 15 minutes for recovery.
──    5min intervals catch deadlocks faster while adding only 4 extra HTTP calls
──    per hour per club = 288 calls/day for 1 club, still negligible.
──    If platform reaches 10+ clubs, revisit (2880 calls/day — add health check).
── ═══════════════════════════════════════════════════════════════════
SELECT cron.unschedule('enforce-break-balance');

SELECT cron.schedule(
  'enforce-break-balance',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/enforceBreakBalance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ═══════════════════════════════════════════════════════════════════
── 5. Verify migration applied correctly
── ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Verify dealer_attendance.current_ot_display_minutes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dealer_attendance'
      AND column_name = 'current_ot_display_minutes'
  ) THEN
    RAISE EXCEPTION 'Migration failed: dealer_attendance.current_ot_display_minutes not found';
  END IF;

  -- Verify dealer_assignments.priority_swing_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dealer_assignments'
      AND column_name = 'priority_swing_at'
  ) THEN
    RAISE EXCEPTION 'Migration failed: dealer_assignments.priority_swing_at not found';
  END IF;

  -- Verify index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_dealer_assignments_swing_due_on_priority'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_dealer_assignments_swing_due_on_priority not found';
  END IF;

  -- Verify cron job rescheduled (job_name should exist with */5 schedule)
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'enforce-break-balance'
  ) THEN
    RAISE EXCEPTION 'Migration failed: cron job enforce-break-balance not scheduled';
  END IF;
END $$;
