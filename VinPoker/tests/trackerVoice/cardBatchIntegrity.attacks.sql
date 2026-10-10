\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
 v_first jsonb:= '{"player_id":"10000000-0000-4000-8000-000000000060","entry_number":1,"hole_cards":["Ah","As"]}';
 v_second jsonb;
 v_result jsonb;
 v_hand uuid:='10000000-0000-4000-8000-000000000030';
BEGIN
 FOR v_second IN SELECT value FROM jsonb_array_elements('[
 {"player_id":"10000000-0000-4000-8000-000000000061","entry_number":1},
 {"player_id":"10000000-0000-4000-8000-000000000061","entry_number":1,"hole_cards":["bad","Ks"]},
 {"player_id":"10000000-0000-4000-8000-000000000061","entry_number":1,"hole_cards":["Kh","Kh"]},
 {"player_id":"10000000-0000-4000-8000-000000000061","entry_number":1,"hole_cards":["Ah","Ks"]},
 {"player_id":"10000000-0000-4000-8000-000000000060","entry_number":1,"hole_cards":["Kh","Ks"]},
 {"player_id":"10000000-0000-4000-8000-000000000061","entry_number":2147483648,"hole_cards":["Kh","Ks"]}
 ]'::jsonb) LOOP
  v_result:=public.show_hole_cards(v_hand,jsonb_build_array(v_first,v_second),auth.uid());
  IF NOT(v_result ? 'error') OR EXISTS(SELECT 1 FROM hand_players WHERE hole_cards<>'[]') THEN
   RAISE EXCEPTION 'batch failure not atomic: %',v_result;
  END IF;
 END LOOP;
 v_result:=public.show_hole_cards(v_hand,jsonb_build_array(v_first,
  '{"player_id":"10000000-0000-4000-8000-000000000061","entry_number":1,"hole_cards":["Kh","Ks"]}'::jsonb),auth.uid());
 IF v_result->>'status'<>'success' OR (SELECT count(*) FROM hand_players WHERE jsonb_array_length(hole_cards)=2)<>2 THEN
  RAISE EXCEPTION 'valid multi-seat batch failed: %',v_result;
 END IF;
 v_result:=public.update_community_cards(v_hand,'["2h","3s","4d"]',auth.uid());
 IF v_result->>'status'<>'success' THEN RAISE EXCEPTION 'valid board failed: %',v_result; END IF;
 v_result:=public.show_hole_cards(v_hand,jsonb_build_array(v_first),'10000000-0000-4000-8000-000000000099');
 IF v_result->>'error'<>'actor_mismatch' THEN RAISE EXCEPTION 'actor mismatch bypassed'; END IF;
END $$;
ROLLBACK;
