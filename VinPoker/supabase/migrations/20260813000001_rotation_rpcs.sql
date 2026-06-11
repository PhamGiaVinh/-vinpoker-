-- Forward Rotation Scheduler — slot RPCs.
--
-- Single-writer rule: ONLY these functions may set/clear
-- dealer_assignments.pre_assigned_attendance_id and planned_relief_at going
-- forward (healers excepted — the planner reconciles after them).
-- lock_rotation_slot clones the CAS/rollback discipline of
-- pre_assign_next_dealer_for_table (20260806000000) WITHOUT the swing_due_at
-- write: swing_due_at is immutable after assignment creation.

BEGIN;

-- ============================================================
-- lock_rotation_slot — CHỐT: predicted → announced + dealer lock
-- ============================================================
CREATE OR REPLACE FUNCTION public.lock_rotation_slot(
  p_schedule_id      UUID,
  p_schedule_version INT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row              public.dealer_rotation_schedule%ROWTYPE;
  v_assignment_version INT;
BEGIN
  SELECT * INTO v_row
  FROM dealer_rotation_schedule
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost','detail','Schedule row not found');
  END IF;

  IF v_row.status != 'predicted' THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail', format('Schedule row is %s, not predicted', v_row.status));
  END IF;

  IF v_row.version != p_schedule_version THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail', format('Schedule version mismatch: expected %s, got %s',
                       p_schedule_version, v_row.version));
  END IF;

  IF v_row.slot_index != 0 OR v_row.in_attendance_id IS NULL OR v_row.assignment_id IS NULL THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail','Only slot 0 with a concrete dealer and assignment can be locked');
  END IF;

  -- Lock the assignment being relieved.
  SELECT version INTO v_assignment_version
  FROM dealer_assignments
  WHERE id = v_row.assignment_id
    AND status = 'assigned'
    AND released_at IS NULL
    AND swing_processed_at IS NULL
    AND pre_assigned_attendance_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost',
      'detail','Assignment no longer active or already pre-assigned');
  END IF;

  -- Lock the incoming dealer.
  PERFORM id
  FROM dealer_attendance
  WHERE id = v_row.in_attendance_id
    AND current_state = 'available'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','dealer_unavailable',
      'detail','Dealer not in available state');
  END IF;

  -- CHỐT: same pre-assign representation, planned_relief_at instead of a due push.
  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = v_row.in_attendance_id,
    pre_assigned_at            = NOW(),
    planned_relief_at          = v_row.planned_relief_at,
    version                    = version + 1,
    updated_at                 = NOW()
  WHERE id = v_row.assignment_id
    AND version = v_assignment_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','race_lost','detail','CAS update failed on assignment');
  END IF;

  UPDATE dealer_attendance
  SET
    current_state         = 'pre_assigned',
    pre_assigned_table_id = v_row.table_id,
    pre_assigned_at       = NOW(),
    updated_at            = NOW()
  WHERE id = v_row.in_attendance_id
    AND current_state = 'available';

  IF NOT FOUND THEN
    -- Roll the assignment back; dealer state changed between lock and update.
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      planned_relief_at          = NULL,
      version                    = v_assignment_version,
      updated_at                 = NOW()
    WHERE id = v_row.assignment_id;

    RETURN jsonb_build_object('outcome','dealer_unavailable',
      'detail','Dealer state changed between lock and update');
  END IF;

  UPDATE dealer_rotation_schedule
  SET status = 'announced', version = version + 1, updated_at = NOW()
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object(
    'outcome','locked',
    'schedule_id', p_schedule_id,
    'assignment_id', v_row.assignment_id,
    'in_attendance_id', v_row.in_attendance_id,
    'planned_relief_at', v_row.planned_relief_at
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$$;

-- ============================================================
-- cancel_rotation_slot — release a predicted/announced slot
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_rotation_slot(
  p_schedule_id UUID,
  p_reason      TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.dealer_rotation_schedule%ROWTYPE;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_row
  FROM dealer_rotation_schedule
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','noop','detail','Schedule row not found');
  END IF;

  IF v_row.status NOT IN ('predicted','announced') THEN
    RETURN jsonb_build_object('outcome','noop',
      'detail', format('Schedule row already %s', v_row.status));
  END IF;

  v_new_status := CASE WHEN p_reason = 'no_show' THEN 'no_show' ELSE 'cancelled' END;

  IF v_row.status = 'announced' THEN
    -- Undo the CHỐT on the assignment (only if it still points at our dealer).
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      planned_relief_at          = NULL,
      version                    = version + 1,
      updated_at                 = NOW()
    WHERE id = v_row.assignment_id
      AND pre_assigned_attendance_id = v_row.in_attendance_id;

    -- Release the dealer (only if still reserved for OUR table).
    UPDATE dealer_attendance
    SET
      current_state         = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at       = NULL,
      updated_at            = NOW()
    WHERE id = v_row.in_attendance_id
      AND current_state = 'pre_assigned'
      AND pre_assigned_table_id = v_row.table_id;
  END IF;

  UPDATE dealer_rotation_schedule
  SET
    status     = v_new_status,
    reason     = v_row.reason || jsonb_build_object('cancel_reason', p_reason),
    version    = version + 1,
    updated_at = NOW()
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object('outcome', v_new_status, 'schedule_id', p_schedule_id);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$$;

-- ============================================================
-- upsert_rotation_plan — persist a planner run (batch)
-- Supersedes the club's previous predicted rows, inserts the new plan.
-- NEVER touches announced/executing rows (CHỐT is sticky) and NEVER writes
-- dealer_assignments (predicted rows don't lock anything).
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_rotation_plan(
  p_club_id     UUID,
  p_plan_run_id UUID,
  p_rows        JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_superseded INT := 0;
  v_inserted   INT := 0;
  v_skipped    INT := 0;
  r JSONB;
BEGIN
  -- Retire every previous prediction for this club in one stroke.
  UPDATE dealer_rotation_schedule
  SET status = 'superseded', version = version + 1, updated_at = NOW()
  WHERE club_id = p_club_id
    AND status = 'predicted';
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    BEGIN
      INSERT INTO dealer_rotation_schedule (
        club_id, table_id, assignment_id, slot_index,
        out_attendance_id, in_attendance_id,
        planned_relief_at, announce_at,
        status, is_shortage, is_emergency,
        plan_run_id, solver_version, score, reason
      ) VALUES (
        p_club_id,
        (r->>'table_id')::uuid,
        NULLIF(r->>'assignment_id','')::uuid,
        COALESCE((r->>'slot_index')::int, 0),
        NULLIF(r->>'out_attendance_id','')::uuid,
        NULLIF(r->>'in_attendance_id','')::uuid,
        (r->>'planned_relief_at')::timestamptz,
        NULLIF(r->>'announce_at','')::timestamptz,
        'predicted',
        COALESCE((r->>'is_shortage')::boolean, false),
        COALESCE((r->>'is_emergency')::boolean, false),
        p_plan_run_id,
        COALESCE(r->>'solver_version','unknown'),
        NULLIF(r->>'score','')::numeric,
        COALESCE(r->'reason','{}'::jsonb)
      );
      v_inserted := v_inserted + 1;
    EXCEPTION
      WHEN unique_violation THEN
        -- A live announced/executing row owns this (table,slot) — CHỐT is sticky.
        v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'outcome','ok',
    'superseded', v_superseded,
    'inserted',   v_inserted,
    'skipped',    v_skipped,
    'plan_run_id', p_plan_run_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$$;

-- ============================================================
-- complete_rotation_slot — execution finished for an announced slot
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_rotation_slot(
  p_schedule_id       UUID,
  p_new_assignment_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.dealer_rotation_schedule%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM dealer_rotation_schedule
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','noop','detail','Schedule row not found');
  END IF;

  IF v_row.status NOT IN ('announced','executing') THEN
    RETURN jsonb_build_object('outcome','noop',
      'detail', format('Schedule row is %s', v_row.status));
  END IF;

  UPDATE dealer_rotation_schedule
  SET
    status     = 'executed',
    reason     = v_row.reason || jsonb_build_object('new_assignment_id', p_new_assignment_id),
    version    = version + 1,
    updated_at = NOW()
  WHERE id = p_schedule_id;

  -- The relieved assignment is completed by the swing RPC; clear its cache
  -- defensively in case the row lingers.
  UPDATE dealer_assignments
  SET planned_relief_at = NULL, updated_at = NOW()
  WHERE id = v_row.assignment_id
    AND planned_relief_at IS NOT NULL;

  RETURN jsonb_build_object('outcome','executed','schedule_id', p_schedule_id);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$$;

-- ============================================================
-- get_rotation_board — denormalized feed for the dealer-control board
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_rotation_board(p_club_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tables jsonb;
  v_pool   jsonb;
BEGIN
  -- Club staff only (or service_role, whose auth.uid() is NULL → covered by grant).
  IF auth.uid() IS NOT NULL
     AND NOT public.is_club_dealer_control(auth.uid(), p_club_id)
     AND NOT public.is_club_admin(auth.uid(), p_club_id)
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role)
  THEN
    RETURN jsonb_build_object('outcome','forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t->>'table_name'), '[]'::jsonb) INTO v_tables
  FROM (
    SELECT jsonb_build_object(
      'table_id', gt.id,
      'table_name', gt.table_name,
      'tour_tier', gt.tour_tier,
      'assignment_id', da.id,
      'assigned_at', da.assigned_at,
      'swing_due_at', da.swing_due_at,
      'planned_relief_at', da.planned_relief_at,
      'overtime_started_at', da.overtime_started_at,
      'current_dealer', jsonb_build_object(
        'attendance_id', att.id,
        'full_name', d.full_name,
        'tier', d.tier
      ),
      'slots', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'schedule_id', s.id,
          'slot_index', s.slot_index,
          'status', s.status,
          'planned_relief_at', s.planned_relief_at,
          'announce_at', s.announce_at,
          'is_shortage', s.is_shortage,
          'is_emergency', s.is_emergency,
          'in_attendance_id', s.in_attendance_id,
          'in_dealer_name', ind.full_name,
          'in_dealer_tier', ind.tier
        ) ORDER BY s.slot_index), '[]'::jsonb)
        FROM dealer_rotation_schedule s
        LEFT JOIN dealer_attendance ia ON ia.id = s.in_attendance_id
        LEFT JOIN dealers ind ON ind.id = ia.dealer_id
        WHERE s.table_id = gt.id
          AND s.status IN ('predicted','announced','executing')
      )
    ) AS t
    FROM game_tables gt
    LEFT JOIN dealer_assignments da
      ON da.table_id = gt.id AND da.status = 'assigned' AND da.released_at IS NULL
    LEFT JOIN dealer_attendance att ON att.id = da.attendance_id
    LEFT JOIN dealers d ON d.id = att.dealer_id
    WHERE gt.club_id = p_club_id
      AND gt.status = 'active'
  ) sub;

  SELECT COALESCE(jsonb_agg(p ORDER BY (p->>'last_released_at') NULLS FIRST), '[]'::jsonb) INTO v_pool
  FROM (
    SELECT jsonb_build_object(
      'attendance_id', a.id,
      'full_name', d.full_name,
      'tier', d.tier,
      'current_state', a.current_state,
      'last_released_at', lr.last_released_at,
      'prev_session_minutes', lr.prev_session_minutes
    ) AS p
    FROM dealer_attendance a
    JOIN dealers d ON d.id = a.dealer_id
    LEFT JOIN LATERAL (
      SELECT
        da2.released_at AS last_released_at,
        GREATEST(0, ROUND(EXTRACT(EPOCH FROM (da2.released_at - da2.assigned_at)) / 60))::int
          AS prev_session_minutes
      FROM dealer_assignments da2
      WHERE da2.attendance_id = a.id AND da2.released_at IS NOT NULL
      ORDER BY da2.released_at DESC
      LIMIT 1
    ) lr ON TRUE
    WHERE a.club_id = p_club_id
      AND a.status = 'checked_in'
      AND a.current_state IN ('available','on_break','pre_assigned')
  ) sub;

  RETURN jsonb_build_object('outcome','ok','tables', v_tables, 'pool', v_pool);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$$;

-- Grants: planner RPCs are service-role only; the board feed is also for staff UIs.
REVOKE EXECUTE ON FUNCTION public.lock_rotation_slot(UUID, INT)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_rotation_slot(UUID, TEXT)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_rotation_plan(UUID, UUID, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_rotation_slot(UUID, UUID)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_rotation_board(UUID)             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.lock_rotation_slot(UUID, INT)            TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_rotation_slot(UUID, TEXT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_rotation_plan(UUID, UUID, JSONB)  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_rotation_slot(UUID, UUID)       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_rotation_board(UUID)                 TO service_role, authenticated;

COMMIT;
