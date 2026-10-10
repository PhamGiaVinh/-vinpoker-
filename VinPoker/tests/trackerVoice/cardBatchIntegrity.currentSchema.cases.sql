SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
UPDATE public.tournament_hands SET locked_by_user_id=auth.uid(),locked_at=now()
 WHERE id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_before jsonb;v_after jsonb;v_second jsonb;v_result jsonb; BEGIN
 SELECT jsonb_build_object('hand',to_jsonb(h),'players',
  (SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=h.id))
 INTO v_before FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
 FOR v_second IN SELECT value FROM jsonb_array_elements('[
 {"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1},
 {"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["bad","Ks"]},
 {"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Kh","Kh"]},
 {"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Ah","Ks"]},
 {"player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"hole_cards":["Kh","Ks"]},
 {"player_id":"82000000-0000-4000-8000-000000000002","entry_number":2147483648,"hole_cards":["Kh","Ks"]},
 {"player_id":"82000000-0000-4000-8000-000000000099","entry_number":1,"hole_cards":["Kh","Ks"]}
 ]'::jsonb) LOOP
  v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001',
   jsonb_build_array('{"player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"hole_cards":["Ah","As"]}'::jsonb,v_second),auth.uid());
  IF NOT(v_result ? 'error') THEN RAISE EXCEPTION 'MALFORMED_BATCH_ACCEPTED: %',v_result; END IF;
  SELECT jsonb_build_object('hand',to_jsonb(h),'players',
   (SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=h.id))
  INTO v_after FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'MALFORMED_BATCH_PARTIAL_WRITE'; END IF;
 END LOOP;
END $$;
DO $$ DECLARE v_before jsonb;v_after jsonb;v_result jsonb; BEGIN
 SELECT to_jsonb(h) INTO v_before FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
 IF v_before IS NULL THEN RAISE EXCEPTION 'TRACKER_FIXTURE_NOT_VISIBLE'; END IF;
 v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001',NULL,auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'invalid_hole_cards_payload' THEN RAISE EXCEPTION 'NULL_HOLES_WRONG_RECEIPT: %',v_result; END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001',NULL,auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'invalid_community_cards_payload' THEN RAISE EXCEPTION 'NULL_BOARD_WRONG_RECEIPT: %',v_result; END IF;
 v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001','null'::jsonb,auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'invalid_hole_cards_payload' THEN RAISE EXCEPTION 'JSON_NULL_HOLES_WRONG_RECEIPT: %',v_result; END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001','null'::jsonb,auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'invalid_community_cards_payload' THEN RAISE EXCEPTION 'JSON_NULL_BOARD_WRONG_RECEIPT: %',v_result; END IF;
 SELECT to_jsonb(h) INTO v_after FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
 IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'NULL_MUTATED_HAND_OR_REVISION'; END IF;
END $$;
DO $$ DECLARE v_result jsonb;v_revision bigint;v_new_revision bigint; BEGIN
 SELECT source_revision INTO v_revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001',
 '[{"player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"hole_cards":["Ah","As"]},{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Kh","Ks"]}]',auth.uid());
 IF v_result->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'TRACKER_VALID_BATCH_FAILED: %',v_result; END IF;
 IF (SELECT hole_cards FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001' AND player_id='82000000-0000-4000-8000-000000000001') IS DISTINCT FROM '["Ah","As"]'::jsonb
  OR (SELECT hole_cards FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001' AND player_id='82000000-0000-4000-8000-000000000002') IS DISTINCT FROM '["Kh","Ks"]'::jsonb THEN
  RAISE EXCEPTION 'VALID_BATCH_STORED_WRONG_CARDS';
 END IF;
 SELECT source_revision INTO v_new_revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 IF v_new_revision<=v_revision THEN RAISE EXCEPTION 'HOLE_WRITER_DID_NOT_BUMP_REVISION'; END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001','["Ah","2s","3d"]',auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'card_already_used_by_hole_cards' THEN RAISE EXCEPTION 'BOARD_COLLISION_WRONG_RECEIPT: %',v_result; END IF;
 IF (SELECT source_revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM v_new_revision THEN
  RAISE EXCEPTION 'DENIED_BOARD_CHANGED_REVISION';
 END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001','["2h","3s","4d"]',auth.uid());
 IF v_result->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'VALID_BOARD_FAILED: %',v_result; END IF;
 IF (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '["2h","3s","4d"]'::jsonb THEN
  RAISE EXCEPTION 'VALID_BOARD_STORED_WRONG_CARDS';
 END IF;
 IF (SELECT source_revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001')<=v_new_revision THEN
  RAISE EXCEPTION 'BOARD_WRITER_DID_NOT_BUMP_REVISION';
 END IF;
END $$;
RESET ROLE;
CREATE TEMP TABLE card_negative_snapshot AS
 SELECT jsonb_build_object('hand',to_jsonb(h),'players',
  (SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=h.id)) state
 FROM public.tournament_hands h WHERE h.id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE card_negative_queue_snapshot AS
 SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision),'[]'::jsonb) state
 FROM public.tracker_historical_display_queue q WHERE q.hand_id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_result jsonb; BEGIN
 v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]','81100000-0000-4000-8000-000000000001');
 IF v_result->>'error' IS DISTINCT FROM 'actor_mismatch' THEN RAISE EXCEPTION 'HOLES_ACTOR_MISMATCH_NOT_DENIED: %',v_result; END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001','[]','81100000-0000-4000-8000-000000000001');
 IF v_result->>'error' IS DISTINCT FROM 'actor_mismatch' THEN RAISE EXCEPTION 'BOARD_ACTOR_MISMATCH_NOT_DENIED: %',v_result; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_result jsonb; BEGIN
 v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]',auth.uid());
 IF NOT (v_result ? 'error') THEN RAISE EXCEPTION 'FOREIGN_HOLES_NOT_DENIED: %',v_result; END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001','[]',auth.uid());
 IF NOT (v_result ? 'error') THEN RAISE EXCEPTION 'FOREIGN_BOARD_NOT_DENIED: %',v_result; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE v_after jsonb;v_signature text; BEGIN
 SELECT jsonb_build_object('hand',to_jsonb(h),'players',
  (SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=h.id))
 INTO v_after FROM public.tournament_hands h WHERE h.id='86000000-0000-4000-8000-000000000001';
 IF v_after IS DISTINCT FROM (SELECT state FROM card_negative_snapshot) THEN RAISE EXCEPTION 'DENIED_ACTORS_MUTATED_STATE'; END IF;
 IF (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision),'[]'::jsonb)
  FROM public.tracker_historical_display_queue q WHERE q.hand_id='86000000-0000-4000-8000-000000000001')
  IS DISTINCT FROM (SELECT state FROM card_negative_queue_snapshot) THEN
  RAISE EXCEPTION 'DENIED_ACTORS_MUTATED_QUEUE';
 END IF;
 FOREACH v_signature IN ARRAY ARRAY['public.show_hole_cards(uuid,jsonb,uuid)','public.update_community_cards(uuid,jsonb,uuid)'] LOOP
  IF has_function_privilege('anon',v_signature,'EXECUTE') OR has_function_privilege('service_role',v_signature,'EXECUTE') THEN
   RAISE EXCEPTION 'CARD_CORE_UNEXPECTED_ROLE_GRANT: %',v_signature;
  END IF;
 END LOOP;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]',NULL);
  RAISE EXCEPTION 'ANON_HOLES_EXECUTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.update_community_cards('86000000-0000-4000-8000-000000000001','[]',NULL);
  RAISE EXCEPTION 'ANON_BOARD_EXECUTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]',NULL);
  RAISE EXCEPTION 'SERVICE_DIRECT_HOLES_EXECUTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.update_community_cards('86000000-0000-4000-8000-000000000001','[]',NULL);
  RAISE EXCEPTION 'SERVICE_DIRECT_BOARD_EXECUTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Complete only this synthetic hand to exercise the real enqueue trigger.
UPDATE public.tournament_hands SET status='completed'
 WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE card_completed_snapshot AS
 SELECT to_jsonb(h) state FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE card_completed_queue_snapshot AS
 SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision),'[]'::jsonb) state
 FROM public.tracker_historical_display_queue q WHERE hand_id='86000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q
  JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
  WHERE h.id='86000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'COMPLETED_HAND_CURRENT_REVISION_NOT_QUEUED';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_result jsonb; BEGIN
 v_result:=public.show_hole_cards('86000000-0000-4000-8000-000000000001','[]',auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'hand_not_in_progress' THEN RAISE EXCEPTION 'COMPLETED_HOLES_WRONG_RECEIPT: %',v_result; END IF;
 v_result:=public.update_community_cards('86000000-0000-4000-8000-000000000001','[]',auth.uid());
 IF v_result->>'error' IS DISTINCT FROM 'Hand is not in progress' THEN RAISE EXCEPTION 'COMPLETED_BOARD_WRONG_RECEIPT: %',v_result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001')
  IS DISTINCT FROM (SELECT state FROM card_completed_snapshot) THEN RAISE EXCEPTION 'COMPLETED_DENIAL_MUTATED_HAND'; END IF;
 IF (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision),'[]'::jsonb)
  FROM public.tracker_historical_display_queue q WHERE hand_id='86000000-0000-4000-8000-000000000001')
  IS DISTINCT FROM (SELECT state FROM card_completed_queue_snapshot) THEN RAISE EXCEPTION 'COMPLETED_DENIAL_MUTATED_QUEUE'; END IF;
END $$;
