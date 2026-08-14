\set ON_ERROR_STOP on

-- Disposable local database test. It never targets the linked production project.
BEGIN;

DO $test$
DECLARE
  v_club uuid := '8d100000-0000-4000-8000-000000000001';
  v_tournament uuid := '8d200000-0000-4000-8000-000000000001';
  v_registration uuid := '8d300000-0000-4000-8000-000000000001';
  v_player uuid := '8d400000-0000-4000-8000-000000000001';
  v_entry uuid := '8d500000-0000-4000-8000-000000000001';
  v_order uuid := '8d600000-0000-4000-8000-000000000001';
  v_snapshot_1 uuid;
  v_snapshot_1_retry uuid;
  v_snapshot_2 uuid;
  v_row record;
BEGIN
  INSERT INTO public.clubs (id, name, region)
  VALUES (v_club, 'OWNER_DIGEST_V2_LOCAL_TEST', 'TEST');
  INSERT INTO public.club_settings (club_id, timezone)
  VALUES (v_club, 'Asia/Bangkok');
  INSERT INTO public.fnb_settings (club_id, fnb_in_club_net)
  VALUES (v_club, true);
  INSERT INTO private.owner_daily_digest_settings_v2 (club_id)
  VALUES (v_club);

  INSERT INTO public.tournaments (
    id, club_id, name, start_time, buy_in, starting_stack, rake_amount, service_fee_amount
  ) VALUES (
    v_tournament, v_club, 'OWNER_DIGEST_V2_LOCAL_EVENT',
    '2026-08-01T12:00:00+07', 500000, 50000, 100000, 25000
  );

  -- An authenticated client cannot self-award free-rake even with a forged matching total.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    INSERT INTO public.tournament_registrations (
      id, club_id, tournament_id, player_id, reference_code, status,
      buy_in, total_pay, used_free_rake
    ) VALUES (
      '8d300000-0000-4000-8000-000000000098', v_club, v_tournament,
      '8d400000-0000-4000-8000-000000000098', 'OWNER_DIGEST_V2_FORGED_FREE_RAKE', 'pending',
      500000, 525000, true
    );
    RAISE EXCEPTION 'TEST_FAIL: authenticated client self-awarded free-rake';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- The trusted path must also prove a canonical slot was consumed first.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.tournaments
  SET free_rake_enabled = true, free_rake_slots = 1, free_rake_used = 1
  WHERE id = v_tournament;
  INSERT INTO public.tournament_registrations (
    id, club_id, tournament_id, player_id, reference_code, status,
    buy_in, total_pay, used_free_rake
  ) VALUES (
    '8d300000-0000-4000-8000-000000000097', v_club, v_tournament,
    '8d400000-0000-4000-8000-000000000097', 'OWNER_DIGEST_V2_SERVER_FREE_RAKE', 'pending',
    500000, 525000, true
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_registrations
    WHERE id = '8d300000-0000-4000-8000-000000000097'
      AND rake_paid_vnd = 0
      AND service_fee_paid_vnd = 25000
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: server free-rake split was not captured';
  END IF;

  -- Half-open window boundary: 05:59:59.999 is outside; exactly 06:00:00 is inside.
  INSERT INTO public.tournaments (
    id, club_id, name, start_time, buy_in, starting_stack, rake_amount, service_fee_amount
  ) VALUES
    (
      '8d200000-0000-4000-8000-000000000091', v_club, 'OWNER_DIGEST_V2_BEFORE_CUTOFF',
      '2026-08-01T05:59:59.999+07', 500000, 50000, 100000, 25000
    ),
    (
      '8d200000-0000-4000-8000-000000000092', v_club, 'OWNER_DIGEST_V2_AT_CUTOFF',
      '2026-08-01T06:00:00+07', 500000, 50000, 100000, 25000
    );
  INSERT INTO public.tournament_registrations (
    id, club_id, tournament_id, player_id, reference_code, status,
    buy_in, total_pay, used_free_rake
  ) VALUES
    (
      '8d300000-0000-4000-8000-000000000091', v_club,
      '8d200000-0000-4000-8000-000000000091',
      '8d400000-0000-4000-8000-000000000091', 'OWNER_DIGEST_V2_BEFORE_CUTOFF_REG',
      'confirmed', 500000, 625000, false
    ),
    (
      '8d300000-0000-4000-8000-000000000092', v_club,
      '8d200000-0000-4000-8000-000000000092',
      '8d400000-0000-4000-8000-000000000092', 'OWNER_DIGEST_V2_AT_CUTOFF_REG',
      'confirmed', 500000, 625000, false
    );

  BEGIN
    INSERT INTO public.tournament_registrations (
      id, club_id, tournament_id, player_id, reference_code, status,
      buy_in, total_pay, used_free_rake
    ) VALUES (
      '8d300000-0000-4000-8000-000000000099', v_club, v_tournament,
      '8d400000-0000-4000-8000-000000000099', 'OWNER_DIGEST_V2_BAD_TOTAL', 'confirmed',
      500000, 600000, false
    );
    RAISE EXCEPTION 'TEST_FAIL: mismatched registration total was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Deliberately send forged split values. The trigger must ignore them and persist 100k + 25k.
  INSERT INTO public.tournament_registrations (
    id, club_id, tournament_id, player_id, reference_code, status,
    buy_in, total_pay, used_free_rake, rake_paid_vnd, service_fee_paid_vnd
  ) VALUES (
    v_registration, v_club, v_tournament, v_player, 'OWNER_DIGEST_V2_REG_1', 'confirmed',
    500000, 625000, false, 1, 2
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_registrations
    WHERE id = v_registration
      AND rake_paid_vnd = 100000
      AND service_fee_paid_vnd = 25000
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: server fee split was not captured';
  END IF;

  BEGIN
    UPDATE public.tournament_registrations
    SET total_pay = total_pay + 1
    WHERE id = v_registration;
    RAISE EXCEPTION 'TEST_FAIL: persisted registration money was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  INSERT INTO public.tournament_entries (
    id, tournament_id, registration_id, player_id, entry_no, status,
    checked_in_at, seated_at, finished_place
  ) VALUES (
    v_entry, v_tournament, v_registration, v_player, 1, 'finished',
    '2026-08-01T12:05:00+07', '2026-08-01T12:10:00+07', 1
  );

  -- Applied payout obligation of 1,000,000 less 400,000 actually paid = 600,000 outstanding.
  INSERT INTO public.tournament_payout_runs (
    id, tournament_id, status, entries_snapshot, buy_in_snapshot, rake_snapshot,
    prize_pool_snapshot, effective_floor, itm_percent, archetype, min_cash_x,
    rounding_unit, source
  ) VALUES (
    '8d700000-0000-4000-8000-000000000001', v_tournament, 'applied', 1, 500000, 100000,
    1000000, 1000000, 100, 'DAILY', 1, 1000, 'close'
  );
  INSERT INTO public.tournament_prizes (
    id, tournament_id, position, percentage, amount
  ) VALUES (
    '8d710000-0000-4000-8000-000000000001', v_tournament, 1, 100, 1000000
  );
  INSERT INTO public.tournament_prize_payments (
    id, tournament_id, club_id, finished_place, prize_amount, status, method
  ) VALUES (
    '8d720000-0000-4000-8000-000000000001', v_tournament, v_club, 1, 400000, 'paid', 'cash'
  );

  INSERT INTO public.fnb_orders (
    id, club_id, source, status, subtotal_vnd, is_comp, paid_at
  ) VALUES (
    v_order, v_club, 'counter', 'paid', 100000, false, '2026-08-01T13:00:00+07'
  );

  -- Submitted dealer payroll is outstanding; a paid period is excluded.
  INSERT INTO public.dealers (
    id, club_id, full_name, employment_type
  ) VALUES (
    '8d730000-0000-4000-8000-000000000001', v_club,
    'OWNER_DIGEST_V2_TEST_DEALER', 'part_time'
  );
  INSERT INTO public.payroll_periods (
    id, club_id, period_year, period_month, period_start, period_end, status
  ) VALUES
    (
      '8d740000-0000-4000-8000-000000000001', v_club,
      2026, 7, '2026-07-01', '2026-07-31', 'submitted'
    ),
    (
      '8d740000-0000-4000-8000-000000000002', v_club,
      2026, 6, '2026-06-01', '2026-06-30', 'paid'
    );
  INSERT INTO public.dealer_payroll (
    id, period_id, dealer_id, club_id, employment_type, net_pay_vnd, status
  ) VALUES
    (
      '8d750000-0000-4000-8000-000000000001',
      '8d740000-0000-4000-8000-000000000001',
      '8d730000-0000-4000-8000-000000000001', v_club, 'part_time', 300000, 'pending'
    ),
    (
      '8d750000-0000-4000-8000-000000000002',
      '8d740000-0000-4000-8000-000000000002',
      '8d730000-0000-4000-8000-000000000001', v_club, 'part_time', 400000, 'pending'
    );

  v_snapshot_1 := private.generate_owner_daily_digest_snapshot_v2(
    v_club, '2026-08-01', 'MANUAL', NULL, NULL, 'local functional test'
  );
  IF v_snapshot_1 IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: first snapshot generation failed';
  END IF;

  SELECT * INTO v_row
  FROM private.owner_daily_digest_snapshots_v2
  WHERE snapshot_id = v_snapshot_1;

  IF v_row.snapshot_version <> 1
     OR v_row.registered_players <> 2
     OR v_row.attendance_players <> 1
     OR v_row.entries_count <> 1
     OR v_row.staff_count <> 0
     OR v_row.rake_paid_vnd <> 200000
     OR v_row.service_fee_paid_vnd <> 50000
     OR v_row.fnb_net_revenue_vnd <> 100000
     OR v_row.payout_outstanding_vnd <> 600000
     OR v_row.dealer_payroll_outstanding_vnd <> 300000
     OR v_row.freshness_state <> 'FRESH'
     OR v_row.money_state <> 'PROVISIONAL' THEN
    RAISE EXCEPTION 'TEST_FAIL: canonical metric mismatch';
  END IF;

  v_snapshot_1_retry := private.generate_owner_daily_digest_snapshot_v2(
    v_club, '2026-08-01', 'MANUAL', NULL, NULL, 'same source retry'
  );
  IF v_snapshot_1_retry <> v_snapshot_1 THEN
    RAISE EXCEPTION 'TEST_FAIL: same hash did not reuse snapshot';
  END IF;
  IF (SELECT count(*) FROM private.owner_daily_digest_outbox_v2 WHERE club_id = v_club) <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: same hash emitted duplicate outbox';
  END IF;

  UPDATE public.fnb_orders SET subtotal_vnd = 125000 WHERE id = v_order;
  v_snapshot_2 := private.generate_owner_daily_digest_snapshot_v2(
    v_club, '2026-08-01', 'MANUAL', NULL, NULL, 'changed source revision'
  );
  IF v_snapshot_2 IS NULL OR v_snapshot_2 = v_snapshot_1 THEN
    RAISE EXCEPTION 'TEST_FAIL: changed source did not create revision';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.owner_daily_digest_snapshots_v2
    WHERE snapshot_id = v_snapshot_2
      AND snapshot_version = 2
      AND supersedes_snapshot_id = v_snapshot_1
      AND fnb_net_revenue_vnd = 125000
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: revision lineage mismatch';
  END IF;
  IF (SELECT count(*) FROM private.owner_daily_digest_outbox_v2 WHERE club_id = v_club) <> 2 THEN
    RAISE EXCEPTION 'TEST_FAIL: revision/outbox cardinality mismatch';
  END IF;

  BEGIN
    UPDATE private.owner_daily_digest_snapshots_v2
    SET registered_players = 99
    WHERE snapshot_id = v_snapshot_2;
    RAISE EXCEPTION 'TEST_FAIL: immutable snapshot update was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
END;
$test$;

ROLLBACK;

SELECT 'PASS owner_daily_digest_snapshot_v2' AS result;
