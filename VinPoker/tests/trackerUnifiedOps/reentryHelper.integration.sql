\set ON_ERROR_STOP on

-- Local/disposable PostgreSQL integration test for the re-entry lineage follow-up.
-- Run only after disposableDb.baseline.sql, reentryHelper.dependencies.sql,
-- 20261122000000, 20261208000000, 20261209000000, 20270108000003,
-- 20270108000004, and the new canonicalization migration.

CREATE OR REPLACE FUNCTION pg_temp.seed_busted_entry(
  p_tournament_id UUID,
  p_table_id UUID,
  p_game_table_id UUID,
  p_player_id UUID,
  p_entry_id UUID,
  p_registration_id UUID,
  p_seat_id UUID,
  p_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.tournament_registrations (
    id, tournament_id, player_id, club_id, buy_in, platform_fixed_fee,
    total_pay, reference_code, status, confirmed_at, confirmed_by
  ) VALUES (
    p_registration_id, p_tournament_id, p_player_id,
    '10000000-0000-0000-0000-000000000001', 100, 10, 110,
    'SRC-' || replace(p_entry_id::text, '-', ''), 'confirmed', now(),
    '10000000-0000-0000-0000-000000000001'
  );

  INSERT INTO public.tournament_entries (
    id, tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, busted_at
  ) VALUES (
    p_entry_id, p_tournament_id, p_registration_id, p_player_id, 1,
    'offline', 'busted', 0, p_game_table_id, p_seat_id, 1, now()
  );

  INSERT INTO public.tournament_seats (
    id, tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, is_active, entry_id, status, player_name, assigned_at
  ) VALUES (
    p_seat_id, p_tournament_id, p_player_id, 1, p_table_id, 1,
    0, false, p_entry_id, 'busted', p_name, now()
  );

  RETURN p_entry_id;
END;
$$;

INSERT INTO auth.users (id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000011'),
  ('10000000-0000-0000-0000-000000000012'),
  ('10000000-0000-0000-0000-000000000013'),
  ('10000000-0000-0000-0000-000000000014'),
  ('10000000-0000-0000-0000-000000000015'),
  ('10000000-0000-0000-0000-000000000016')
ON CONFLICT DO NOTHING;

INSERT INTO public.clubs (id, owner_id)
VALUES ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

INSERT INTO public.profiles (id, user_id, display_name, phone)
VALUES
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'Reentry One', '0912345678'),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000012', 'Reentry Two', '0912345679'),
  ('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000013', 'Reentry Three', '0912345680'),
  ('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000014', 'Restore One', '0912345681'),
  ('20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000015', 'Race One', '0912345682'),
  ('20000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000016', 'Race Two', '0912345683');

INSERT INTO public.club_settings (club_id, player_history_enabled)
VALUES ('10000000-0000-0000-0000-000000000001', false)
ON CONFLICT (club_id) DO NOTHING;

INSERT INTO public.tournaments (id, club_id, name, status, current_level, starting_stack)
VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Reentry functional', 'live', 1, 1000),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Canonical active hand', 'live', 1, 1000),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Physical active hand', 'live', 1, 1000),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Restore guards', 'live', 1, 1000),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Reentry race', 'live', 1, 1000);

INSERT INTO public.game_tables (id, club_id, table_name, status)
VALUES
  ('31000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'R1-A', 'active'),
  ('31000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'R1-B', 'active'),
  ('31000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'R2-A', 'active'),
  ('31000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 'R2-B', 'active'),
  ('31000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001', 'R3-A', 'active'),
  ('31000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001', 'R4-A', 'active'),
  ('31000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000001', 'R4-B', 'active'),
  ('31000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000001', 'R5-A', 'active');

INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status, floor_control_mode)
VALUES
  ('32000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000011', 1, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000012', 2, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000021', 1, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000022', 2, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000031', 1, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000041', '30000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000041', 1, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000042', '30000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000042', 2, 2, 'active', 'tracker'),
  ('32000000-0000-0000-0000-000000000051', '30000000-0000-0000-0000-000000000005', '31000000-0000-0000-0000-000000000051', 1, 2, 'active', 'tracker');

INSERT INTO public.tournament_levels (id, tournament_id, level_number, small_blind, big_blind, ante, is_break)
SELECT ('33000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       1, 10, 20, 20, false
FROM generate_series(1, 5) AS n;

UPDATE public.tournaments t
SET current_level_id = l.id
FROM public.tournament_levels l
WHERE l.tournament_id = t.id;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);

SELECT pg_temp.seed_busted_entry(
  '30000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000011',
  '31000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000011',
  '34000000-0000-0000-0000-000000000011',
  '35000000-0000-0000-0000-000000000011',
  '36000000-0000-0000-0000-000000000011',
  'Reentry One'
);

DO $$
DECLARE
  v_res JSONB;
  v_entry UUID;
  v_registration_count INTEGER;
  v_entry_count INTEGER;
  v_seat_count INTEGER;
  v_source_registration UUID := '35000000-0000-0000-0000-000000000011';
BEGIN
  v_res := public.reenter_tournament_player(
    '34000000-0000-0000-0000-000000000011', 100, 10, 'fill_lowest_table'
  );
  IF COALESCE((v_res->>'ok')::BOOLEAN, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'reentry functional failed: %', v_res;
  END IF;
  v_entry := (v_res->>'entry_id')::UUID;

  SELECT count(*) INTO v_registration_count
  FROM public.tournament_registrations
  WHERE source_entry_id = '34000000-0000-0000-0000-000000000011';
  SELECT count(*) INTO v_entry_count
  FROM public.tournament_entries
  WHERE id = v_entry AND status = 'seated' AND entry_no = 2;
  SELECT count(*) INTO v_seat_count
  FROM public.tournament_seats
  WHERE id = (v_res->>'seat_id')::UUID
    AND is_active AND status = 'active' AND entry_id = v_entry;

  IF v_registration_count <> 1 OR v_entry_count <> 1 OR v_seat_count <> 1 THEN
    RAISE EXCEPTION 'reentry writes do not form one seated bullet: %, %, %',
      v_registration_count, v_entry_count, v_seat_count;
  END IF;

  IF (SELECT count(*) FROM public.tournament_registrations WHERE id = v_source_registration) <> 1
     OR (SELECT status FROM public.tournament_entries WHERE id = '34000000-0000-0000-0000-000000000011') <> 'busted' THEN
    RAISE EXCEPTION 'source entry changed during reentry';
  END IF;

  IF (SELECT member_id FROM public.tournament_entries WHERE id = v_entry) IS NOT NULL THEN
    RAISE EXCEPTION 'member identity unexpectedly changed for unlinked source';
  END IF;

  RAISE NOTICE 'REENTRY_FUNCTIONAL_PASS result=%', v_res;
END;
$$;

SELECT pg_temp.seed_busted_entry(
  '30000000-0000-0000-0000-000000000005',
  '32000000-0000-0000-0000-000000000051',
  '31000000-0000-0000-0000-000000000051',
  '10000000-0000-0000-0000-000000000016',
  '34000000-0000-0000-0000-000000000052',
  '35000000-0000-0000-0000-000000000052',
  '36000000-0000-0000-0000-000000000052',
  'Race Two'
);

SELECT dblink_connect('reentry_race_1', format('dbname=%s', current_database()));
SELECT dblink_connect('reentry_race_2', format('dbname=%s', current_database()));
SELECT pg_advisory_lock(hashtextextended('tracker-unified-ops:' || '30000000-0000-0000-0000-000000000005', 0));
SELECT dblink_send_query(
  'reentry_race_1',
  format($query$
    WITH auth AS MATERIALIZED (
      SELECT set_config('request.jwt.claim.sub', %L, false)
    )
    SELECT public.reenter_tournament_player(%L::uuid, 100, 10, 'random_balanced')
    FROM auth
  $query$, '10000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000052')
);
SELECT dblink_send_query(
  'reentry_race_2',
  format($query$
    WITH auth AS MATERIALIZED (
      SELECT set_config('request.jwt.claim.sub', %L, false)
    )
    SELECT public.reenter_tournament_player(%L::uuid, 100, 10, 'random_balanced')
    FROM auth
  $query$, '10000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000052')
);
SELECT pg_advisory_unlock(hashtextextended('tracker-unified-ops:' || '30000000-0000-0000-0000-000000000005', 0));
SELECT * FROM dblink_get_result('reentry_race_1') AS result(value JSONB);
SELECT * FROM dblink_get_result('reentry_race_2') AS result(value JSONB);
SELECT dblink_disconnect('reentry_race_1');
SELECT dblink_disconnect('reentry_race_2');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.tournament_registrations
      WHERE source_entry_id = '34000000-0000-0000-0000-000000000052'
        AND status IN ('pending', 'confirmed')) <> 1
     OR (SELECT count(*) FROM public.tournament_seats
         WHERE tournament_id = '30000000-0000-0000-0000-000000000005'
           AND player_id = '10000000-0000-0000-0000-000000000016'
           AND is_active) <> 1 THEN
    RAISE EXCEPTION 'concurrent reentry did not converge to one active result';
  END IF;
  RAISE NOTICE 'REENTRY_CONCURRENT_DOUBLE_COMMIT_PASS';
END;
$$;

SELECT pg_temp.seed_busted_entry(
  '30000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000011',
  '31000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000016',
  '34000000-0000-0000-0000-000000000061',
  '35000000-0000-0000-0000-000000000061',
  '36000000-0000-0000-0000-000000000061',
  'Race Two'
);

SELECT dblink_connect('reentry_independence', format('dbname=%s', current_database()));
SELECT pg_advisory_lock(hashtextextended('tracker-unified-ops:' || '30000000-0000-0000-0000-000000000005', 0));
SELECT dblink_send_query(
  'reentry_independence',
  format($query$
    WITH auth AS MATERIALIZED (
      SELECT set_config('request.jwt.claim.sub', %L, false)
    )
    SELECT public.reenter_tournament_player(%L::uuid, 100, 10, 'random_balanced')
    FROM auth
  $query$, '10000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000061')
);
DO $$
DECLARE
  v_busy INTEGER := 1;
  v_attempt INTEGER := 0;
BEGIN
  WHILE v_busy <> 0 AND v_attempt < 50 LOOP
    v_busy := dblink_is_busy('reentry_independence');
    v_attempt := v_attempt + 1;
    IF v_busy <> 0 THEN PERFORM pg_sleep(0.02); END IF;
  END LOOP;
  IF v_busy <> 0 THEN RAISE EXCEPTION 'different-tournament request remained blocked'; END IF;
END;
$$;
SELECT * FROM dblink_get_result('reentry_independence') AS result(value JSONB);
SELECT pg_advisory_unlock(hashtextextended('tracker-unified-ops:' || '30000000-0000-0000-0000-000000000005', 0));
SELECT dblink_disconnect('reentry_independence');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.tournament_registrations
      WHERE source_entry_id = '34000000-0000-0000-0000-000000000061'
        AND status IN ('pending', 'confirmed')) <> 1
     OR (SELECT count(*) FROM public.tournament_seats
         WHERE tournament_id = '30000000-0000-0000-0000-000000000001'
           AND player_id = '10000000-0000-0000-0000-000000000016'
           AND is_active) <> 1 THEN
    RAISE EXCEPTION 'different-tournament reentry did not complete independently';
  END IF;
  RAISE NOTICE 'REENTRY_DIFFERENT_TOURNAMENT_INDEPENDENCE_PASS';
END;
$$;

DO $$
DECLARE
  v_res JSONB;
  v_before_regs INTEGER;
  v_before_entries INTEGER;
  v_before_seats INTEGER;
BEGIN
  PERFORM pg_temp.seed_busted_entry(
    '30000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000021',
    '31000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000012',
    '34000000-0000-0000-0000-000000000021',
    '35000000-0000-0000-0000-000000000021',
    '36000000-0000-0000-0000-000000000021',
    'Reentry Two'
  );
  INSERT INTO public.tournament_hands (id, tournament_id, table_id, hand_number, status)
  VALUES ('37000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000021', 1, 'in_progress');

  v_res := public.reenter_tournament_player('34000000-0000-0000-0000-000000000021', 100, 10, 'fill_lowest_table');
  IF COALESCE((v_res->>'ok')::BOOLEAN, false) IS DISTINCT FROM true
     OR v_res->>'table_id' <> '31000000-0000-0000-0000-000000000022' THEN
    RAISE EXCEPTION 'safe alternative table selection returned %', v_res;
  END IF;

  PERFORM pg_temp.seed_busted_entry(
    '30000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000021',
    '31000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000013',
    '34000000-0000-0000-0000-000000000022',
    '35000000-0000-0000-0000-000000000022',
    '36000000-0000-0000-0000-000000000022',
    'Reentry Three'
  );
  INSERT INTO public.tournament_hands (id, tournament_id, table_id, hand_number, status)
  VALUES ('37000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000022', 1, 'in_progress');

  SELECT count(*) INTO v_before_regs FROM public.tournament_registrations WHERE tournament_id = '30000000-0000-0000-0000-000000000002';
  SELECT count(*) INTO v_before_entries FROM public.tournament_entries WHERE tournament_id = '30000000-0000-0000-0000-000000000002';
  SELECT count(*) INTO v_before_seats FROM public.tournament_seats WHERE tournament_id = '30000000-0000-0000-0000-000000000002';
  v_res := public.reenter_tournament_player('34000000-0000-0000-0000-000000000022', 100, 10, 'fill_lowest_table');
  IF v_res->>'error' <> 'no_table_available' THEN RAISE EXCEPTION 'canonical active-hand guard returned %', v_res; END IF;
  IF (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id = '30000000-0000-0000-0000-000000000002') <> v_before_regs
     OR (SELECT count(*) FROM public.tournament_entries WHERE tournament_id = '30000000-0000-0000-0000-000000000002') <> v_before_entries
     OR (SELECT count(*) FROM public.tournament_seats WHERE tournament_id = '30000000-0000-0000-0000-000000000002') <> v_before_seats THEN
    RAISE EXCEPTION 'canonical active-hand guard wrote rows';
  END IF;
  RAISE NOTICE 'REENTRY_CANONICAL_ACTIVE_HAND_ZERO_WRITE_PASS';
END;
$$;

DO $$
DECLARE
  v_res JSONB;
BEGIN
  PERFORM pg_temp.seed_busted_entry(
    '30000000-0000-0000-0000-000000000003',
    '32000000-0000-0000-0000-000000000031',
    '31000000-0000-0000-0000-000000000031',
    '10000000-0000-0000-0000-000000000013',
    '34000000-0000-0000-0000-000000000031',
    '35000000-0000-0000-0000-000000000031',
    '36000000-0000-0000-0000-000000000031',
    'Reentry Three'
  );
  INSERT INTO public.tournament_hands (id, tournament_id, table_id, hand_number, status)
  VALUES ('37000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000031', 1, 'in_progress');
  v_res := public.reenter_tournament_player('34000000-0000-0000-0000-000000000031', 100, 10, 'random_balanced');
  IF v_res->>'error' <> 'no_table_available' THEN RAISE EXCEPTION 'physical active-hand guard returned %', v_res; END IF;
  RAISE NOTICE 'REENTRY_PHYSICAL_ACTIVE_HAND_ZERO_WRITE_PASS';
END;
$$;

SELECT pg_temp.seed_busted_entry(
  '30000000-0000-0000-0000-000000000004',
  '32000000-0000-0000-0000-000000000041',
  '31000000-0000-0000-0000-000000000041',
  '10000000-0000-0000-0000-000000000014',
  '34000000-0000-0000-0000-000000000041',
  '35000000-0000-0000-0000-000000000041',
  '36000000-0000-0000-0000-000000000041',
  'Restore One'
);

DO $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.restore_busted_player_to_seat(
    '34000000-0000-0000-0000-000000000041',
    '32000000-0000-0000-0000-000000000042', 1,
    '10000000-0000-0000-0000-000000000001', 'floor_restore'
  );
  IF COALESCE((v_res->>'ok')::BOOLEAN, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'restore functional failed: %', v_res;
  END IF;
  IF (SELECT status FROM public.tournament_entries WHERE id = '34000000-0000-0000-0000-000000000041') <> 'seated'
     OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id = '34000000-0000-0000-0000-000000000041' AND is_active) <> 1
     OR (SELECT count(*) FROM public.seat_assignment_history WHERE entry_id = '34000000-0000-0000-0000-000000000041') <> 1 THEN
    RAISE EXCEPTION 'restore did not produce a complete seat transition';
  END IF;
  RAISE NOTICE 'RESTORE_FUNCTIONAL_BASELINE_PASS result=%', v_res;
END;
$$;

SELECT pg_temp.seed_busted_entry(
  '30000000-0000-0000-0000-000000000004',
  '32000000-0000-0000-0000-000000000041',
  '31000000-0000-0000-0000-000000000041',
  '10000000-0000-0000-0000-000000000015',
  '34000000-0000-0000-0000-000000000042',
  '35000000-0000-0000-0000-000000000042',
  '36000000-0000-0000-0000-000000000042',
  'Race One'
);

DO $$
DECLARE
  v_res JSONB;
  v_before_seats INTEGER;
  v_before_entries INTEGER;
  v_before_receipts INTEGER;
  v_before_history INTEGER;
BEGIN
  INSERT INTO public.tournament_hands (id, tournament_id, table_id, hand_number, status)
  VALUES ('37000000-0000-0000-0000-000000000042', '30000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000042', 9, 'in_progress');
  SELECT count(*) INTO v_before_seats FROM public.tournament_seats WHERE entry_id = '34000000-0000-0000-0000-000000000042';
  SELECT count(*) INTO v_before_entries FROM public.tournament_entries WHERE id = '34000000-0000-0000-0000-000000000042' AND status = 'busted';
  SELECT count(*) INTO v_before_receipts FROM public.seat_draw_receipts WHERE entry_id = '34000000-0000-0000-0000-000000000042';
  SELECT count(*) INTO v_before_history FROM public.seat_assignment_history WHERE entry_id = '34000000-0000-0000-0000-000000000042';
  v_res := public.restore_busted_player_to_seat(
    '34000000-0000-0000-0000-000000000042',
    '32000000-0000-0000-0000-000000000042', 2,
    '10000000-0000-0000-0000-000000000001', 'floor_restore'
  );
  IF v_res->>'error' <> 'table_has_active_hand' THEN RAISE EXCEPTION 'restore active-hand guard returned %', v_res; END IF;
  IF (SELECT count(*) FROM public.tournament_seats WHERE entry_id = '34000000-0000-0000-0000-000000000042') <> v_before_seats
     OR (SELECT count(*) FROM public.tournament_entries WHERE id = '34000000-0000-0000-0000-000000000042' AND status = 'busted') <> v_before_entries
     OR (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id = '34000000-0000-0000-0000-000000000042') <> v_before_receipts
     OR (SELECT count(*) FROM public.seat_assignment_history WHERE entry_id = '34000000-0000-0000-0000-000000000042') <> v_before_history THEN
    RAISE EXCEPTION 'restore active-hand guard wrote rows';
  END IF;
  RAISE NOTICE 'RESTORE_ACTIVE_HAND_GUARD_PASS';
END;
$$;

DO $$
DECLARE
  v_first JSONB;
  v_second JSONB;
  v_source UUID := '34000000-0000-0000-0000-000000000051';
BEGIN
  PERFORM pg_temp.seed_busted_entry(
    '30000000-0000-0000-0000-000000000005',
    '32000000-0000-0000-0000-000000000051',
    '31000000-0000-0000-0000-000000000051',
    '10000000-0000-0000-0000-000000000015',
    v_source,
    '35000000-0000-0000-0000-000000000051',
    '36000000-0000-0000-0000-000000000051',
    'Race One'
  );
  v_first := public.reenter_tournament_player(v_source, 100, 10, 'random_balanced');
  v_second := public.reenter_tournament_player(v_source, 100, 10, 'random_balanced');
  IF v_second->>'error' NOT IN ('reentry_already_pending', 'player_already_active') THEN
    RAISE EXCEPTION 'duplicate reentry returned %', v_second;
  END IF;
  IF (SELECT count(*) FROM public.tournament_registrations WHERE source_entry_id = v_source AND status IN ('pending', 'confirmed')) <> 1 THEN
    RAISE EXCEPTION 'duplicate reentry created more than one active registration';
  END IF;
  RAISE NOTICE 'REENTRY_DUPLICATE_SOURCE_GUARD_PASS first=% second=%', v_first, v_second;
END;
$$;

DO $$
DECLARE
  v_initial_count INTEGER;
BEGIN
  SELECT count(*) INTO v_initial_count
  FROM public.tournament_registrations
  WHERE source_entry_id IS NULL AND tournament_id = '30000000-0000-0000-0000-000000000001';
  BEGIN
    INSERT INTO public.tournament_registrations (
      tournament_id, player_id, club_id, buy_in, reference_code, status, source_entry_id
    ) VALUES (
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001', 100, 'DUP-SOURCE-ENTRY', 'confirmed',
      '34000000-0000-0000-0000-000000000011'
    );
    RAISE EXCEPTION 'source_entry_id unique index did not reject duplicate';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  IF (SELECT count(*) FROM public.tournament_registrations WHERE source_entry_id IS NULL AND tournament_id = '30000000-0000-0000-0000-000000000001') <> v_initial_count THEN
    RAISE EXCEPTION 'duplicate source-entry test changed initial registration rows';
  END IF;
  RAISE NOTICE 'SOURCE_ENTRY_ID_UNIQUENESS_PASS';
END;
$$;

SELECT public.tracker_test_assert(
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_assign_reentry_seat') = 1,
  're-entry helper must have one overload'
);
SELECT public.tracker_test_assert(
  has_function_privilege('anon', 'public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure, 'EXECUTE') = false
    AND has_function_privilege('authenticated', 'public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure, 'EXECUTE') = false,
  're-entry helper must remain internal-only'
);

\echo REENTRY_HELPER_INTEGRATION_PASS
