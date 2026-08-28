-- Expand dealer_breaks so manual breaks from the available pool can be tracked
-- without assignment history, while keeping assignment-linked break rows working.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Schema expansion
-- ---------------------------------------------------------------------------
ALTER TABLE public.dealer_breaks
  ADD COLUMN IF NOT EXISTS attendance_id UUID REFERENCES public.dealer_attendance(id) ON DELETE CASCADE;

ALTER TABLE public.dealer_breaks
  ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;

ALTER TABLE public.dealer_breaks
  ALTER COLUMN assignment_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dealer_breaks_attendance ON public.dealer_breaks(attendance_id);
CREATE INDEX IF NOT EXISTS idx_dealer_breaks_club ON public.dealer_breaks(club_id);

-- Backfill legacy rows so existing assignment-linked breaks are searchable by attendance_id/club_id.
UPDATE public.dealer_breaks db
SET
  attendance_id = da.attendance_id,
  club_id = d.club_id
FROM public.dealer_assignments da
JOIN public.dealer_attendance att ON att.id = da.attendance_id
JOIN public.dealers d ON d.id = att.dealer_id
WHERE db.assignment_id = da.id
  AND (
    db.attendance_id IS DISTINCT FROM da.attendance_id
    OR db.club_id IS DISTINCT FROM d.club_id
  );

-- ---------------------------------------------------------------------------
-- 2) Auto-fill metadata for future inserts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_dealer_break_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assignment_id IS NULL AND NEW.attendance_id IS NULL THEN
    RAISE EXCEPTION 'dealer_breaks requires assignment_id or attendance_id';
  END IF;

  IF NEW.attendance_id IS NULL AND NEW.assignment_id IS NOT NULL THEN
    SELECT da.attendance_id
    INTO NEW.attendance_id
    FROM public.dealer_assignments da
    WHERE da.id = NEW.assignment_id;
  END IF;

  IF NEW.club_id IS NULL THEN
    IF NEW.attendance_id IS NOT NULL THEN
      SELECT d.club_id
      INTO NEW.club_id
      FROM public.dealer_attendance att
      JOIN public.dealers d ON d.id = att.dealer_id
      WHERE att.id = NEW.attendance_id;
    END IF;

    IF NEW.club_id IS NULL AND NEW.assignment_id IS NOT NULL THEN
      SELECT gt.club_id
      INTO NEW.club_id
      FROM public.dealer_assignments da
      JOIN public.game_tables gt ON gt.id = da.table_id
      WHERE da.id = NEW.assignment_id;
    END IF;
  END IF;

  IF NEW.club_id IS NULL THEN
    RAISE EXCEPTION 'dealer_breaks.club_id could not be resolved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealer_breaks_sync_metadata ON public.dealer_breaks;
CREATE TRIGGER trg_dealer_breaks_sync_metadata
  BEFORE INSERT ON public.dealer_breaks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_dealer_break_metadata();

-- ---------------------------------------------------------------------------
-- 3) RLS: allow club control to read/write by club_id when present, with
--    fallback to attendance/assignment joins for legacy rows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "dealer_breaks_select_control" ON public.dealer_breaks;
CREATE POLICY "dealer_breaks_select_control"
  ON public.dealer_breaks FOR SELECT
  USING (
    public.is_club_dealer_control(
      auth.uid(),
      COALESCE(
        dealer_breaks.club_id,
        (
          SELECT d.club_id
          FROM public.dealer_attendance att
          JOIN public.dealers d ON d.id = att.dealer_id
          WHERE att.id = dealer_breaks.attendance_id
        ),
        (
          SELECT gt.club_id
          FROM public.game_tables gt
          JOIN public.dealer_assignments da ON da.table_id = gt.id
          WHERE da.id = dealer_breaks.assignment_id
        )
      )
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(
      auth.uid(),
      COALESCE(
        dealer_breaks.club_id,
        (
          SELECT d.club_id
          FROM public.dealer_attendance att
          JOIN public.dealers d ON d.id = att.dealer_id
          WHERE att.id = dealer_breaks.attendance_id
        ),
        (
          SELECT gt.club_id
          FROM public.game_tables gt
          JOIN public.dealer_assignments da ON da.table_id = gt.id
          WHERE da.id = dealer_breaks.assignment_id
        )
      )
    )
  );

DROP POLICY IF EXISTS "dealer_breaks_insert_control" ON public.dealer_breaks;
CREATE POLICY "dealer_breaks_insert_control"
  ON public.dealer_breaks FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(
      auth.uid(),
      COALESCE(
        dealer_breaks.club_id,
        (
          SELECT d.club_id
          FROM public.dealer_attendance att
          JOIN public.dealers d ON d.id = att.dealer_id
          WHERE att.id = dealer_breaks.attendance_id
        ),
        (
          SELECT gt.club_id
          FROM public.game_tables gt
          JOIN public.dealer_assignments da ON da.table_id = gt.id
          WHERE da.id = dealer_breaks.assignment_id
        )
      )
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(
      auth.uid(),
      COALESCE(
        dealer_breaks.club_id,
        (
          SELECT d.club_id
          FROM public.dealer_attendance att
          JOIN public.dealers d ON d.id = att.dealer_id
          WHERE att.id = dealer_breaks.attendance_id
        ),
        (
          SELECT gt.club_id
          FROM public.game_tables gt
          JOIN public.dealer_assignments da ON da.table_id = gt.id
          WHERE da.id = dealer_breaks.assignment_id
        )
      )
    )
  );

DROP POLICY IF EXISTS "dealer_breaks_update_control" ON public.dealer_breaks;
CREATE POLICY "dealer_breaks_update_control"
  ON public.dealer_breaks FOR UPDATE
  USING (
    public.is_club_dealer_control(
      auth.uid(),
      COALESCE(
        dealer_breaks.club_id,
        (
          SELECT d.club_id
          FROM public.dealer_attendance att
          JOIN public.dealers d ON d.id = att.dealer_id
          WHERE att.id = dealer_breaks.attendance_id
        ),
        (
          SELECT gt.club_id
          FROM public.game_tables gt
          JOIN public.dealer_assignments da ON da.table_id = gt.id
          WHERE da.id = dealer_breaks.assignment_id
        )
      )
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(
      auth.uid(),
      COALESCE(
        dealer_breaks.club_id,
        (
          SELECT d.club_id
          FROM public.dealer_attendance att
          JOIN public.dealers d ON d.id = att.dealer_id
          WHERE att.id = dealer_breaks.attendance_id
        ),
        (
          SELECT gt.club_id
          FROM public.game_tables gt
          JOIN public.dealer_assignments da ON da.table_id = gt.id
          WHERE da.id = dealer_breaks.assignment_id
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4) dealer_shift_metrics view: compute breaks by attendance_id first so
--    manual breaks from the pool are included without double counting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.dealer_shift_metrics AS
SELECT
  da.id AS attendance_id,
  da.dealer_id,
  d.full_name,
  d.tier,
  d.skills,
  da.shift_date,
  da.current_state,
  da.priority_break_flag,
  da.worked_minutes_since_last_break,
  da.total_worked_minutes_today,
  da.status,
  COALESCE((
    SELECT SUM(
      EXTRACT(EPOCH FROM (COALESCE(db.break_end, NOW()) - db.break_start)) / 60
    )
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments db_assign ON db_assign.id = db.assignment_id
    WHERE COALESCE(db.attendance_id, db_assign.attendance_id) = da.id
  ), 0::numeric)::INTEGER AS total_break_minutes,
  (
    SELECT MAX(db.break_end)
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments db_assign ON db_assign.id = db.assignment_id
    WHERE COALESCE(db.attendance_id, db_assign.attendance_id) = da.id
  ) AS last_break_end,
  (
    SELECT MAX(db.break_start)
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments db_assign ON db_assign.id = db.assignment_id
    WHERE COALESCE(db.attendance_id, db_assign.attendance_id) = da.id
  ) AS last_break_start,
  EXTRACT(EPOCH FROM (
    NOW() - COALESCE(
      (
        SELECT MAX(dassign.released_at)
        FROM public.dealer_assignments dassign
        WHERE dassign.attendance_id = da.id
          AND dassign.released_at IS NOT NULL
      ),
      da.check_in_time,
      NOW()
    )
  )) / 60::numeric AS minutes_since_rest,
  (
    SELECT COUNT(*)
    FROM public.dealer_assignments dassign
    WHERE dassign.attendance_id = da.id
      AND dassign.released_at IS NOT NULL
  )::INTEGER AS total_assignments,
  (
    SELECT dassign.table_id
    FROM public.dealer_assignments dassign
    WHERE dassign.attendance_id = da.id
      AND dassign.released_at IS NOT NULL
    ORDER BY dassign.released_at DESC
    LIMIT 1
  ) AS last_table_id,
  da.pre_assigned_table_id,
  da.pre_assigned_at,
  da.created_at,
  da.updated_at,
  d.club_id,
  d.status AS dealer_status,
  da.total_worked_minutes_today AS total_worked_minutes
FROM public.dealer_attendance da
JOIN public.dealers d ON d.id = da.dealer_id
WHERE da.status = 'checked_in';

GRANT SELECT ON public.dealer_shift_metrics TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 5) Break completion / cleanup RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_dealer_break(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_id UUID;
  v_break_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT db.id, db.break_start
  INTO v_break_id, v_break_start
  FROM public.dealer_breaks db
  LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
  WHERE COALESCE(db.attendance_id, da.attendance_id) = p_attendance_id
    AND db.break_end IS NULL
  ORDER BY db.break_start DESC
  LIMIT 1
  FOR UPDATE OF db SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_open_break');
  END IF;

  UPDATE public.dealer_breaks
  SET break_end = v_now
  WHERE id = v_break_id;

  UPDATE public.dealer_attendance
  SET current_state = 'available',
      worked_minutes_since_last_break = 0,
      priority_break_flag = false,
      pool_entered_at = v_now,
      updated_at = v_now
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'break_id', v_break_id,
    'break_start', v_break_start
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.end_dealer_break(p_break_id UUID, p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT db.id
  INTO v_break_id
  FROM public.dealer_breaks db
  LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
  WHERE db.id = p_break_id
    AND COALESCE(db.attendance_id, da.attendance_id) = p_attendance_id
    AND db.break_end IS NULL
  LIMIT 1
  FOR UPDATE OF db SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_open_break');
  END IF;

  UPDATE public.dealer_breaks
  SET break_end = v_now
  WHERE id = v_break_id;

  UPDATE public.dealer_attendance
  SET current_state = 'available',
      worked_minutes_since_last_break = 0,
      priority_break_flag = false,
      pool_entered_at = v_now,
      updated_at = v_now
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object('outcome', 'success', 'break_id', v_break_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_stuck_breaks(p_club_id UUID)
RETURNS TABLE(
  break_id UUID,
  attendance_id UUID,
  dealer_id UUID,
  dealer_name TEXT,
  expected_min INT,
  overdue_min INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    db.id AS break_id,
    att.id AS attendance_id,
    att.dealer_id AS dealer_id,
    d.full_name AS dealer_name,
    db.expected_duration_minutes AS expected_min,
    GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (NOW() - db.break_start)) / 60) - db.expected_duration_minutes
    )::INT AS overdue_min
  FROM public.dealer_breaks db
  LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
  INNER JOIN public.dealer_attendance att
    ON att.id = COALESCE(db.attendance_id, da.attendance_id)
  INNER JOIN public.dealers d ON d.id = att.dealer_id
  WHERE d.club_id = p_club_id
    AND att.current_state = 'on_break'
    AND att.status = 'checked_in'
    AND db.break_end IS NULL
    AND db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL < NOW()
  ORDER BY overdue_min DESC;
$$;

GRANT EXECUTE ON FUNCTION public.detect_stuck_breaks(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.end_expired_breaks(p_club_id UUID DEFAULT NULL)
RETURNS TABLE(
  attendance_id UUID,
  dealer_name TEXT,
  break_start TIMESTAMPTZ,
  expected_duration_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT DISTINCT ON (att.id)
      att.id AS att_id,
      d.full_name AS d_name,
      db.break_start AS br_start,
      db.expected_duration_minutes AS exp_min
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
    INNER JOIN public.dealer_attendance att
      ON att.id = COALESCE(db.attendance_id, da.attendance_id)
    INNER JOIN public.dealers d ON d.id = att.dealer_id
    WHERE att.current_state = 'on_break'
      AND att.status = 'checked_in'
      AND db.break_end IS NULL
      AND NOW() > db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
    ORDER BY att.id, db.break_start DESC
  )
  UPDATE public.dealer_attendance da
  SET
    current_state = 'available',
    priority_break_flag = false,
    worked_minutes_since_last_break = 0,
    pool_entered_at = NOW(),
    updated_at = NOW()
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_dealer_break(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_dealer_break(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_expired_breaks(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
