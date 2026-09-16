INSERT INTO public.tournaments VALUES
  ('10000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000001', 1);
INSERT INTO public.table_sessions VALUES
  ('30000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000000', 'tracker', NULL),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000', 'manual', NULL);
INSERT INTO public.tournament_levels VALUES
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000', 1, 50000, 100000, 0, false),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000000', 2, 100000, 200000, 200000, false);
INSERT INTO public.tournament_seats VALUES
  ('10000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000000', 1, true),
  ('10000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000000', 2, true),
  ('10000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000000', 4, true),
  ('10000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000000', 6, true),
  ('10000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000000', 8, true),
  ('10000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000000', 9, true);
INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000000',
   1, 'completed', false, 2);
DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000001'
      AND tracker_sb_position = 4 AND tracker_bb_position = 6
      AND tracker_level_number = 1 AND tracker_small_blind = 50000
      AND tracker_big_blind = 100000 AND tracker_bba = 0)
  THEN RAISE EXCEPTION 'start_hand_floor_snapshot_failed'; END IF;
END;
$assert$;
INSERT INTO public.hand_players VALUES
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 1, 4),
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', 1, 6);
DO $assert$
BEGIN
  BEGIN
    INSERT INTO public.hand_actions VALUES
      ('00000000-0000-0000-0000-000000000001',
       '40000000-0000-0000-0000-000000000004', 1, 'post_sb', 1, 60000);
    RAISE EXCEPTION 'wrong_floor_blind_was_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'tracker_blind_amount_mismatch' THEN RAISE; END IF;
  END;
END;
$assert$;
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 1, 'post_sb', 1, 50000),
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', 1, 'post_bb', 2, 100000);
DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000001'
      AND tracker_sb_position = 4 AND tracker_bb_position = 6
  ) THEN RAISE EXCEPTION 'posted_blind_snapshot_failed'; END IF;
END;
$assert$;
-- Model an otherwise valid hand recorded before the lineage columns existed.
UPDATE public.tournament_hands
SET tracker_sb_position = NULL, tracker_bb_position = NULL
WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE public.tournament_seats SET is_active = false WHERE seat_number = 6;

INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000000',
   2, 'in_progress', false, 4);
DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000002'
      AND tracker_sb_position = 6 AND tracker_bb_position = 8
      AND tracker_level_number = 1 AND tracker_big_blind = 100000)
  THEN RAISE EXCEPTION 'dead_sb_not_frozen_at_start'; END IF;
END;
$assert$;
INSERT INTO public.hand_players VALUES
  ('00000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000008', 1, 8);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000008', 1, 'post_bb', 1, 100000);

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000002'
      AND tracker_sb_position = 6 AND tracker_bb_position = 8
  ) THEN RAISE EXCEPTION 'dead_sb_snapshot_failed'; END IF;
END;
$assert$;

DELETE FROM public.hand_actions
WHERE hand_id = '00000000-0000-0000-0000-000000000002';
DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000002'
      AND tracker_sb_position = 6 AND tracker_bb_position = 8
  ) THEN RAISE EXCEPTION 'start_snapshot_lost_after_blind_delete'; END IF;
END;
$assert$;

UPDATE public.tournaments
SET current_level_id = '50000000-0000-0000-0000-000000000002', current_level = 1;

INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000000',
   3, 'in_progress', false, 6);
INSERT INTO public.hand_players (hand_id, player_id, entry_number, seat_number, starting_stack) VALUES
  ('00000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000009', 1, 9, 2000000),
  ('00000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000008', 1, 8, 30000);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000008', 1, 'post_sb', 1, 30000);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000009', 1, 'post_bb', 2, 200000);
DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000003'
      AND tracker_sb_position = 8 AND tracker_bb_position = 9
      AND tracker_level_number = 2 AND tracker_small_blind = 100000
      AND tracker_big_blind = 200000 AND tracker_bba = 200000
  ) THEN RAISE EXCEPTION 'manual_button_override_or_floor_level_failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000002'
      AND tracker_level_number = 1 AND tracker_big_blind = 100000)
  THEN RAISE EXCEPTION 'prior_hand_level_mutated'; END IF;
END;
$assert$;
UPDATE public.tournament_levels SET is_break = true
WHERE id = '50000000-0000-0000-0000-000000000002';
INSERT INTO public.tournament_hands (id, tournament_id, table_id,
  table_session_id, hand_number, status, button_seat)
VALUES ('00000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000000',
  '30000000-0000-0000-0000-000000000001', 6, 'in_progress', 2);
INSERT INTO public.hand_players VALUES
  ('00000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000004', 1, 4);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000006',
   '40000000-0000-0000-0000-000000000004', 1, 'post_sb', 1, 12345);
DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000006'
      AND tracker_level_number IS NULL AND tracker_sb_position IS NULL
      AND tracker_bb_position IS NULL)
  THEN RAISE EXCEPTION 'manual_session_was_modified_by_tracker_lineage'; END IF;
END;
$assert$;
DO $assert$
BEGIN
  BEGIN
    INSERT INTO public.tournament_hands (id, tournament_id, table_id,
      table_session_id, hand_number, status, button_seat)
    VALUES ('00000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000000',
      '20000000-0000-0000-0000-000000000000',
      '30000000-0000-0000-0000-000000000000', 4, 'in_progress', 8);
    RAISE EXCEPTION 'break_level_started_hand';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'tracker_floor_blind_level_unavailable' THEN RAISE; END IF;
  END;
END;
$assert$;
UPDATE public.tournament_levels SET is_break = false
WHERE id = '50000000-0000-0000-0000-000000000002';
GRANT SELECT, INSERT, UPDATE ON public.tournament_hands TO authenticated;
SET ROLE authenticated;
DO $assert$
BEGIN
  BEGIN
    UPDATE public.tournament_hands
    SET tracker_sb_position = 7
    WHERE id = '00000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'client_snapshot_update_was_allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'tracker_blind_positions_server_owned' THEN RAISE; END IF;
  END;
END;
$assert$;
INSERT INTO public.tournament_hands (id, tournament_id, table_id,
  table_session_id, hand_number, status, button_seat)
VALUES ('00000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000000',
  '30000000-0000-0000-0000-000000000000', 5, 'in_progress', 8);
RESET ROLE;
DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000005'
      AND tracker_level_number = 2 AND tracker_big_blind = 200000
      AND tracker_sb_position = 9 AND tracker_bb_position = 1)
  THEN RAISE EXCEPTION 'invoker_start_snapshot_missing'; END IF;
END;
$assert$;
SELECT 'BLIND_LINEAGE_PG17_PASS' AS verdict;
