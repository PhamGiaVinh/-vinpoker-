-- Harden complete_dealer_break: self-heal a dealer stuck in current_state='on_break'
-- with NO open dealer_breaks row.
--
-- Bug: pressing "Kết thúc nghỉ" calls complete_dealer_break(). The original body
-- only flips current_state -> 'available' when it FINDS an open break row
-- (break_end IS NULL). If the break row was already closed / is missing while the
-- attendance is still current_state='on_break' (orphaned state), it returned
-- {status:'no_open_break'} and left the dealer stuck out of the available pool —
-- the operator-reported "dealer không trở về pool available" (e.g. dl 24, dl 28).
--
-- Fix: when no open break is found, if the attendance is nonetheless stuck in
-- 'on_break', recover it to 'available' (idempotent; never touches an 'assigned'
-- dealer who is at a table). Happy path unchanged.
--
-- Idempotency: re-running on an already-available dealer updates 0 rows and
-- returns 'no_open_break' exactly as before. No schema change. SECURITY DEFINER
-- + search_path preserved.

CREATE OR REPLACE FUNCTION public.complete_dealer_break(p_attendance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_break_id UUID;
  v_break_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
  v_recovered BOOLEAN := false;
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
    -- No open break row. Recover an orphaned 'on_break' attendance back to the
    -- pool so "Kết thúc nghỉ" still works. Only touch a dealer who is genuinely
    -- stuck on_break (never an 'assigned' dealer at a table).
    UPDATE public.dealer_attendance
    SET current_state = 'available',
        worked_minutes_since_last_break = 0,
        priority_break_flag = false,
        pool_entered_at = v_now,
        updated_at = v_now
    WHERE id = p_attendance_id
      AND current_state = 'on_break';
    GET DIAGNOSTICS v_recovered = ROW_COUNT;

    IF v_recovered THEN
      RETURN jsonb_build_object('status', 'recovered_no_open_break');
    END IF;
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
$function$;
