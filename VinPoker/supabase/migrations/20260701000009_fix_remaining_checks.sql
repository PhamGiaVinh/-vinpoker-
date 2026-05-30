-- Fix verify_swing_queries: remove non-existent state column check, add audit log check

CREATE OR REPLACE FUNCTION verify_swing_queries(p_club_id uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb[];
  v_json jsonb;
  v_cnt int;
  v_uniq int;
  v_has_due int;
  v_col text;
  v_avail int;
  v_weighted numeric;
  v_bool boolean;
BEGIN
  SELECT count(*) INTO v_cnt FROM dealers WHERE club_id = p_club_id AND status = 'active';
  v_results := array_append(v_results, jsonb_build_object('check', 'Dealers >= 8', 'pass', v_cnt >= 8, 'value', v_cnt));
  SELECT count(*) INTO v_cnt FROM game_tables WHERE club_id = p_club_id AND status = 'active';
  v_results := array_append(v_results, jsonb_build_object('check', 'Tables >= 3', 'pass', v_cnt >= 3, 'value', v_cnt));
  SELECT count(*) INTO v_cnt FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE d.club_id = p_club_id AND da.status = 'checked_in';
  v_results := array_append(v_results, jsonb_build_object('check', 'Check-ins >= 5', 'pass', v_cnt >= 5, 'value', v_cnt));
  SELECT count(*) INTO v_cnt FROM dealer_assignments WHERE status = 'assigned';
  v_results := array_append(v_results, jsonb_build_object('check', 'Assignments >= 1', 'pass', v_cnt >= 1, 'value', v_cnt));

  SELECT count(*) INTO v_cnt FROM swing_config WHERE club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'Swing config exists', 'pass', v_cnt >= 1, 'value', v_cnt));
  SELECT auto_swing_enabled INTO v_bool FROM club_settings WHERE club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'Auto swing enabled', 'pass', v_bool = true, 'value', v_bool));

  SELECT perform_swing(NULL, NULL, NULL) INTO v_json;
  v_results := array_append(v_results, jsonb_build_object('check', 'perform_swing null race_lost', 'pass', v_json->>'outcome' = 'race_lost', 'value', v_json->>'outcome'));

  SELECT execute_pre_assigned_swing(NULL, NULL, NULL::timestamptz, NULL::int) INTO v_json;
  v_results := array_append(v_results, jsonb_build_object('check', 'execute_pre_assigned_swing null error', 'pass', v_json->>'status' = 'error', 'value', v_json->>'status'));

  SELECT get_dealer_pool_snapshot(p_club_id) INTO v_json;
  v_results := array_append(v_results, jsonb_build_object('check', 'Pool snapshot exists', 'pass', v_json IS NOT NULL, 'value', v_json));
  v_avail := (v_json->>'available')::int;
  v_weighted := (v_json->>'weighted_pool')::numeric;
  IF v_avail IS NOT NULL THEN
    v_results := array_append(v_results, jsonb_build_object('check', 'Available >= 3', 'pass', v_avail >= 3, 'value', v_avail));
    v_results := array_append(v_results, jsonb_build_object('check', 'Weighted pool > 0', 'pass', v_weighted > 0, 'value', v_weighted));
  END IF;

  SELECT count(*)::int, count(DISTINCT attendance_id)::int INTO v_cnt, v_uniq FROM dealer_assignments WHERE status = 'assigned';
  v_results := array_append(v_results, jsonb_build_object('check', 'No duplicate dealers', 'pass', v_cnt = v_uniq, 'value', jsonb_build_object('total', v_cnt, 'unique', v_uniq)));

  SELECT column_name INTO v_col FROM information_schema.columns WHERE table_name = 'dealer_attendance' AND column_name = 'total_worked_minutes_today';
  v_results := array_append(v_results, jsonb_build_object('check', 'total_worked_minutes_today column', 'pass', v_col IS NOT NULL, 'value', v_col));

  SELECT count(*)::int, count(da.swing_due_at)::int INTO v_cnt, v_has_due
  FROM dealer_assignments da JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.status = 'assigned' AND gt.club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'Swing_due_at populated', 'pass', v_cnt > 0 AND v_cnt = v_has_due, 'value', jsonb_build_object('total', v_cnt, 'with_due', v_has_due)));

  BEGIN
    SELECT execute_pre_assigned_swing('00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid, now()::timestamptz, 45) INTO v_json;
    v_results := array_append(v_results, jsonb_build_object('check', 'Guard bad ID', 'pass', v_json->>'status' = 'error' OR v_json->>'outcome' = 'error', 'value', coalesce(v_json->>'status', v_json->>'outcome')));
  EXCEPTION WHEN OTHERS THEN
    v_results := array_append(v_results, jsonb_build_object('check', 'Guard bad ID threw', 'pass', true, 'value', SQLERRM));
  END;

  SELECT count(DISTINCT club_id)::int INTO v_cnt FROM swing_config;
  v_results := array_append(v_results, jsonb_build_object('check', 'Multi-club configs', 'pass', v_cnt >= 2, 'value', v_cnt));

  SELECT count(*)::int INTO v_cnt FROM dealer_shift_metrics WHERE club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'dealer_shift_metrics rows', 'pass', v_cnt > 0, 'value', v_cnt));

  -- Check audit logs exist from last swing run
  SELECT count(*) INTO v_cnt FROM swing_audit_logs WHERE club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'Audit logs exist', 'pass', v_cnt > 0, 'value', v_cnt));

  RETURN jsonb_build_object('results', v_results,
    'summary', jsonb_build_object(
      'total', array_length(v_results, 1),
      'passed', (SELECT count(*) FROM jsonb_array_elements(jsonb_build_object('results', v_results)->'results') AS r WHERE (r->>'pass')::boolean),
      'failed', (SELECT count(*) FROM jsonb_array_elements(jsonb_build_object('results', v_results)->'results') AS r WHERE NOT (r->>'pass')::boolean)
    ));
END;
$$;
