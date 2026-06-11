-- Forward Rotation Scheduler — schedule table + honest clock pair.
--
-- swing_due_at is the immutable contract time of the CURRENT dealer's session
-- (written once at swing-in, never pushed). planned_relief_at is the honest
-- plan clock: when the system intends to relieve the table. Under dealer
-- shortage planned_relief_at may be later than swing_due_at — OT accrues
-- visibly against swing_due_at instead of being hidden by due-date pushes.
--
-- dealer_rotation_schedule is the SINGLE SOURCE OF TRUTH for rotation plans.
-- dealer_assignments.planned_relief_at is a denormalized slot-0 read-cache,
-- written ONLY by lock_rotation_slot / cancel_rotation_slot /
-- complete_rotation_slot (see 20260813000001).

BEGIN;

CREATE TABLE IF NOT EXISTS public.dealer_rotation_schedule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  table_id           uuid NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  -- Assignment being relieved. NULL on forecast slots (those assignments don't exist yet).
  assignment_id      uuid REFERENCES public.dealer_assignments(id) ON DELETE CASCADE,
  -- 0 = TIẾP THEO (lockable), 1..2 = DỰ ĐOÁN (forecast, never locks a dealer).
  slot_index         int  NOT NULL DEFAULT 0 CHECK (slot_index BETWEEN 0 AND 4),
  out_attendance_id  uuid REFERENCES public.dealer_attendance(id) ON DELETE SET NULL,
  -- NULL = shortage placeholder ("first eligible dealer", none known yet).
  in_attendance_id   uuid REFERENCES public.dealer_attendance(id) ON DELETE SET NULL,
  planned_relief_at  timestamptz NOT NULL,
  announce_at        timestamptz,
  status             text NOT NULL DEFAULT 'predicted'
                     CHECK (status IN ('predicted','announced','executing','executed',
                                       'cancelled','no_show','superseded')),
  -- Relief later than the table's ideal time because the pool can't cover it.
  is_shortage        boolean NOT NULL DEFAULT false,
  -- Table already overdue when planned → 3-minute announce lead instead of full pre-announce.
  is_emergency       boolean NOT NULL DEFAULT false,
  plan_run_id        uuid NOT NULL,
  solver_version     text NOT NULL,
  score              numeric,
  -- Fairness inputs snapshot: prev_session_minutes, eligible_at, tier fit, need time.
  reason             jsonb NOT NULL DEFAULT '{}'::jsonb,
  version            int  NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One live row per table+slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rotation_active_slot
  ON public.dealer_rotation_schedule (table_id, slot_index)
  WHERE status IN ('predicted','announced','executing');

-- A dealer can be LOCKED into at most one upcoming relief. Predicted rows are
-- deliberately unconstrained: the same dealer may appear in several forecasts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rotation_locked_dealer
  ON public.dealer_rotation_schedule (in_attendance_id)
  WHERE status IN ('announced','executing');

-- A table can never carry two CHỐT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rotation_announced_assignment
  ON public.dealer_rotation_schedule (assignment_id)
  WHERE status IN ('announced','executing');

CREATE INDEX IF NOT EXISTS idx_rotation_due
  ON public.dealer_rotation_schedule (club_id, status, planned_relief_at);

CREATE INDEX IF NOT EXISTS idx_rotation_plan_run
  ON public.dealer_rotation_schedule (club_id, plan_run_id);

DROP TRIGGER IF EXISTS update_dealer_rotation_schedule_updated_at ON public.dealer_rotation_schedule;
CREATE TRIGGER update_dealer_rotation_schedule_updated_at
  BEFORE UPDATE ON public.dealer_rotation_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Slot-0 read-cache on the assignment (see header note for the single-writer rule).
ALTER TABLE public.dealer_assignments
  ADD COLUMN IF NOT EXISTS planned_relief_at timestamptz;

COMMIT;
