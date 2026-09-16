INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000000',
   1, 'completed', false, 2);
INSERT INTO public.hand_players VALUES
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 1, 4),
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', 1, 6);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 1, 'post_sb', 1),
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', 1, 'post_bb', 2);
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

INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000000',
   2, 'in_progress', false, 4);
INSERT INTO public.hand_players VALUES
  ('00000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000008', 1, 8);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000008', 1, 'post_bb', 1);

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
      AND tracker_sb_position IS NULL AND tracker_bb_position IS NULL
  ) THEN RAISE EXCEPTION 'blind_delete_reset_failed'; END IF;
END;
$assert$;

INSERT INTO public.tournament_hands VALUES
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000000',
   3, 'in_progress', false, 6);
INSERT INTO public.hand_players VALUES
  ('00000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000009', 1, 9);
INSERT INTO public.hand_actions VALUES
  ('00000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000009', 1, 'post_bb', 1);
DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_hands
    WHERE id = '00000000-0000-0000-0000-000000000003'
      AND tracker_sb_position IS NULL AND tracker_bb_position = 9
  ) THEN RAISE EXCEPTION 'invalid_predecessor_must_not_supply_dead_sb'; END IF;
END;
$assert$;
GRANT SELECT, UPDATE ON public.tournament_hands TO authenticated;
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
RESET ROLE;
SELECT 'BLIND_LINEAGE_PG17_PASS' AS verdict;
