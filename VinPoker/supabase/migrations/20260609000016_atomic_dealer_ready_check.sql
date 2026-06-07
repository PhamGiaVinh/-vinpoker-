-- Phase 5 PR #1 - BUG #1: Atomic dealer ready check RPC
-- Prevents race condition between NOTIFY trigger firing and edge function processing
-- Uses FOR UPDATE SKIP LOCKED to allow concurrent checks (only one wins)

CREATE OR REPLACE FUNCTION public.atomic_dealer_ready_check(
  p_club_id UUID,
  p_attendance_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_state TEXT;
  v_club_id_match BOOLEAN;
  v_check_in_time TIMESTAMPTZ;
  v_last_break_end TIMESTAMPTZ;
  v_rest_min INTEGER;
  v_threshold INTEGER;
  v_verification_token TEXT;
BEGIN
  -- Get rest threshold for this club from swing_config
  SELECT COALESCE(sc.break_duration_minutes, 15)
  INTO   v_threshold
  FROM   public.club_settings cs
  LEFT JOIN public.swing_config sc
    ON sc.club_id = cs.club_id
    AND sc.table_type = 'cash'
  WHERE  cs.club_id = p_club_id;

  v_threshold := COALESCE(v_threshold, 15);

  -- FOR UPDATE SKIP LOCKED: if another tx is processing this dealer, skip
  SELECT dat.current_state,
         dat.check_in_time,
         (d.club_id = p_club_id)
  INTO   v_state, v_check_in_time, v_club_id_match
  FROM   public.dealer_attendance dat
  INNER JOIN public.dealers d ON d.id = dat.dealer_id
  WHERE  dat.id = p_attendance_id
  FOR UPDATE OF dat SKIP LOCKED;

  -- Row not found or already locked by concurrent tx
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'skipped', 'dealer_not_found_or_locked',
      'attendance_id', p_attendance_id
    );
  END IF;

  -- Club mismatch (shouldn't happen but safety check)
  IF NOT v_club_id_match THEN
    RETURN jsonb_build_object(
      'skipped', 'club_mismatch',
      'attendance_id', p_attendance_id
    );
  END IF;

  -- State changed between trigger and edge function
  IF v_state != 'available' THEN
    RETURN jsonb_build_object(
      'skipped', 'state_changed',
      'current_state', v_state,
      'attendance_id', p_attendance_id
    );
  END IF;

  -- Generate verification token for downstream use
  v_verification_token := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');

  -- Get last break end time
  SELECT MAX(break_end) INTO v_last_break_end
  FROM   public.dealer_breaks db
  JOIN   public.dealer_assignments da ON da.id = db.assignment_id
  WHERE  da.attendance_id = p_attendance_id;

  -- Calculate current rest in minutes
  v_rest_min := EXTRACT(EPOCH FROM (now() - COALESCE(v_last_break_end, v_check_in_time, now())))::INT / 60;

  IF v_rest_min < 0 THEN
    v_rest_min := 0;
  END IF;

  RETURN jsonb_build_object(
    'verified', true,
    'attendance_id', p_attendance_id,
    'club_id', p_club_id,
    'rest_min', v_rest_min,
    'rest_threshold_min', v_threshold,
    'verification_token', v_verification_token,
    'verified_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atomic_dealer_ready_check(UUID, UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.atomic_dealer_ready_check IS
  'Phase 5 PR #1 BUG #1: Atomic state check with row-level lock.
   Returns {skipped: reason} if dealer not found, locked, or state changed.
   Returns {verified: true, verification_token, rest_min, rest_threshold_min} on success.';
