CREATE OR REPLACE FUNCTION public.transition_payroll_status(p_period_id uuid, p_expected_status character varying, p_new_status character varying, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated_id UUID;
BEGIN
  -- Set session variable for audit trigger
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  UPDATE payroll_periods
  SET
    status = p_new_status,
    updated_at = now(),
    submitted_by = CASE WHEN p_new_status = 'submitted' THEN p_user_id ELSE submitted_by END,
    submitted_at = CASE WHEN p_new_status = 'submitted' THEN now() ELSE submitted_at END,
    approved_by = CASE WHEN p_new_status = 'approved' THEN p_user_id ELSE approved_by END,
    approved_at = CASE WHEN p_new_status = 'approved' THEN now() ELSE approved_at END,
    locked_by = CASE WHEN p_new_status = 'locked' THEN p_user_id ELSE locked_by END,
    locked_at = CASE WHEN p_new_status = 'locked' THEN now() ELSE locked_at END
  WHERE id = p_period_id AND status = p_expected_status
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Status transition failed: expected % but period % was already modified',
      p_expected_status, p_period_id;
  END IF;

  RETURN TRUE;
END;
$function$
