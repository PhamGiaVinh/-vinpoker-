-- ============================================================================
-- seed_floor_test_data(p_owner_user_id) — Floor UAT fixtures (DEV / LOCAL ONLY)
-- ============================================================================
-- SOURCE-ONLY. This migration DEFINES the function but NEVER CALLS it, so
-- applying the migration changes no data. It is meant for local/dev only:
--   - `supabase db reset` (rebuilds the local DB from migrations, no live drift)
--   - then run:  SELECT seed_floor_test_data('<your-auth-user-uuid>');
-- DO NOT call this against production. It creates a self-contained test club,
-- tournament, tables, blind structure, entries and seats so the Floor redesign
-- (table map, 3-group players, move / bust / edit-chip / receipt, blind editor)
-- can be UAT'd end-to-end against REAL RPCs.
--
-- p_owner_user_id = the real logged-in operator's auth.users id. The function
-- makes that user the test club's owner AND a club_cashier, so move / bust /
-- edit-chip authorization passes for them in the UI. Player rows use synthetic
-- UUIDs (tournament_entries.player_id / tournament_seats.player_id have no
-- auth.users FK), so no fake auth users are created.
--
-- Bust is modelled as tournament_entries.status='busted' + seat is_active=false
-- (NO tournament_eliminations / NO placeholder hand) — matches the production
-- safety rule that floor bust must not fabricate a hand.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_floor_test_data(p_owner_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id    CONSTANT UUID := 'f1000000-0000-4000-8000-000000000001';
  v_tour_id    CONSTANT UUID := 'f1000000-0000-4000-8000-000000000002';
  v_table_count CONSTANT INT := 12;   -- physical/tournament tables (map scale)
  v_seats_per   CONSTANT INT := 9;
  v_names TEXT[] := ARRAY[
    'Nguyễn Minh Anh','Trần Quốc Bảo','Lê Hoàng Duy','Phạm Tuấn Kiệt','Võ Nhật Minh',
    'Đặng Hữu Phúc','Bùi Thanh Sơn','Đỗ Gia Hân','Hồ Ngọc Lan','Phan Văn Tài',
    'Vũ Đức Trí','Dương Thị Mai','Ngô Bá Khang','Lý Hải Đăng','Trương Mỹ Linh',
    'Cao Minh Quân','Hoàng Thu Trang','Đinh Văn Lộc','Mai Anh Tuấn','Tạ Quỳnh Như',
    'Lương Bảo Long','Châu Gia Bảo','Tô Hải Yến','Kiều Anh Dũng','Phùng Thế Vinh',
    'Hà Khánh Vy','Đoàn Minh Khôi','Lâm Tuấn Phong','Vương Thảo Nhi','Nguyễn Hữu Thắng'
  ];
  v_gt_ids UUID[] := '{}'::UUID[];
  v_gid UUID;
  v_eid UUID;
  v_t INT;
  v_s INT;
  v_name_i INT := 1;
  v_player UUID;
  v_stack INT;
  v_status TEXT;
  v_active BOOLEAN;
  v_seated INT := 0;
  v_waiting INT := 0;
  v_bust INT := 0;
BEGIN
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'p_owner_user_id is required (pass your real auth.users id)';
  END IF;

  -- Clean any prior run of THIS fixture (by fixed club id) — idempotent.
  DELETE FROM public.tournament_seats   WHERE tournament_id = v_tour_id;
  DELETE FROM public.tournament_entries WHERE tournament_id = v_tour_id;
  DELETE FROM public.tournament_levels  WHERE tournament_id = v_tour_id;
  DELETE FROM public.tournament_tables  WHERE tournament_id = v_tour_id;
  DELETE FROM public.tournaments        WHERE id = v_tour_id;
  DELETE FROM public.game_tables        WHERE club_id = v_club_id;
  DELETE FROM public.club_cashiers      WHERE club_id = v_club_id;
  DELETE FROM public.clubs              WHERE id = v_club_id;

  -- Club owned by the operator (status approved so it's visible).
  INSERT INTO public.clubs (id, owner_id, name, region, status)
  VALUES (v_club_id, p_owner_user_id, 'CLB Test Floor (UAT)', 'HCM', 'approved');

  -- Operator as cashier → move/bust/edit-chip authorization passes in the UI.
  INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
  VALUES (v_club_id, p_owner_user_id, p_owner_user_id)
  ON CONFLICT (club_id, user_id) DO NOTHING;

  -- Tournament (active so the live panel lists it).
  INSERT INTO public.tournaments (id, club_id, name, start_time, buy_in, starting_stack, status)
  VALUES (v_tour_id, v_club_id, 'Floor UAT Deepstack', now(), 1000000, 50000, 'active');

  -- Blind structure (20 levels, breaks after 6/12/18), current_level = 5.
  INSERT INTO public.tournament_levels (tournament_id, level_number, small_blind, big_blind, ante, duration_minutes, is_break)
  SELECT v_tour_id, n,
         CASE WHEN n IN (7,13,19) THEN 0 ELSE 100 * n END,
         CASE WHEN n IN (7,13,19) THEN 0 ELSE 200 * n END,
         CASE WHEN n IN (7,13,19) THEN 0 ELSE 200 * n END,
         CASE WHEN n IN (7,13,19) THEN 15 ELSE 20 END,
         (n IN (7,13,19))
  FROM generate_series(1, 20) AS n;

  UPDATE public.tournaments SET current_level = 5 WHERE id = v_tour_id;

  -- Physical game tables + matching tournament_tables (the map grid).
  FOR v_t IN 1..v_table_count LOOP
    INSERT INTO public.game_tables (club_id, table_name, table_type, status, current_blind_level)
    VALUES (v_club_id, 'Bàn ' || v_t, 'tournament', 'active', 5)
    RETURNING id INTO v_gid;
    v_gt_ids := array_append(v_gt_ids, v_gid);

    INSERT INTO public.tournament_tables (tournament_id, table_id, table_number, max_seats, status)
    VALUES (v_tour_id, v_gid, v_t, v_seats_per, 'active');
  END LOOP;

  -- Seat players. Tables 1..9 = occupied (varying fill incl. one full),
  -- tables 10..12 = left empty so the map shows "Trống".
  FOR v_t IN 1..9 LOOP
    v_gid := v_gt_ids[v_t];
    -- table 1 is full (9), others 4..7 players
    FOR v_s IN 1..(CASE WHEN v_t = 1 THEN v_seats_per ELSE 4 + (v_t % 4) END) LOOP
      EXIT WHEN v_name_i > array_length(v_names, 1);
      v_player := gen_random_uuid();
      v_stack := 40000 + ((v_name_i * 7919) % 160000);  -- spread of stacks

      INSERT INTO public.tournament_entries
        (id, tournament_id, registration_id, player_id, entry_no, source, status, current_stack, table_id, seat_number, seated_at)
      VALUES
        (gen_random_uuid(), v_tour_id, NULL, v_player, 1, 'manual', 'seated', v_stack, v_gid, v_s, now())
      RETURNING id INTO v_eid;

      INSERT INTO public.tournament_seats
        (tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, entry_id)
      VALUES
        (v_tour_id, v_player, 1, v_gid, v_s, v_stack, TRUE, v_eid);

      v_seated := v_seated + 1;
      v_name_i := v_name_i + 1;
    END LOOP;
  END LOOP;

  -- Waiting list (confirmed but unseated entries) — 4 players.
  FOR v_s IN 1..4 LOOP
    EXIT WHEN v_name_i > array_length(v_names, 1);
    INSERT INTO public.tournament_entries
      (tournament_id, registration_id, player_id, entry_no, source, status, current_stack)
    VALUES
      (v_tour_id, NULL, gen_random_uuid(), 1, 'manual', 'registered', 50000);
    v_waiting := v_waiting + 1;
    v_name_i := v_name_i + 1;
  END LOOP;

  -- Bust (entry busted + seat inactive; NO eliminations, NO placeholder hand) — 3 players.
  FOR v_s IN 1..3 LOOP
    EXIT WHEN v_name_i > array_length(v_names, 1);
    v_player := gen_random_uuid();
    INSERT INTO public.tournament_entries
      (id, tournament_id, registration_id, player_id, entry_no, source, status, current_stack, finished_place, busted_at)
    VALUES
      (gen_random_uuid(), v_tour_id, NULL, v_player, 1, 'manual', 'busted', 0, 30 - v_s, now())
    RETURNING id INTO v_eid;

    INSERT INTO public.tournament_seats
      (tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, entry_id)
    VALUES
      (v_tour_id, v_player, 1, v_gt_ids[1], 9 + v_s, 0, FALSE, v_eid);

    v_bust := v_bust + 1;
    v_name_i := v_name_i + 1;
  END LOOP;

  -- Assign readable display names to the synthetic players (best-effort: only if
  -- a profiles table with (id, display_name) exists; ignored otherwise).
  BEGIN
    INSERT INTO public.profiles (id, display_name)
    SELECT te.player_id, v_names[((row_number() OVER (ORDER BY te.created_at))::INT - 1) % array_length(v_names,1) + 1]
    FROM public.tournament_entries te
    WHERE te.tournament_id = v_tour_id
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- profiles shape differs / table absent → skip naming, UI shows id prefix
  END;

  RETURN jsonb_build_object(
    'status', 'success',
    'club_id', v_club_id,
    'tournament_id', v_tour_id,
    'tables', v_table_count,
    'seated', v_seated,
    'waiting', v_waiting,
    'bust', v_bust,
    'move_eligible', v_seated  -- every seated player has entry_id → move-eligible
  );
END;
$$;
