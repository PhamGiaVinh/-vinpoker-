-- Runs only against the disposable PostgreSQL fixture after the public
-- spectator migrations. All UUIDs belong to the disposable database.
SELECT set_config('request.jwt.claim.role', 'service_role', false);

-- The preceding appearance test deliberately revokes public access by soft-
-- deleting this fixture tournament. Restore only this disposable fixture so
-- the current-session contract can exercise its public-success path.
UPDATE public.tournaments
SET deleted_at = NULL
WHERE id = '10000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_live jsonb;
  v_last_completed jsonb;
  v_history_first jsonb;
  v_history_second jsonb;
  v_exact_hand jsonb;
  v_out_of_scope jsonb;
BEGIN
  -- The existing in-progress hand must win over every completed candidate.
  v_live := public.get_public_tournament_table_live_or_last_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_live->>'state' <> 'live'
    OR v_live #>> '{hand,id}' <> '60000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'live hand did not win selection: %', v_live;
  END IF;

  -- Complete hand #11, preserving its own ending stack and blind snapshot.
  UPDATE public.tournament_hands
  SET status = 'completed',
      created_at = '2026-09-24T07:02:00Z',
      community_cards = '["AS", "TH", "7C", "2D", "3H"]',
      pot_size = 600000,
      tracker_small_blind = 100000,
      tracker_big_blind = 200000,
      tracker_level_number = 1,
      tracker_bba = 20000
  WHERE id = '60000000-0000-4000-8000-000000000001';
  UPDATE public.hand_players
  SET ending_stack = 0, is_eliminated = true
  WHERE id = '70000000-0000-4000-8000-000000000001';

  -- A prior completed hand at the same canonical table creates a second page.
  INSERT INTO public.tournament_hands(
    id, tournament_id, tournament_table_id, table_session_id, hand_number,
    button_seat, community_cards, pot_size, tracker_small_blind,
    tracker_big_blind, tracker_level_number, tracker_bba, status, created_at
  ) VALUES (
    '60000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', 10, 1,
    '["KS", "QH", "7C", "2D", "3H"]', 400000, 100000, 200000, 1, 20000,
    'completed', '2026-09-24T07:01:00Z'
  );
  INSERT INTO public.hand_players(
    id, hand_id, tournament_id, player_id, entry_number, seat_number,
    player_name, starting_stack, ending_stack
  ) VALUES (
    '70000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 1, 1, 'A', 1800000, 2000000
  );

  v_last_completed := public.get_public_tournament_table_live_or_last_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_last_completed->>'state' <> 'last_completed'
    OR v_last_completed #>> '{hand,id}' <> '60000000-0000-4000-8000-000000000001'
    OR v_last_completed #>> '{hand,players,0,endingStack}' <> '0'
    OR v_last_completed #>> '{hand,bigBlind}' <> '200000'
    OR v_last_completed #>> '{hand,pot}' <> '600000' THEN
    RAISE EXCEPTION 'last completed snapshot was not canonical: %', v_last_completed;
  END IF;

  v_history_first := public.get_public_tournament_table_history_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', 1, NULL, NULL
  );
  IF v_history_first->>'access' <> 'public'
    OR v_history_first #>> '{items,0,handId}' <> '60000000-0000-4000-8000-000000000001'
    OR v_history_first #>> '{items,0,tableSessionId}' <> '20000000-0000-4000-8000-000000000001'
    OR v_history_first->'nextCursor' IS NULL THEN
    RAISE EXCEPTION 'first table history page invalid: %', v_history_first;
  END IF;

  v_history_second := public.get_public_tournament_table_history_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', 1,
    (v_history_first #>> '{nextCursor,createdAt}')::timestamptz,
    (v_history_first #>> '{nextCursor,id}')::uuid
  );
  IF v_history_second #>> '{items,0,handId}' <> '60000000-0000-4000-8000-000000000003'
    OR v_history_second #>> '{items,0,handId}' = v_history_first #>> '{items,0,handId}' THEN
    RAISE EXCEPTION 'history cursor skipped or duplicated a hand: % / %', v_history_first, v_history_second;
  END IF;

  v_exact_hand := public.get_public_tournament_table_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001'
  );
  IF v_exact_hand->>'id' <> '60000000-0000-4000-8000-000000000001'
    OR v_exact_hand #>> '{players,0,endingStack}' <> '0' THEN
    RAISE EXCEPTION 'exact table replay did not return the selected hand: %', v_exact_hand;
  END IF;

  v_out_of_scope := public.get_public_tournament_table_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001'
  );
  IF v_out_of_scope->>'error' <> 'hand_out_of_scope' THEN
    RAISE EXCEPTION 'hand was readable from another table: %', v_out_of_scope;
  END IF;
END;
$$;

-- A new session cannot inherit a last completed hand from its predecessor.
INSERT INTO public.table_sessions(id, tournament_id) VALUES
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
UPDATE public.tournament_tables
SET table_session_id = '20000000-0000-4000-8000-000000000003'
WHERE id = '30000000-0000-4000-8000-000000000001';

SET ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', false);
DO $$
DECLARE v_new_session jsonb;
BEGIN
  v_new_session := public.get_public_tournament_table_live_or_last_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  );
  IF v_new_session->>'state' <> 'waiting' OR v_new_session->'hand' IS NOT NULL THEN
    RAISE EXCEPTION 'new session inherited old hand: %', v_new_session;
  END IF;
END;
$$;
RESET ROLE;
