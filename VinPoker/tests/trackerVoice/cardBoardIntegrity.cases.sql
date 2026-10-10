\set ON_ERROR_STOP on
BEGIN;
UPDATE hand_players SET hole_cards='["Ah","As"]' WHERE player_id='10000000-0000-4000-8000-000000000060';
UPDATE tournament_hands SET locked_at=now(),locked_by_user_id=auth.uid()
 WHERE id='10000000-0000-4000-8000-000000000030';
DO $$ DECLARE v_result jsonb; BEGIN
 v_result:=public.update_community_cards('10000000-0000-4000-8000-000000000030','["Ah","Kh","Qs"]',auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'card_already_used_by_hole_cards' THEN
  RAISE EXCEPTION 'BOARD_COLLISION_WRONG_RECEIPT: %',v_result;
 END IF;
 IF EXISTS(SELECT 1 FROM tournament_hands WHERE community_cards<>'[]'::jsonb) THEN
  RAISE EXCEPTION 'REPRO_FAIL: board accepted a card already in player hand';
 END IF;
END $$;
ROLLBACK;
