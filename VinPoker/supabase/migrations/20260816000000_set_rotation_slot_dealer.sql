-- ============================================================================
-- SESSION — Dealer Swing UX/Flow Fix: Change Predicted Replacement
--           + Resting 10m+3m Rule
--
-- set_rotation_slot_dealer: lets club staff choose a SPECIFIC dealer as the
-- planned replacement for one table ("Đổi & CHỐT dealer thay thế").
-- Planning only: never executes the handoff, never releases the current
-- table dealer, and NEVER moves planned_relief_at / swing_due_at.
--
-- Why a new RPC: predicted rows are superseded every planner tick
-- (upsert_rotation_plan), and cancel + replan re-picks the solver's own
-- choice — so a floor decision can only survive by LOCKING the row
-- (predicted -> announced) with the chosen dealer. Announced rows are
-- reconciled by Pass R phase A, which keeps any lock that is real, so a
-- manual lock survives the planner untouched.
--
-- Single-writer rule: the pre-assign field writer family is hereby
--   {lock, cancel, complete, set}_rotation_slot* — this RPC is a member.
--   Lock ordering matches lock_rotation_slot exactly
--   (schedule -> assignment -> attendance) to avoid deadlocks.
--
-- Eligibility guard — FUTURE form (deliberately different from the
-- lock-time R1 guard in 20260814000001; do NOT "fix" it back):
--   reject only when the dealer is still resting AND cannot complete
--   rest + 3-min announce buffer before the EXISTING planned_relief_at.
--   A fully-rested dealer always passes, including on overdue tables
--   whose planned time is already in the past.
--
-- Telegram: the old dealer's already-sent announcement CANNOT be retracted;
--   a new announcement for the chosen dealer is enqueued via
--   pre_announce_jobs (existing worker delivers it). Enqueue failure never
--   rolls back the change (nested exception block).
--
-- Atomicity: validation failures return typed jsonb BEFORE any write.
--   Once writes begin, any unexpected condition RAISEs -> the whole
--   function block rolls back -> top-level handler returns jsonb error.
--   No partial assignment/schedule/attendance state is ever committed.
--
-- Rollback: DROP FUNCTION public.set_rotation_slot_dealer(uuid, integer, uuid, text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_rotation_slot_dealer(
  p_schedule_id        uuid,
  p_schedule_version   integer,
  p_new_attendance_id  uuid,
  p_reason             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row                public.dealer_rotation_schedule%ROWTYPE;
  v_club_id            UUID;
  v_assignment_version INT;
  v_old_attendance     UUID;
  v_was_announced      BOOLEAN;
  v_last_release       TIMESTAMPTZ;
  v_rest_minutes       INT;
  v_eligible_at        TIMESTAMPTZ;
  v_rows               INT;
  -- Telegram enqueue (best-effort)
  v_chat_id            TEXT;
  v_zone               TEXT;
  v_table_name         TEXT;
  v_new_name           TEXT;
  v_new_username       TEXT;
  v_out_attendance     UUID;
  v_out_name           TEXT;
  v_out_username       TEXT;
  v_telegram           TEXT := 'skipped_no_chat_id';
  v_old_job            TEXT := 'none';
BEGIN
  -- [1] Resolve the club WITHOUT locking, gate, THEN lock. Gating before the
  --     FOR UPDATE prevents a cross-club caller from holding even a momentary
  --     lock on (or probing the existence of) another club's schedule row.
  SELECT club_id INTO v_club_id
  FROM dealer_rotation_schedule
  WHERE id = p_schedule_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost','detail','Schedule row not found');
  END IF;

  -- [2] Staff gate — convention copied verbatim from get_rotation_board
  --     (service_role has auth.uid() IS NULL and passes via the grant).
  IF auth.uid() IS NOT NULL
     AND NOT public.is_club_dealer_control(auth.uid(), v_club_id)
     AND NOT public.is_club_admin(auth.uid(), v_club_id)
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role)
  THEN
    RETURN jsonb_build_object('outcome','forbidden');
  END IF;

  -- [2b] Now take the row lock (lock order: schedule -> assignment -> attendance).
  SELECT * INTO v_row
  FROM dealer_rotation_schedule
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost','detail','Schedule row deleted');
  END IF;

  -- [3] Row must be an actionable slot-0 plan.
  IF v_row.status NOT IN ('predicted','announced') THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail', format('Schedule row is %s', v_row.status));
  END IF;

  IF v_row.version != p_schedule_version THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail', format('Schedule version mismatch: expected %s, got %s',
                       p_schedule_version, v_row.version));
  END IF;

  IF v_row.slot_index != 0 OR v_row.assignment_id IS NULL OR v_row.planned_relief_at IS NULL THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail','Only slot 0 with a concrete assignment and planned time can be changed');
  END IF;

  IF v_row.in_attendance_id = p_new_attendance_id THEN
    RETURN jsonb_build_object('outcome','noop_same_dealer');
  END IF;

  v_was_announced  := (v_row.status = 'announced');
  v_old_attendance := v_row.in_attendance_id;

  -- [4] New dealer must not be CHOT elsewhere (pre-check;
  --     uq_rotation_locked_dealer remains the hard backstop).
  IF EXISTS (
    SELECT 1 FROM dealer_rotation_schedule
    WHERE in_attendance_id = p_new_attendance_id
      AND status IN ('announced','executing')
      AND id != p_schedule_id
  ) THEN
    RETURN jsonb_build_object('outcome','dealer_already_locked',
      'detail','Dealer already locked for another table');
  END IF;

  -- [5] Lock the assignment being relieved; its pre-assign state must match
  --     the schedule row's view of the world.
  IF v_was_announced THEN
    SELECT version INTO v_assignment_version
    FROM dealer_assignments
    WHERE id = v_row.assignment_id
      AND status = 'assigned'
      AND released_at IS NULL
      AND swing_processed_at IS NULL
      AND pre_assigned_attendance_id = v_old_attendance
    FOR UPDATE;
  ELSE
    SELECT version INTO v_assignment_version
    FROM dealer_assignments
    WHERE id = v_row.assignment_id
      AND status = 'assigned'
      AND released_at IS NULL
      AND swing_processed_at IS NULL
      AND pre_assigned_attendance_id IS NULL
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail','Assignment no longer active or pre-assign state changed');
  END IF;

  -- [6] Lock + validate the new dealer (same club, checked in, available).
  PERFORM 1
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.id = p_new_attendance_id
    AND d.club_id = v_row.club_id
    AND da.status = 'checked_in'
    AND da.current_state = 'available'
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','dealer_unavailable',
      'detail','Dealer not checked in / not available in this club');
  END IF;

  -- [7] R1+R2 eligibility — FUTURE form (see header).
  SELECT GREATEST(
    COALESCE((SELECT MAX(a.released_at)
              FROM dealer_assignments a
              WHERE a.attendance_id = p_new_attendance_id), '-infinity'::timestamptz),
    COALESCE((SELECT att.last_released_at
              FROM dealer_attendance att
              WHERE att.id = p_new_attendance_id), '-infinity'::timestamptz)
  ) INTO v_last_release;

  SELECT COALESCE(sc.min_inter_swing_rest_minutes, 10)
  INTO   v_rest_minutes
  FROM   swing_config sc
  WHERE  sc.club_id = v_row.club_id
    AND  sc.table_type = 'tournament'
  LIMIT  1;
  -- R1 floor: 10 minutes is the hard minimum and is NEVER relaxed, even if a
  -- club misconfigures min_inter_swing_rest_minutes below it (mirrors the
  -- frontend's Math.max(10, config)).
  v_rest_minutes := GREATEST(10, COALESCE(v_rest_minutes, 10));
  v_eligible_at  := v_last_release + (v_rest_minutes || ' minutes')::interval;

  IF v_eligible_at > NOW()
     AND v_eligible_at + interval '3 minutes' > v_row.planned_relief_at
  THEN
    RETURN jsonb_build_object('outcome','not_eligible',
      'eligible_at', v_eligible_at,
      'planned_relief_at', v_row.planned_relief_at,
      'rest_minutes', v_rest_minutes);
  END IF;

  -- ── WRITES — all-or-nothing from here: 0-row critical updates RAISE, and
  --    the top-level handler rolls back the entire block. ──────────────────

  -- [8] Re-point the assignment's pre-assign lock to the chosen dealer.
  --     planned_relief_at is rewritten with the SAME value (cache refresh
  --     only — the time never moves).
  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = p_new_attendance_id,
    pre_assigned_at            = NOW(),
    planned_relief_at          = v_row.planned_relief_at,
    version                    = version + 1,
    updated_at                 = NOW()
  WHERE id = v_row.assignment_id
    AND version = v_assignment_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'SET_SLOT_DEALER_ASSIGNMENT_CAS failed for %', v_row.assignment_id;
  END IF;

  -- [9] Lock the new dealer.
  UPDATE dealer_attendance
  SET
    current_state         = 'pre_assigned',
    pre_assigned_table_id = v_row.table_id,
    pre_assigned_at       = NOW(),
    updated_at            = NOW()
  WHERE id = p_new_attendance_id
    AND current_state = 'available';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'SET_SLOT_DEALER_NEW_DEALER_STATE failed for %', p_new_attendance_id;
  END IF;

  -- [10] Release the previously locked dealer (announced path only).
  --      Guarded cancel-style update; 0 rows = known healer/manual drift,
  --      tolerated — Pass R reconcile owns that case.
  IF v_was_announced AND v_old_attendance IS NOT NULL THEN
    UPDATE dealer_attendance
    SET
      current_state         = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at       = NULL,
      updated_at            = NOW()
    WHERE id = v_old_attendance
      AND current_state = 'pre_assigned'
      AND pre_assigned_table_id = v_row.table_id;
  END IF;

  -- [11] Schedule row: chosen dealer, locked (CHOT), audited.
  UPDATE dealer_rotation_schedule
  SET
    status           = 'announced',
    in_attendance_id = p_new_attendance_id,
    announce_at      = NOW(),
    version          = version + 1,
    updated_at       = NOW(),
    reason           = COALESCE(reason, '{}'::jsonb) || jsonb_build_object(
      'manual_change', jsonb_build_object(
        'changed_by',        COALESCE(auth.uid()::text, 'service'),
        'old_attendance_id', v_old_attendance,
        'new_attendance_id', p_new_attendance_id,
        'was_announced',     v_was_announced,
        'reason',            COALESCE(p_reason, 'floor_manual_change'),
        'at',                NOW()))
  WHERE id = p_schedule_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'SET_SLOT_DEALER_SCHEDULE_UPDATE failed for %', p_schedule_id;
  END IF;

  -- [12a] Cancel the superseded dealer's not-yet-sent announcement so the
  --       worker doesn't call the wrong dealer to the table. Own
  --       subtransaction: a failure in the LATER enqueue ([12b]) can never
  --       roll this cancellation back, and vice versa. Already-SENT messages
  --       cannot be retracted (documented limitation).
  IF v_was_announced AND v_old_attendance IS NOT NULL THEN
    BEGIN
      UPDATE pre_announce_jobs
      SET status = 'cancelled'
      WHERE table_id = v_row.table_id
        AND attendance_id = v_old_attendance
        AND status = 'pending';
      v_old_job := 'cancelled_if_pending';
    EXCEPTION WHEN OTHERS THEN
      v_old_job := 'cancel_failed: ' || SQLERRM;
    END;
  END IF;

  -- [12b] Telegram — best-effort enqueue; never rolls back the change.
  BEGIN
    SELECT cs.telegram_chat_id INTO v_chat_id
    FROM club_settings cs WHERE cs.club_id = v_row.club_id;

    IF v_chat_id IS NOT NULL THEN
      SELECT d.full_name, d.telegram_username INTO v_new_name, v_new_username
      FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id
      WHERE da.id = p_new_attendance_id;

      SELECT gt.table_name INTO v_table_name
      FROM game_tables gt WHERE gt.id = v_row.table_id;

      SELECT sc.club_zone INTO v_zone
      FROM swing_config sc
      WHERE sc.club_id = v_row.club_id AND sc.table_type = 'tournament'
      LIMIT 1;

      SELECT a.attendance_id, d2.full_name, d2.telegram_username
      INTO v_out_attendance, v_out_name, v_out_username
      FROM dealer_assignments a
      JOIN dealer_attendance att2 ON att2.id = a.attendance_id
      JOIN dealers d2 ON d2.id = att2.dealer_id
      WHERE a.id = v_row.assignment_id;

      INSERT INTO pre_announce_jobs (
        club_id, table_id, assignment_id, attendance_id, out_attendance_id,
        table_name, zone, in_dealer_name, in_dealer_username,
        out_dealer_name, out_dealer_username, swing_at, minutes_left, chat_id
      ) VALUES (
        v_row.club_id, v_row.table_id, v_row.assignment_id, p_new_attendance_id, v_out_attendance,
        COALESCE(v_table_name, 'Bàn'), v_zone, COALESCE(v_new_name, 'Dealer'), v_new_username,
        v_out_name, v_out_username, v_row.planned_relief_at,
        GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_row.planned_relief_at - NOW())) / 60)::INT),
        v_chat_id
      );
      v_telegram := 'enqueued';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN v_telegram := 'duplicate_skipped';
    WHEN OTHERS THEN v_telegram := 'enqueue_failed: ' || SQLERRM;
  END;

  RETURN jsonb_build_object(
    'outcome',           'changed',
    'schedule_id',       p_schedule_id,
    'table_id',          v_row.table_id,
    'assignment_id',     v_row.assignment_id,
    'old_attendance_id', v_old_attendance,
    'new_attendance_id', p_new_attendance_id,
    'planned_relief_at', v_row.planned_relief_at,
    'was_announced',     v_was_announced,
    'telegram',          v_telegram,
    'old_job',           v_old_job
  );

EXCEPTION
  -- uq_rotation_locked_dealer backstop firing on the schedule UPDATE means
  -- another transaction locked the chosen dealer between the pre-check and
  -- the write — typed outcome, full rollback either way. (pre_announce
  -- duplicates can't reach here: the nested block swallows them first.)
  WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome','dealer_already_locked','detail',SQLERRM);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$function$;

-- Frontend-callable (staff gate inside); anon stays out.
REVOKE EXECUTE ON FUNCTION public.set_rotation_slot_dealer(uuid, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_rotation_slot_dealer(uuid, integer, uuid, text) TO authenticated, service_role;
