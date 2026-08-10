\set ON_ERROR_STOP on

-- Exact migration integration test. Synthetic data only; never run against a
-- linked Supabase project or an operator/UAT tournament.

INSERT INTO auth.users(id) VALUES
  ('90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002'),
  ('90000000-0000-4000-8000-000000000003'),
  ('90000000-0000-4000-8000-000000000101'),
  ('90000000-0000-4000-8000-000000000102'),
  ('90000000-0000-4000-8000-000000000103'),
  ('90000000-0000-4000-8000-000000000104')
ON CONFLICT DO NOTHING;

INSERT INTO public.clubs(id, owner_id)
VALUES ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001');

INSERT INTO public.club_trackers(club_id, user_id)
VALUES ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002');

INSERT INTO public.club_settings(club_id, player_history_enabled)
VALUES ('91000000-0000-4000-8000-000000000001', true)
ON CONFLICT (club_id) DO UPDATE SET player_history_enabled = EXCLUDED.player_history_enabled;

INSERT INTO public.profiles(id, user_id, display_name, avatar_url)
VALUES
  ('91100000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000101', 'Player A', 'https://example.invalid/a.png'),
  ('91100000-0000-4000-8000-000000000102', '90000000-0000-4000-8000-000000000102', 'Player B', 'https://example.invalid/b.png'),
  ('91100000-0000-4000-8000-000000000103', '90000000-0000-4000-8000-000000000103', 'Player C', NULL),
  ('91100000-0000-4000-8000-000000000104', '90000000-0000-4000-8000-000000000104', 'Player D', NULL);

INSERT INTO public.tournaments(
  id, club_id, name, status, starting_stack, players_remaining,
  average_stack, registration_closed_at
) VALUES
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Hand 4 golden', 'live', 30000, 2, 30000, NULL),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Rollback proof', 'live', 30000, 2, 30000, NULL),
  ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'Closed registration', 'live', 30000, 2, 30000, now());

INSERT INTO public.game_tables(id, club_id, table_name, status)
VALUES
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Bàn 10', 'active'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Rollback Table', 'active');

INSERT INTO public.tournament_tables(
  id, tournament_id, table_id, table_number, max_seats, status, floor_control_mode
) VALUES
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 10, 2, 'active', 'tracker'),
  ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 20, 2, 'active', 'tracker');

INSERT INTO public.tournament_registrations(
  id, tournament_id, player_id, club_id, buy_in, platform_fixed_fee,
  total_pay, reference_code, status, confirmed_at, confirmed_by
) VALUES
  ('95000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000001', 1000000, 0, 1000000, 'HAND4-A', 'confirmed', now(), '90000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000102', '91000000-0000-4000-8000-000000000001', 1000000, 0, 1000000, 'HAND4-B', 'confirmed', now(), '90000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000103', '92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000103', '91000000-0000-4000-8000-000000000001', 1000000, 0, 1000000, 'ROLLBACK-C', 'confirmed', now(), '90000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000104', '92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000104', '91000000-0000-4000-8000-000000000001', 1000000, 0, 1000000, 'ROLLBACK-D', 'confirmed', now(), '90000000-0000-4000-8000-000000000001');

INSERT INTO public.tournament_entries(
  id, tournament_id, registration_id, player_id, entry_no, source,
  status, current_stack, table_id, seat_id, seat_number, seated_at
) VALUES
  ('96000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000101', 1, 'offline', 'seated', 30000, '93000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000101', 1, now()),
  ('96000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000102', '90000000-0000-4000-8000-000000000102', 1, 'offline', 'seated', 30000, '93000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000102', 2, now()),
  ('96000000-0000-4000-8000-000000000103', '92000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000103', '90000000-0000-4000-8000-000000000103', 1, 'offline', 'seated', 30000, '93000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000103', 1, now()),
  ('96000000-0000-4000-8000-000000000104', '92000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000104', '90000000-0000-4000-8000-000000000104', 1, 'offline', 'seated', 30000, '93000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000104', 2, now());

INSERT INTO public.tournament_seats(
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, entry_id, status, player_name, avatar_url, assigned_at
) VALUES
  ('97000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 1, '94000000-0000-4000-8000-000000000001', 1, 30000, true, '96000000-0000-4000-8000-000000000101', 'active', 'Player A', 'https://example.invalid/a.png', now()),
  ('97000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000102', 1, '94000000-0000-4000-8000-000000000001', 2, 30000, true, '96000000-0000-4000-8000-000000000102', 'active', 'Player B', 'https://example.invalid/b.png', now()),
  ('97000000-0000-4000-8000-000000000103', '92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000103', 1, '94000000-0000-4000-8000-000000000002', 1, 30000, true, '96000000-0000-4000-8000-000000000103', 'active', 'Player C', NULL, now()),
  ('97000000-0000-4000-8000-000000000104', '92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000104', 1, '94000000-0000-4000-8000-000000000002', 2, 30000, true, '96000000-0000-4000-8000-000000000104', 'active', 'Player D', NULL, now());

INSERT INTO public.tournament_hands(
  id, tournament_id, table_id, hand_number, hand_time, status,
  created_by, locked_by_user_id, locked_at, button_seat
) VALUES
  ('98000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 4, now(), 'in_progress', '90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', now(), 2),
  ('98000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 1, now(), 'in_progress', '90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', now(), 2);

INSERT INTO public.hand_players(
  hand_id, tournament_id, player_id, entry_number, seat_number,
  starting_stack, ending_stack, is_eliminated, side_pots, hole_cards,
  player_name, avatar_url
) VALUES
  ('98000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 1, 1, 30000, NULL, false, '[]', '[]', NULL, NULL),
  ('98000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000102', 1, 2, 30000, NULL, false, '[]', '[]', NULL, NULL),
  ('98000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000103', 1, 1, 30000, NULL, false, '[]', '[]', NULL, NULL),
  ('98000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000104', 1, 2, 30000, NULL, false, '[]', '[]', NULL, NULL);

INSERT INTO public.hand_actions(
  hand_id, player_id, entry_number, street, action_type, action_amount, action_order
) VALUES
  ('98000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000102', 1, 'preflop', 'small_blind', 100, 1),
  ('98000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000101', 1, 'preflop', 'big_blind', 200, 2),
  ('98000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000102', 1, 'preflop', 'all_in', 29900, 3),
  ('98000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000101', 1, 'preflop', 'call', 29800, 4);

DO $$
DECLARE
  v_players JSONB := jsonb_build_array(
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000101', 'entry_number', 1, 'seat_number', 1, 'starting_stack', 30000, 'ending_stack', 60000, 'is_eliminated', false, 'hole_cards', jsonb_build_array('As', 'Ad')),
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000102', 'entry_number', 1, 'seat_number', 2, 'starting_stack', 30000, 'ending_stack', 0, 'is_eliminated', true, 'hole_cards', jsonb_build_array('Ks', 'Kd'))
  );
  v_actions JSONB := jsonb_build_array(
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000102', 'entry_number', 1, 'street', 'preflop', 'action_type', 'small_blind', 'action_amount', 100, 'action_order', 1),
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000101', 'entry_number', 1, 'street', 'preflop', 'action_type', 'big_blind', 'action_amount', 200, 'action_order', 2),
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000102', 'entry_number', 1, 'street', 'preflop', 'action_type', 'all_in', 'action_amount', 29900, 'action_order', 3),
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000101', 'entry_number', 1, 'street', 'preflop', 'action_type', 'call', 'action_amount', 29800, 'action_order', 4)
  );
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', false);
  v_result := public.record_hand(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 4, now(),
    v_players, v_actions, '[]', jsonb_build_array('2c','7d','9h','3s','Kc'), 60000,
    '90000000-0000-4000-8000-000000000003'
  );
  PERFORM public.tracker_test_assert(v_result->>'error' = 'actor_not_allowed', 'cross-club/unauthorized record_hand was not blocked');

  PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
  v_result := public.record_hand(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 4, now(),
    jsonb_build_array(v_players->0), v_actions, '[]', '[]', 60000,
    '90000000-0000-4000-8000-000000000002'
  );
  PERFORM public.tracker_test_assert(v_result->>'error' = 'player_snapshot_mismatch', 'missing player payload was not blocked');

  v_result := public.record_hand(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 4, now(),
    jsonb_set(v_players, '{1,ending_stack}', '1'::JSONB), v_actions, '[]', '[]', 60000,
    '90000000-0000-4000-8000-000000000002'
  );
  PERFORM public.tracker_test_assert(v_result->>'error' IN ('player_snapshot_mismatch', 'chip_conservation_failed'), 'invalid elimination/conservation was not blocked');

  v_result := public.record_hand(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 4, now(),
    v_players, v_actions, '[]', jsonb_build_array('2c','7d','9h','3s','Kc'), 60000,
    '90000000-0000-4000-8000-000000000002'
  );
  PERFORM public.tracker_test_assert(COALESCE((v_result->>'ok')::BOOLEAN, false), 'golden Hand #4 completion failed: ' || v_result::TEXT);

  v_result := public.record_hand(
    '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 4, now(),
    v_players, v_actions, '[]', '[]', 60000,
    '90000000-0000-4000-8000-000000000002'
  );
  PERFORM public.tracker_test_assert(v_result->>'error' = 'active_hand_not_found', 'duplicate hand completion did not fail closed');
END;
$$;

DO $$
BEGIN
  PERFORM public.tracker_test_assert(
    (SELECT status = 'completed' AND pot_size = 60000 AND community_cards = jsonb_build_array('2c','7d','9h','3s','Kc') FROM public.tournament_hands WHERE id = '98000000-0000-4000-8000-000000000004'),
    'Hand #4 metadata mismatch'
  );
  PERFORM public.tracker_test_assert(
    (SELECT count(*) = 4 FROM public.hand_actions WHERE hand_id = '98000000-0000-4000-8000-000000000004'),
    'Hand #4 action stream changed'
  );
  PERFORM public.tracker_test_assert(
    (SELECT ending_stack = 60000 AND player_name = 'Player A' AND avatar_url = 'https://example.invalid/a.png' FROM public.hand_players WHERE hand_id = '98000000-0000-4000-8000-000000000004' AND player_id = '90000000-0000-4000-8000-000000000101'),
    'Player A hand snapshot/projection mismatch'
  );
  PERFORM public.tracker_test_assert(
    (SELECT ending_stack = 0 AND is_eliminated AND player_name = 'Player B' FROM public.hand_players WHERE hand_id = '98000000-0000-4000-8000-000000000004' AND player_id = '90000000-0000-4000-8000-000000000102'),
    'Player B hand snapshot/projection mismatch'
  );
  PERFORM public.tracker_test_assert(
    (SELECT chip_count = 60000 AND is_active AND status = 'active' FROM public.tournament_seats WHERE id = '97000000-0000-4000-8000-000000000101')
    AND (SELECT chip_count = 0 AND NOT is_active AND status = 'busted' FROM public.tournament_seats WHERE id = '97000000-0000-4000-8000-000000000102'),
    'seat projection mismatch after Hand #4'
  );
  PERFORM public.tracker_test_assert(
    (SELECT status = 'seated' AND current_stack = 60000 FROM public.tournament_entries WHERE id = '96000000-0000-4000-8000-000000000101')
    AND (SELECT status = 'busted' AND current_stack = 0 AND finished_place IS NULL FROM public.tournament_entries WHERE id = '96000000-0000-4000-8000-000000000102'),
    'entry projection or early placement mismatch after Hand #4'
  );
  PERFORM public.tracker_test_assert(
    (SELECT count(*) = 2 AND sum(chip_count) = 60000 FROM public.tournament_chip_counts WHERE tournament_id = '92000000-0000-4000-8000-000000000001')
    AND (SELECT players_remaining = 1 AND average_stack = 60000 FROM public.tournaments WHERE id = '92000000-0000-4000-8000-000000000001'),
    'chip-count/aggregate projection mismatch after Hand #4'
  );
  PERFORM public.tracker_test_assert(
    (SELECT count(*) = 1 FROM public.tournament_eliminations WHERE hand_id = '98000000-0000-4000-8000-000000000004')
    AND (SELECT count(*) = 0 FROM public.disposable_finalize_calls WHERE tournament_id = '92000000-0000-4000-8000-000000000001'),
    'open registration elimination/finalize gate mismatch'
  );
END;
$$;

SELECT set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  v_result JSONB;
  v_entry_id UUID;
BEGIN
  v_result := public.reenter_tournament_player(
    '96000000-0000-4000-8000-000000000102', 1000000, 0, 'fill_lowest_table'
  );
  PERFORM public.tracker_test_assert(COALESCE((v_result->>'ok')::BOOLEAN, false), 'Player B re-entry failed: ' || v_result::TEXT);
  v_entry_id := (v_result->>'entry_id')::UUID;

  PERFORM public.tracker_test_assert(
    (SELECT status = 'busted' AND current_stack = 0 FROM public.tournament_entries WHERE id = '96000000-0000-4000-8000-000000000102'),
    'source entry changed during re-entry'
  );
  PERFORM public.tracker_test_assert(
    (SELECT entry_no = 2 AND status = 'seated' AND current_stack = 30000 FROM public.tournament_entries WHERE id = v_entry_id),
    'new re-entry entry projection mismatch'
  );
  PERFORM public.tracker_test_assert(
    (SELECT count(*) = 1 FROM public.tournament_seats WHERE entry_id = v_entry_id AND is_active AND status = 'active' AND chip_count = 30000)
    AND (SELECT count(*) = 1 FROM public.tournament_chip_counts WHERE tournament_id = '92000000-0000-4000-8000-000000000001' AND player_id = '90000000-0000-4000-8000-000000000102' AND entry_number = 2 AND chip_count = 30000),
    'new seat/chip-count projection mismatch'
  );
  PERFORM public.tracker_test_assert(
    (SELECT count(*) = 1 FROM public.tournament_registrations WHERE source_entry_id = '96000000-0000-4000-8000-000000000102')
    AND (SELECT count(*) = 1 FROM public.seat_draw_receipts WHERE entry_id = v_entry_id),
    're-entry registration/receipt cardinality mismatch'
  );
  PERFORM public.tracker_test_assert(
    (SELECT players_remaining = 2 AND average_stack = 45000 FROM public.tournaments WHERE id = '92000000-0000-4000-8000-000000000001')
    AND (SELECT sum(chip_count) = 90000 FROM public.tournament_chip_counts WHERE tournament_id = '92000000-0000-4000-8000-000000000001'),
    're-entry aggregate or external-chip delta mismatch'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.disposable_fail_tracker_entry_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.player_id = '90000000-0000-4000-8000-000000000104'::UUID
     AND NEW.status = 'busted' THEN
    RAISE EXCEPTION 'INJECTED_TRACKER_WRITE_FAILURE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_disposable_fail_tracker_entry_update
  BEFORE UPDATE ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.disposable_fail_tracker_entry_update();

DO $$
DECLARE
  v_players JSONB := jsonb_build_array(
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000103', 'entry_number', 1, 'seat_number', 1, 'starting_stack', 30000, 'ending_stack', 60000, 'is_eliminated', false),
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000104', 'entry_number', 1, 'seat_number', 2, 'starting_stack', 30000, 'ending_stack', 0, 'is_eliminated', true)
  );
  v_actions JSONB := jsonb_build_array(
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000104', 'entry_number', 1, 'street', 'preflop', 'action_type', 'all_in', 'action_amount', 30000, 'action_order', 1),
    jsonb_build_object('player_id', '90000000-0000-4000-8000-000000000103', 'entry_number', 1, 'street', 'preflop', 'action_type', 'call', 'action_amount', 30000, 'action_order', 2)
  );
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
  BEGIN
    v_result := public.record_hand(
      '92000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 1, now(),
      v_players, v_actions, '[]', '[]', 60000,
      '90000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'injected failure did not fire: %', v_result;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INJECTED_TRACKER_WRITE_FAILURE%' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.tracker_test_assert(
    (SELECT status = 'in_progress' AND pot_size = 0 FROM public.tournament_hands WHERE id = '98000000-0000-4000-8000-000000000005')
    AND (SELECT count(*) = 2 FROM public.hand_players WHERE hand_id = '98000000-0000-4000-8000-000000000005' AND ending_stack IS NULL)
    AND (SELECT count(*) = 2 AND sum(chip_count) = 60000 FROM public.tournament_seats WHERE tournament_id = '92000000-0000-4000-8000-000000000002' AND is_active)
    AND (SELECT count(*) = 2 AND sum(current_stack) = 60000 FROM public.tournament_entries WHERE tournament_id = '92000000-0000-4000-8000-000000000002' AND status = 'seated')
    AND (SELECT count(*) = 0 FROM public.tournament_chip_counts WHERE tournament_id = '92000000-0000-4000-8000-000000000002')
    AND (SELECT count(*) = 0 FROM public.tournament_eliminations WHERE tournament_id = '92000000-0000-4000-8000-000000000002'),
    'injected failure left partial hand/projection writes'
  );
END;
$$;

DROP TRIGGER trg_disposable_fail_tracker_entry_update ON public.tournament_entries;
DROP FUNCTION public.disposable_fail_tracker_entry_update();

INSERT INTO public.tournament_entries(
  id, tournament_id, player_id, entry_no, source, status, current_stack
) VALUES
  ('96000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000101', 1, 'offline', 'seated', 30000),
  ('96000000-0000-4000-8000-000000000202', '92000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000102', 1, 'offline', 'seated', 30000);

UPDATE public.tournament_entries
SET status = 'busted', current_stack = 0, busted_at = now()
WHERE id = '96000000-0000-4000-8000-000000000202';

SELECT public.tracker_test_assert(
  (SELECT count(*) = 1 FROM public.disposable_finalize_calls WHERE tournament_id = '92000000-0000-4000-8000-000000000003'),
  'closed registration did not retain auto-finalize behavior'
);

SELECT public.tracker_test_assert(
  NOT has_function_privilege('anon', 'public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure, 'EXECUTE')
  AND (
    to_regprocedure('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb)') IS NULL
    OR NOT has_function_privilege(
      'authenticated',
      to_regprocedure('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb)'),
      'EXECUTE'
    )
  ),
  'record_hand grants do not fail closed'
);

SELECT public.tracker_test_assert(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure)
  AND (SELECT proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),
  'record_hand SECURITY DEFINER/search_path drift'
);

SELECT 'tracker Hand #4 completion and projection integration passed' AS result;
