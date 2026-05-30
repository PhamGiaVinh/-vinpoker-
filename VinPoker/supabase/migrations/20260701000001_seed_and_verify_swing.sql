-- Seed + Verify helper functions for swing integration tests
-- SECURITY DEFINER so they bypass RLS when called via pg

-- ─────────────────────────────────────────────
-- Function: seed_swing_test_data()
-- Inserts test dealers, tables, configs, check-ins, assignments
-- Returns JSON with created IDs
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_swing_test_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id CONSTANT uuid := '11111111-1111-1111-1111-111111111111';
  v_club_ids uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'
  ];
  v_today text := to_char(now(), 'YYYY-MM-DD');
  v_dealer_ids uuid[] := '{}'::uuid[];
  v_table_ids uuid[] := '{}'::uuid[];
  v_attendance_ids uuid[] := '{}'::uuid[];
  v_did uuid;
  v_tid uuid;
  v_aid uuid;
  v_i int;
  v_result jsonb;
BEGIN
  -- Clean existing data
  -- dealer_assignments has no club_id; delete all then re-clean via JOIN below
  DELETE FROM dealer_assignments;
  DELETE FROM dealer_attendance
    USING dealers WHERE dealers.id = dealer_attendance.dealer_id AND dealers.club_id = ANY(v_club_ids);
  DELETE FROM game_tables WHERE club_id = ANY(v_club_ids);
  DELETE FROM dealers WHERE club_id = ANY(v_club_ids);
  DELETE FROM swing_audit_logs;

  -- A1. Club settings
  FOREACH v_did IN ARRAY v_club_ids LOOP
    INSERT INTO club_settings (club_id, auto_swing_enabled)
    VALUES (v_did, true)
    ON CONFLICT (club_id) DO UPDATE SET auto_swing_enabled = true;
  END LOOP;

  -- A2. Swing configs
  FOREACH v_did IN ARRAY v_club_ids LOOP
    INSERT INTO swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes,
      pre_announce_minutes, auto_adjust_duration, min_duration, base_duration_minutes,
      target_ratio, max_duration_minutes)
    VALUES (v_did, 'tournament', 45, 15, 6, false, 30, 40, 1.43, 60)
    ON CONFLICT (club_id, table_type) DO NOTHING;
  END LOOP;

  -- A3. Dealers (10 dealers)
  WITH inserted AS (
    INSERT INTO dealers (club_id, full_name, tier, skills, employment_type, hourly_rate_vnd, base_rate_vnd, status) VALUES
      (v_club_id, 'Nguyen Van A', 'A', ARRAY['Texas Holdem','Omaha'], 'full_time', 50000, 400000, 'active'),
      (v_club_id, 'Tran Thi B', 'B', ARRAY['Texas Holdem'], 'full_time', 40000, 320000, 'active'),
      (v_club_id, 'Le Van C', 'C', ARRAY['Texas Holdem'], 'part_time', 35000, 0, 'active'),
      (v_club_id, 'Pham Thi D', 'A', ARRAY['Texas Holdem','Omaha','Mixed'], 'full_time', 55000, 440000, 'active'),
      (v_club_id, 'Hoang Van E', 'B', ARRAY['Texas Holdem','Omaha'], 'part_time', 40000, 0, 'active'),
      (v_club_id, 'Ngo Thi F', 'C', ARRAY['Texas Holdem'], 'part_time', 30000, 0, 'active'),
      (v_club_id, 'Bui Van G', 'A', ARRAY['Texas Holdem','Omaha','Mixed'], 'full_time', 55000, 440000, 'active'),
      (v_club_id, 'Dang Thi H', 'B', ARRAY['Texas Holdem'], 'full_time', 42000, 336000, 'active'),
      (v_club_id, 'Vu Van I', 'C', ARRAY['Texas Holdem','Omaha'], 'part_time', 35000, 0, 'active'),
      (v_club_id, 'Ly Thi K', 'A', ARRAY['Texas Holdem'], 'full_time', 50000, 400000, 'active')
    RETURNING id
  )
  SELECT array_agg(id) INTO v_dealer_ids FROM inserted;

  -- A4. Game tables (5 tables)
  WITH inserted AS (
    INSERT INTO game_tables (club_id, table_name, table_type, status, current_blind_level) VALUES
      (v_club_id, 'Bàn 1', 'tournament', 'active', 1),
      (v_club_id, 'Bàn 2', 'tournament', 'active', 1),
      (v_club_id, 'Bàn 3', 'tournament', 'active', 1),
      (v_club_id, 'Bàn 4', 'tournament', 'active', 1),
      (v_club_id, 'Bàn 5', 'tournament', 'active', 1)
    RETURNING id
  )
  SELECT array_agg(id) INTO v_table_ids FROM inserted;

  -- A5. Check-in dealers (dealer_attendance has no club_id column — resolved via dealers table)
  WITH inserted AS (
    INSERT INTO dealer_attendance (dealer_id, status, current_state, check_in_time, shift_date)
    SELECT unnest(v_dealer_ids), 'checked_in', 'available',
           now() - (random() * interval '4 hours'),
           v_today
    RETURNING id
  )
  SELECT array_agg(id) INTO v_attendance_ids FROM inserted;

  -- A6. Assign first 3 dealers to first 3 tables
  FOR v_i IN 0..least(2, array_length(v_table_ids,1)-1, array_length(v_attendance_ids,1)-1) LOOP
    PERFORM assign_dealer_to_table(
      v_table_ids[v_i + 1],
      v_attendance_ids[v_i + 1],
      now() + interval '2 minutes'
    );
  END LOOP;

  -- Return summary
  v_result := jsonb_build_object(
    'dealers', (SELECT count(*) FROM dealers WHERE club_id = v_club_id AND status = 'active'),
    'tables', (SELECT count(*) FROM game_tables WHERE club_id = v_club_id AND status = 'active'),
    'checkins', (SELECT count(*) FROM dealer_attendance WHERE club_id = v_club_id AND status = 'checked_in'),
    'assignments', (SELECT count(*) FROM dealer_assignments WHERE status = 'assigned'),
    'club_settings', (SELECT count(*) FROM club_settings WHERE club_id = ANY(v_club_ids) AND auto_swing_enabled = true),
    'swing_configs', (SELECT count(*) FROM swing_config WHERE club_id = ANY(v_club_ids))
  );

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────
-- Function: verify_swing_queries()
-- Runs all verification queries bypassing RLS
-- Returns JSON array of check results
-- ─────────────────────────────────────────────
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
  v_metrics record;
  v_check jsonb;
BEGIN
  -- B1. Seed counts
  v_results := array_append(v_results, jsonb_build_object('check', 'Dealers >= 8', 'pass', (SELECT count(*) >= 8 FROM dealers WHERE club_id = p_club_id AND status = 'active'), 'value', (SELECT count(*) FROM dealers WHERE club_id = p_club_id AND status = 'active')));
  v_results := array_append(v_results, jsonb_build_object('check', 'Tables >= 3', 'pass', (SELECT count(*) >= 3 FROM game_tables WHERE club_id = p_club_id AND status = 'active'), 'value', (SELECT count(*) FROM game_tables WHERE club_id = p_club_id AND status = 'active')));
  v_results := array_append(v_results, jsonb_build_object('check', 'Check-ins >= 5', 'pass', (SELECT count(*) >= 5 FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE d.club_id = p_club_id AND da.status = 'checked_in'), 'value', (SELECT count(*) FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE d.club_id = p_club_id AND da.status = 'checked_in')));
  v_results := array_append(v_results, jsonb_build_object('check', 'Assignments >= 1', 'pass', (SELECT count(*) >= 1 FROM dealer_assignments WHERE status = 'assigned'), 'value', (SELECT count(*) FROM dealer_assignments WHERE status = 'assigned')));

  -- B2. Configs
  v_results := array_append(v_results, jsonb_build_object('check', 'Swing config exists', 'pass', (SELECT count(*) >= 1 FROM swing_config WHERE club_id = p_club_id), 'value', (SELECT count(*) FROM swing_config WHERE club_id = p_club_id)));
  v_results := array_append(v_results, jsonb_build_object('check', 'Auto swing enabled', 'pass', (SELECT auto_swing_enabled FROM club_settings WHERE club_id = p_club_id), 'value', (SELECT auto_swing_enabled FROM club_settings WHERE club_id = p_club_id)));

  -- B4. RPC validation
  SELECT outcome INTO v_row FROM perform_swing(NULL, NULL, NULL);
  v_results := array_append(v_results, jsonb_build_object('check', 'perform_swing null → race_lost', 'pass', v_row.outcome = 'race_lost', 'value', v_row.outcome));

  SELECT * INTO v_row FROM execute_pre_assigned_swing(NULL, NULL, NULL::timestamptz, NULL::int);
  v_results := array_append(v_results, jsonb_build_object('check', 'execute_pre_assigned_swing null → error', 'pass', v_row.status = 'error', 'value', v_row.status));

  -- B5. Pool snapshot
  SELECT * INTO v_pool FROM get_dealer_pool_snapshot(p_club_id);
  v_results := array_append(v_results, jsonb_build_object('check', 'Pool snapshot returns data', 'pass', v_pool IS NOT NULL, 'value', jsonb_build_object('available', v_pool.available, 'weighted', v_pool.weighted_pool)));
  v_results := array_append(v_results, jsonb_build_object('check', 'Available >= 3', 'pass', v_pool.available >= 3, 'value', v_pool.available));
  v_results := array_append(v_results, jsonb_build_object('check', 'Weighted pool > 0', 'pass', v_pool.weighted_pool > 0, 'value', v_pool.weighted_pool));

  -- B7. No duplicate dealers
  SELECT count(*)::int AS cnt, count(DISTINCT attendance_id)::int AS uniq
  INTO v_row
  FROM dealer_assignments WHERE status = 'assigned';
  v_results := array_append(v_results, jsonb_build_object('check', 'No duplicate dealers', 'pass', v_row.cnt = v_row.uniq, 'value', jsonb_build_object('total', v_row.cnt, 'unique', v_row.uniq)));

  -- B8. total_worked_minutes_today column
  SELECT column_name INTO v_row
  FROM information_schema.columns
  WHERE table_name = 'dealer_attendance' AND column_name = 'total_worked_minutes_today';
  v_results := array_append(v_results, jsonb_build_object('check', 'total_worked_minutes_today column exists', 'pass', v_row.column_name IS NOT NULL, 'value', v_row.column_name));

  -- B10. Swing due state (dealer_assignments has no club_id — JOIN via game_tables)
  SELECT count(*)::int AS cnt, count(da.swing_due_at)::int AS has_due
  INTO v_row
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.status = 'assigned' AND gt.club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'Swing_due_at populated', 'pass', v_row.cnt > 0 AND v_row.cnt = v_row.has_due, 'value', jsonb_build_object('total', v_row.cnt, 'with_due', v_row.has_due)));

  -- B11. Pre-assigned swing guard
  BEGIN
    SELECT * INTO v_row FROM execute_pre_assigned_swing('00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid, now()::timestamptz, 45);
    v_results := array_append(v_results, jsonb_build_object('check', 'Guard rejects bad ID', 'pass', v_row.status = 'error' OR v_row.outcome = 'error', 'value', coalesce(v_row.status, v_row.outcome::text)));
  EXCEPTION WHEN OTHERS THEN
    v_results := array_append(v_results, jsonb_build_object('check', 'Guard rejects bad ID (threw)', 'pass', true, 'value', SQLERRM));
  END;

  -- B12. Multi-club configs
  SELECT count(DISTINCT club_id)::int AS cnt INTO v_row FROM swing_config;
  v_results := array_append(v_results, jsonb_build_object('check', 'All clubs have configs', 'pass', v_row.cnt >= 2, 'value', v_row.cnt));

  -- B13. dealer_shift_metrics view
  SELECT count(*)::int AS cnt INTO v_row FROM dealer_shift_metrics WHERE club_id = p_club_id;
  v_results := array_append(v_results, jsonb_build_object('check', 'dealer_shift_metrics view returns rows', 'pass', v_row.cnt > 0, 'value', v_row.cnt));

  -- B15. Assignment state column
  SELECT column_name INTO v_row
  FROM information_schema.columns
  WHERE table_name = 'dealer_assignments' AND column_name = 'state';
  v_results := array_append(v_results, jsonb_build_object('check', 'Assignment state column exists', 'pass', v_row.column_name IS NOT NULL, 'value', v_row.column_name));

  RETURN jsonb_build_object('results', v_results,
    'summary', jsonb_build_object(
      'total', array_length(v_results, 1),
      'passed', (SELECT count(*) FROM jsonb_array_elements(jsonb_build_object('results', v_results)->'results') AS r WHERE (r->>'pass')::boolean),
      'failed', (SELECT count(*) FROM jsonb_array_elements(jsonb_build_object('results', v_results)->'results') AS r WHERE NOT (r->>'pass')::boolean)
    ));
END;
$$;
