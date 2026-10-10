\set ON_ERROR_STOP on
BEGIN;
-- Whole-row snapshots include timestamps and any revision columns in the harness.
-- This focused fixture has no queue; current-schema queue checks remain separate.
DO $$ DECLARE
 v_result jsonb;
 v_hand uuid:='10000000-0000-4000-8000-000000000030';
 v_before jsonb;
 v_after jsonb;
 v_payload jsonb;
 v_operation text;
BEGIN
 UPDATE public.tournament_hands SET locked_at=now(),locked_by_user_id=auth.uid() WHERE id=v_hand;
 SELECT jsonb_build_object('hand',to_jsonb(h),'players',
  (SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=v_hand))
 INTO v_before FROM public.tournament_hands h WHERE h.id=v_hand;
 FOREACH v_operation IN ARRAY ARRAY['holes','board'] LOOP
  FOREACH v_payload IN ARRAY ARRAY[NULL::jsonb,'null'::jsonb] LOOP
   IF v_operation='holes' THEN
    v_result:=public.show_hole_cards(v_hand,v_payload,auth.uid());
   ELSE
    v_result:=public.update_community_cards(v_hand,v_payload,auth.uid());
   END IF;
   IF v_result->>'error' IS DISTINCT FROM
    (CASE WHEN v_operation='holes' THEN 'invalid_hole_cards_payload' ELSE 'invalid_community_cards_payload' END) THEN
    RAISE EXCEPTION 'NULL_ENVELOPE_WRONG_RECEIPT: %, %, %',v_operation,v_payload,v_result;
   END IF;
   SELECT jsonb_build_object('hand',to_jsonb(h),'players',
    (SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.id) FROM public.hand_players hp WHERE hp.hand_id=v_hand))
   INTO v_after FROM public.tournament_hands h WHERE h.id=v_hand;
   IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'NULL_ENVELOPE_MUTATED_STATE: %, %',v_operation,v_payload;
   END IF;
  END LOOP;
 END LOOP;
 RAISE NOTICE 'NULL_ENVELOPE_RECEIPT_AND_ZERO_DELTA_PASS';
END $$;
ROLLBACK;
