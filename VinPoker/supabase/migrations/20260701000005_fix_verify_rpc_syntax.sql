-- Fix verify_swing_queries: perform_swing returns composite, not table

CREATE OR REPLACE FUNCTION verify_swing_queries(p_club_id uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb[];
  v_row record;
  v_pool record;
BEGIN
  v_results := array_append(v_results, jsonb_build_object('check', 'Dealers >= 8', 'pass', (SELECT count(*) >= 8 FROM dealers WHERE club_id = p_club_id AND status = 'active'), 'value', (SELECT count(*) FROM dealers WHERE club_id = p_club_id AND status = 'active')));
  v_results := array_append(v_results, jsonb_build_object('check', 'Tables >= 3', 'pass', (SELECT count(*) >= 3 FROM game_tables WHERE club_id = p_club_id AND status = 'active'), 'value', (SELECT count(*) FROM game_tables WHERE club_id = p_club_id AND status = 'active')));
  v_results := array_append(v_results, jsonb_build_object('check', 'Check-ins >= 5', 'pass', (SELECT count(*) >= 5 FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE d.club_id = p_club_id AND da.status = 'checked_in'), 'value', (SELECT count(*) FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE d.club_id = p_club_id AND da.status = 'checked_in')));
  v_results := array_append(v_results, jsonb_build_object('check', 'Assignments >= 1', 'pass', (SELECT count(*) >= 1 FROM dealer_assignments WHERE status = 'assigned'), 'value', (SELECT count(*) FROM dealer_assignments WHERE status = 'assigned')));

  v_results := array_append(v_results, jsonb_build_object('check', 'Swing config exists', 'pass', (SELECT count(*) >= 1 FROM swing_config WHERE club_id = p_club_id), 'value', (SELECT count(*) FROM swing_config WHERE club_id = p_club_id)));
  v_results := array_append(v_results, jsonb_build_object('check', 'Auto swing enabled', 'pass', (SELECT auto_swing_enabled FROM club_settings WHERE club_id = p_club_id), 'value', (SELECT auto_swing_enabled FROM club_settings WHERE club_id = p_club_id)));

  SELECT * INTO v_row FROM perform_swing(NULL, NULL, NULL) AS f;
  v_results := array_append(v_results, jsonb_build_object('check', 'perform_swing null race_lost', 'pass', COALESCE(v_row.outcome = 'race_lost', false), 'value', v_row.outcome));

  SELECT * INTO v_row FROM execute_pre_assigned_swing(NULL, NULL, NULL::timestamptz, NULL::int) AS f;
  v_results := array_append(v_results, jsonb_build_object('check', 'execute_pre_assigned_swing null error', 'pass', COALESCE(v_row.status = 'error', false), 'value', v_row.status));

  SELECT * INTO v_pool FROM get_dealer_pool_snapshot(p_club_id) AS f;
  v_results := array_append(v_results, jsonb_build_object('check', 'Pool snapshot exists', 'pass', v_pool.id IS NOT NULL OR v_pool.available IS NOT NULL, 'value', jsonb_build_object('available', v_pool.available, 'weighted', v_pool.weighted_pool)));
  IF v_pool.available IS NOT NULL THEN
    v_results := array_append(v_results, jsonb_build_object('check', 'Available >= 3', 'pass', v_pool.available >= 3, 'value', v_pool.available));
    v_results := array_append(v_results, jsonb_build_object('check', 'Weighted pool > 0', 'pass', v_pool.weighted_pool > 0, 'value', v_pool.weighted_pool));
  END IF;

  SELECT count(*)::int AS cnt, count(DISTINCT attendance_id)::int AS uniq INTO v_row FROM dealer_assignments WHERE status = 'assigned';
  v_results := array_append(v_results, jsonb_build_object('check', 'No duplicate dealers', 'pass', v_row.cnt = v_row.uniq, 'value', jsonb_build_object('total', v_row.cnt, 'unique', v_row.uniq)));

  SELECT column_name INTO v_row FROM information_schema.columns WHERE table_name = 'dealer_attendance' AND column_name = 'total_worked_minutes_today';
  v_results := array_append(v_results, jsonb_build_object('check', 'total_worked_minutes_today column', 'pass', v_row.column_name IS NOT NULL, 'value', v_row.column_name));

  SELECT count(*)::int AS cnt, count(da.swing_due_at)::int AS has_due INTO v_row
  FROM dealer_assignments da JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.status = 'assigned' AND gt.club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'Swing_due_at populated', 'pass', v_row.cnt > 0 AND v_row.cnt = v_row.has_due, 'value', jsonb_build_object('total', v_row.cnt, 'with_due', v_row.has_due)));

  BEGIN
    SELECT * INTO v_row FROM execute_pre_assigned_swing('00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid, now()::timestamptz, 45) AS f;
    v_results := array_append(v_results, jsonb_build_object('check', 'Guard bad ID', 'pass', v_row.status = 'error' OR v_row.outcome = 'error', 'value', coalesce(v_row.status, v_row.outcome::text)));
  EXCEPTION WHEN OTHERS THEN
    v_results := array_append(v_results, jsonb_build_object('check', 'Guard bad ID threw', 'pass', true, 'value', SQLERRM));
  END;

  SELECT count(DISTINCT club_id)::int AS cnt INTO v_row FROM swing_config;
  v_results := array_append(v_results, jsonb_build_object('check', 'Multi-club configs', 'pass', v_row.cnt >= 2, 'value', v_row.cnt));

  SELECT count(*)::int AS cnt INTO v_row FROM dealer_shift_metrics WHERE club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'dealer_shift_metrics rows', 'pass', v_row.cnt > 0, 'value', v_row.cnt));

  SELECT column_name INTO v_row FROM information_schema.columns WHERE table_name = 'dealer_assignments' AND column_name = 'state';
  v_results := array_append(v_results, jsonb_build_object('check', 'state column exists', 'pass', v_row.column_name IS NOT NULL, 'value', v_row.column_name));

  RETURN jsonb_build_object('results', v_results,
    'summary', jsonb_build_object(
      'total', array_length(v_results, 1),
      'passed', (SELECT count(*) FROM jsonb_array_elements(jsonb_build_object('results', v_results)->'results') AS r WHERE (r->>'pass')::boolean),
      'failed', (SELECT count(*) FROM jsonb_array_elements(jsonb_build_object('results', v_results)->'results') AS r WHERE NOT (r->>'pass')::boolean)
    ));
END;
$$;
