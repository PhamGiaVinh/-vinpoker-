-- Migration: Fix missing columns causing process-swing failures
-- 1. Add updated_at to dealer_attendance (used by many functions)
-- 2. Add table_id to tournament_tables (used by get_effective_swing_config, fillEmptyTables)
-- 3. Add total_worked_minutes alias to dealer_shift_metrics view
-- 4. Fix functions that reference these columns

-- ============================================
-- 1. Add updated_at to dealer_attendance
-- ============================================
ALTER TABLE dealer_attendance
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows
UPDATE dealer_attendance
SET updated_at = GREATEST(created_at, check_in_time, last_released_at, pre_assigned_at, last_meal_break_at)
WHERE updated_at IS NULL;

-- ============================================
-- 2. Add table_id to tournament_tables
-- ============================================
ALTER TABLE tournament_tables
ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES game_tables(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_tournament_tables_table_id ON tournament_tables(table_id);

-- Populate table_id for existing rows by matching table_name with game_tables
-- Only update rows where table_id is NULL
UPDATE tournament_tables tt
SET table_id = gt.id
FROM game_tables gt
WHERE tt.table_id IS NULL
  AND tt.table_name = gt.table_name
  AND gt.club_id = (
    SELECT club_id FROM tournaments WHERE id = tt.tournament_id
  );

-- ============================================
-- 3. Fix dealer_shift_metrics view: add total_worked_minutes alias
-- ============================================
DROP VIEW IF EXISTS dealer_shift_metrics CASCADE;

CREATE VIEW dealer_shift_metrics AS
 SELECT da.id AS attendance_id,
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
    COALESCE(( SELECT sum(EXTRACT(epoch FROM COALESCE(db_1.break_end, now()) - db_1.break_start) / 60::numeric) AS sum
           FROM dealer_breaks db_1
             JOIN dealer_assignments dass_break ON dass_break.id = db_1.assignment_id
          WHERE dass_break.attendance_id = da.id), 0::numeric)::integer AS total_break_minutes,
    max(db.break_end) AS last_break_end,
    max(db.break_start) AS last_break_start,
    EXTRACT(epoch FROM now() - COALESCE(( SELECT max(dassign.released_at) AS max
           FROM dealer_assignments dassign
          WHERE dassign.attendance_id = da.id AND dassign.released_at IS NOT NULL), da.check_in_time, now())) / 60::numeric AS minutes_since_rest,
    (( SELECT count(*) AS count
           FROM dealer_assignments dassign
          WHERE dassign.attendance_id = da.id AND dassign.released_at IS NOT NULL))::integer AS total_assignments,
    ( SELECT dassign.table_id
           FROM dealer_assignments dassign
          WHERE dassign.attendance_id = da.id AND dassign.released_at IS NOT NULL
          ORDER BY dassign.released_at DESC
         LIMIT 1) AS last_table_id,
    da.pre_assigned_table_id,
    da.pre_assigned_at,
    da.created_at,
    da.updated_at,
    d.club_id,
    d.status AS dealer_status,
    da.total_worked_minutes_today AS total_worked_minutes
   FROM dealer_attendance da
     JOIN dealers d ON d.id = da.dealer_id
     LEFT JOIN dealer_assignments dass ON dass.attendance_id = da.id
     LEFT JOIN dealer_breaks db ON db.assignment_id = dass.id
  GROUP BY da.id, da.dealer_id, d.full_name, d.tier, d.skills, da.shift_date, da.current_state, da.priority_break_flag, da.worked_minutes_since_last_break, da.total_worked_minutes_today, da.status, da.pre_assigned_table_id, da.pre_assigned_at, da.created_at, da.updated_at, d.club_id, d.status;

-- ============================================
-- 4. Fix add_player_with_reentry (overload 1) - uses table_id in tournament_tables
-- ============================================
CREATE OR REPLACE FUNCTION public.add_player_with_reentry(p_tournament_id uuid, p_player_id uuid, p_table_id uuid, p_seat_number integer, p_chip_count integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_next_entry INT;
  v_table_exists INT;
  v_seat_taken INT;
  v_result JSONB;
BEGIN
  SELECT 1 INTO v_table_exists
  FROM public.tournament_tables
  WHERE tournament_id = p_tournament_id AND table_id = p_table_id;

  IF v_table_exists IS NULL THEN
    RETURN jsonb_build_object('error', 'Table does not belong to this tournament');
  END IF;

  SELECT 1 INTO v_seat_taken
  FROM public.tournament_seats
  WHERE table_id = p_table_id
    AND seat_number = p_seat_number
    AND is_active = true;

  IF v_seat_taken IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Seat already occupied');
  END IF;

  IF p_chip_count < 0 THEN
    RETURN jsonb_build_object('error', 'chip_count must be >= 0');
  END IF;

  SELECT COALESCE(MAX(entry_number), 0) + 1 INTO v_next_entry
  FROM public.tournament_seats
  WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  INSERT INTO public.tournament_seats (
    tournament_id, player_id, table_id, seat_number,
    entry_number, chip_count, is_active
  ) VALUES (
    p_tournament_id, p_player_id, p_table_id, p_seat_number,
    v_next_entry, p_chip_count, true
  ) RETURNING jsonb_build_object(
    'seat_id', id,
    'player_id', player_id,
    'entry_number', entry_number,
    'table_id', table_id,
    'seat_number', seat_number,
    'chip_count', chip_count,
    'is_active', is_active
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ============================================
-- 5. Fix get_effective_swing_config - uses tt.table_id
-- ============================================
CREATE OR REPLACE FUNCTION public.get_effective_swing_config(p_table_id uuid)
 RETURNS TABLE(swing_duration_minutes integer, warn_at_minutes integer, crit_at_minutes integer, source text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    v_club_id UUID;
    v_tournament_id UUID;
    v_result RECORD;
BEGIN
    -- Get club_id from table
    SELECT gt.club_id INTO v_club_id
    FROM game_tables gt
    WHERE gt.id = p_table_id;

    IF v_club_id IS NULL THEN
        RETURN;
    END IF;

    -- Priority 1: Table-level override
    SELECT
        sc.swing_duration_minutes,
        sc.warn_at_minutes,
        sc.crit_at_minutes,
        'table'::TEXT as source
    INTO v_result
    FROM swing_configs sc
    WHERE sc.scope_type = 'table'
      AND sc.scope_id = p_table_id
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT
            v_result.swing_duration_minutes,
            v_result.warn_at_minutes,
            v_result.crit_at_minutes,
            v_result.source;
        RETURN;
    END IF;

    -- Priority 2: Tournament config
    SELECT t.id INTO v_tournament_id
    FROM tournament_tables tt
    JOIN tournaments t ON t.id = tt.tournament_id
    WHERE tt.table_id = p_table_id
      AND t.status = 'active'
    LIMIT 1;

    IF v_tournament_id IS NOT NULL THEN
        SELECT
            t.swing_duration_minutes,
            t.warn_at_minutes,
            t.crit_at_minutes,
            'tournament'::TEXT as source
        INTO v_result
        FROM tournaments t
        WHERE t.id = v_tournament_id;

        IF FOUND THEN
            RETURN QUERY SELECT
                v_result.swing_duration_minutes,
                v_result.warn_at_minutes,
                v_result.crit_at_minutes,
                v_result.source;
            RETURN;
        END IF;
    END IF;

    -- Priority 3: Club default
    SELECT
        sc.swing_duration_minutes,
        sc.warn_at_minutes,
        sc.crit_at_minutes,
        'club'::TEXT as source
    INTO v_result
    FROM swing_configs sc
    WHERE sc.scope_type = 'club'
      AND sc.scope_id = v_club_id
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT
            v_result.swing_duration_minutes,
            v_result.warn_at_minutes,
            v_result.crit_at_minutes,
            v_result.source;
        RETURN;
    END IF;

    -- Fallback: hardcoded defaults
    RETURN QUERY SELECT 30, 25, 28, 'default'::TEXT;
END;
$function$;

-- ============================================
-- 6. Fix end_expired_breaks - uses updated_at on dealer_attendance
-- ============================================
CREATE OR REPLACE FUNCTION public.end_expired_breaks(p_club_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(attendance_id uuid, dealer_name text, break_start timestamp with time zone, expected_duration_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT DISTINCT ON (da.id)
      da.id AS att_id,
      d.full_name AS d_name,
      db.break_start AS br_start,
      db.expected_duration_minutes AS exp_min
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    JOIN dealer_assignments dass ON dass.attendance_id = da.id
    JOIN dealer_breaks db ON db.assignment_id = dass.id
    WHERE da.current_state = 'on_break'
      AND da.status = 'checked_in'
      AND db.break_end IS NULL
      AND NOW() > db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
    ORDER BY da.id, db.break_start DESC
  )
  UPDATE dealer_attendance da
  SET
    current_state = 'available',
    priority_break_flag = false,
    worked_minutes_since_last_break = 0,
    last_released_at = NULL,
    updated_at = NOW()
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$function$;

-- ============================================
-- 7. Fix transition_dealer_state - uses updated_at on dealer_attendance
-- ============================================
CREATE OR REPLACE FUNCTION public.transition_dealer_state(p_attendance_id uuid, p_new_state text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_state TEXT;
  v_valid     BOOLEAN;
BEGIN
  SELECT current_state INTO v_old_state
  FROM dealer_attendance
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTENDANCE_NOT_FOUND');
  END IF;

  IF v_old_state = p_new_state THEN
    RETURN jsonb_build_object(
      'ok', true, 'from', v_old_state, 'to', p_new_state, 'noop', true
    );
  END IF;

  v_valid := CASE
    WHEN v_old_state = 'available'     AND p_new_state IN ('pre_assigned','assigned','in_transition','on_break','checked_out') THEN true
    WHEN v_old_state = 'pre_assigned'  AND p_new_state IN ('assigned','available','checked_out') THEN true
    WHEN v_old_state = 'assigned'      AND p_new_state IN ('on_break','in_transition','available','checked_out') THEN true
    WHEN v_old_state = 'in_transition' AND p_new_state IN ('assigned','available','on_break','checked_out') THEN true
    WHEN v_old_state = 'on_break'      AND p_new_state IN ('available','in_transition','checked_out') THEN true
    WHEN v_old_state = 'swing_ready'   AND p_new_state IN ('in_transition','available','checked_out') THEN true
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INVALID_TRANSITION',
      'from', v_old_state,
      'to', p_new_state
    );
  END IF;

  PERFORM set_config(
    'app.state_reason',
    COALESCE(p_reason, 'transition_dealer_state'),
    true
  );

  -- Branch on reason for worked_minutes handling
  IF p_new_state = 'available' AND p_reason = 'meal_break_end' THEN
    -- FREEZE: meal break end — do NOT reset worked_minutes
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        updated_at = NOW()
    WHERE id = p_attendance_id;
  ELSIF p_new_state = 'available' THEN
    -- Default: reset worked_minutes
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        worked_minutes_since_last_break = 0,
        updated_at = NOW()
    WHERE id = p_attendance_id;
  ELSE
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        updated_at = NOW()
    WHERE id = p_attendance_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_old_state,
    'to', p_new_state,
    'reason', p_reason
  );
END;
$function$;

-- ============================================
-- 8. Fix cleanup_stale_attendance - uses updated_at
-- ============================================
CREATE OR REPLACE FUNCTION public.cleanup_stale_attendance(p_club_id uuid DEFAULT NULL::uuid, p_stale_threshold_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff       TIMESTAMPTZ;
  v_cleaned      INT := 0;
  v_dealer_ids   UUID[];
  v_result       JSONB;
BEGIN
  v_cutoff := NOW() - (p_stale_threshold_hours || ' hours')::INTERVAL;

  -- Collect affected dealer IDs for reporting
  SELECT ARRAY_AGG(DISTINCT da.dealer_id)
  INTO v_dealer_ids
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE (p_club_id IS NULL OR d.club_id = p_club_id)
    AND da.check_out_time IS NULL
    AND da.check_in_time < v_cutoff
    AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition');

  -- Release any dangling assignments attached to these stale attendances
  WITH released_assignments AS (
    UPDATE dealer_assignments da2
    SET
      status = 'completed',
      released_at = NOW(),
      swing_processed_at = COALESCE(swing_processed_at, NOW()),
      updated_at = NOW()
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    WHERE da2.attendance_id = da.id
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
      AND da.check_out_time IS NULL
      AND da.check_in_time < v_cutoff
      AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition')
      AND da2.released_at IS NULL
      AND da2.status = 'assigned'
    RETURNING da2.id
  )
  SELECT COUNT(*) INTO v_cleaned FROM released_assignments;

  -- Mark stale attendances as 'checked_out' with estimated checkout
  UPDATE dealer_attendance
  SET
    current_state  = 'checked_out',
    status         = 'checked_out',
    check_out_time = check_in_time + INTERVAL '8 hours',
    updated_at     = NOW()
  FROM dealers d
  WHERE d.id = dealer_attendance.dealer_id
    AND (p_club_id IS NULL OR d.club_id = p_club_id)
    AND dealer_attendance.check_out_time IS NULL
    AND dealer_attendance.check_in_time < v_cutoff
    AND dealer_attendance.current_state IN ('assigned', 'pre_assigned', 'in_transition');

  RETURN jsonb_build_object(
    'ok', true,
    'cleaned', v_cleaned,
    'dealer_ids', v_dealer_ids
  );
END;
$function$;

-- ============================================
-- 9. Validation: verify all fixes applied
-- ============================================
DO $$
BEGIN
  -- Check updated_at exists on dealer_attendance
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_attendance' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'dealer_attendance.updated_at column missing';
  END IF;

  -- Check table_id exists on tournament_tables
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournament_tables' AND column_name = 'table_id'
  ) THEN
    RAISE EXCEPTION 'tournament_tables.table_id column missing';
  END IF;

  -- Check total_worked_minutes exists in dealer_shift_metrics view
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_shift_metrics' AND column_name = 'total_worked_minutes'
  ) THEN
    RAISE EXCEPTION 'dealer_shift_metrics.total_worked_minutes column missing';
  END IF;

  -- Check updated_at exists in dealer_shift_metrics view
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_shift_metrics' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'dealer_shift_metrics.updated_at column missing';
  END IF;

  RAISE NOTICE 'All validation checks passed successfully';
END;
$$;
