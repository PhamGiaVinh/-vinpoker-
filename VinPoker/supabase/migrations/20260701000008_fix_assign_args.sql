-- Fix assign_dealer_to_table argument order in seed_swing_test_data()
-- Correct signature: (p_attendance_id, p_table_id, p_assigned_at DEFAULT now(), p_swing_due_at DEFAULT NULL)

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
  v_dealer_ids uuid[] := '{}'::uuid[];
  v_table_ids uuid[] := '{}'::uuid[];
  v_attendance_ids uuid[] := '{}'::uuid[];
  v_did uuid;
  v_i int;
  v_result jsonb;
BEGIN
  DELETE FROM dealer_assignments;
  DELETE FROM dealer_attendance
    USING dealers WHERE dealers.id = dealer_attendance.dealer_id AND dealers.club_id = ANY(v_club_ids);
  DELETE FROM game_tables WHERE club_id = ANY(v_club_ids);
  DELETE FROM dealers WHERE club_id = ANY(v_club_ids);
  DELETE FROM swing_audit_logs;

  FOREACH v_did IN ARRAY v_club_ids LOOP
    INSERT INTO club_settings (club_id, auto_swing_enabled)
    VALUES (v_did, true)
    ON CONFLICT (club_id) DO UPDATE SET auto_swing_enabled = true;
  END LOOP;

  FOREACH v_did IN ARRAY v_club_ids LOOP
    INSERT INTO swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes,
      pre_notify_minutes, auto_adjust_duration, base_duration_minutes,
      target_ratio, min_duration_minutes, max_duration_minutes)
    VALUES (v_did, 'tournament', 45, 15, 6, false, 40, 1.43, 30, 60)
    ON CONFLICT (club_id, table_type) DO NOTHING;
  END LOOP;

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

  WITH inserted AS (
    INSERT INTO dealer_attendance (dealer_id, status, current_state, check_in_time, shift_date)
    SELECT unnest(v_dealer_ids), 'checked_in', 'available',
           now() - (random() * interval '4 hours'),
           CURRENT_DATE
    RETURNING id
  )
  SELECT array_agg(id) INTO v_attendance_ids FROM inserted;

  -- assign_dealer_to_table(p_attendance_id, p_table_id, p_assigned_at, p_swing_due_at)
  FOR v_i IN 0..least(2, array_length(v_table_ids,1)-1, array_length(v_attendance_ids,1)-1) LOOP
    PERFORM assign_dealer_to_table(
      v_attendance_ids[v_i + 1],  -- p_attendance_id (1st)
      v_table_ids[v_i + 1],       -- p_table_id (2nd)
      now(),                       -- p_assigned_at (3rd)
      now() + interval '2 minutes' -- p_swing_due_at (4th)
    );
  END LOOP;

  v_result := jsonb_build_object(
    'dealers', (SELECT count(*) FROM dealers WHERE club_id = v_club_id AND status = 'active'),
    'tables', (SELECT count(*) FROM game_tables WHERE club_id = v_club_id AND status = 'active'),
    'checkins', (SELECT count(*) FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id WHERE d.club_id = v_club_id AND da.status = 'checked_in'),
    'assignments', (SELECT count(*) FROM dealer_assignments WHERE status = 'assigned'),
    'club_settings', (SELECT count(*) FROM club_settings WHERE club_id = ANY(v_club_ids) AND auto_swing_enabled = true),
    'swing_configs', (SELECT count(*) FROM swing_config WHERE club_id = ANY(v_club_ids))
  );
  RETURN v_result;
END;
$$;
