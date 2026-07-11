-- Atomic tournament hand edit + forward resettle commit (SOURCE-ONLY).
-- The public client cannot execute the commit. The dedicated Edge function must
-- recompute the full chain from database rows and submit one service-role payload.

CREATE TABLE IF NOT EXISTS public.tournament_resettle_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, idempotency_key)
);
ALTER TABLE public.tournament_resettle_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_resettle_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tournament_resettle_requests TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_tournament_live_resettle(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id=p_tournament_id AND (
      public.is_club_owner(auth.uid(),t.club_id)
      OR public.is_club_admin(auth.uid(),t.club_id)
    )
  );
$$;
REVOKE ALL ON FUNCTION public.authorize_tournament_live_resettle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_tournament_live_resettle(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_tournament_live_resettle(
  p_tournament_id uuid,
  p_hand_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_expected_hand_updated_at timestamptz,
  p_expected_elimination_count integer,
  p_edit jsonb,
  p_hand_changes jsonb,
  p_final_stacks jsonb,
  p_winner_ids jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role','');
  v_hand public.tournament_hands%ROWTYPE; v_existing public.tournament_resettle_requests%ROWTYPE;
  v_elims integer; v_change jsonb; v_stack jsonb; v_action jsonb; v_hole jsonb;
  v_club uuid; v_result jsonb;
BEGIN
  IF v_role <> 'service_role' THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key))<12 THEN RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_existing FROM public.tournament_resettle_requests
    WHERE tournament_id=p_tournament_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE='22023'; END IF;
    RETURN v_existing.result;
  END IF;

  SELECT * INTO v_hand FROM public.tournament_hands WHERE id=p_hand_id AND tournament_id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status='in_progress' OR COALESCE(v_hand.is_voided,false) THEN RAISE EXCEPTION 'invalid_target_hand' USING ERRCODE='P0001'; END IF;
  IF p_expected_hand_updated_at IS NOT NULL AND v_hand.updated_at IS DISTINCT FROM p_expected_hand_updated_at THEN RAISE EXCEPTION 'stale_hand' USING ERRCODE='40001'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_hands WHERE tournament_id=p_tournament_id AND status='in_progress' AND NOT COALESCE(is_voided,false)) THEN RAISE EXCEPTION 'active_hand_blocks_resettle' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO v_elims FROM public.tournament_eliminations WHERE tournament_id=p_tournament_id;
  IF v_elims<>p_expected_elimination_count THEN RAISE EXCEPTION 'elimination_state_changed' USING ERRCODE='40001'; END IF;
  SELECT club_id INTO v_club FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;

  IF p_edit ? 'community_cards' THEN UPDATE public.tournament_hands SET community_cards=ARRAY(SELECT jsonb_array_elements_text(p_edit->'community_cards')) WHERE id=p_hand_id; END IF;
  IF p_edit ? 'pot_size' THEN UPDATE public.tournament_hands SET pot_size=(p_edit->>'pot_size')::numeric WHERE id=p_hand_id; END IF;
  IF p_edit ? 'side_pots' THEN UPDATE public.tournament_hands SET side_pots=p_edit->'side_pots' WHERE id=p_hand_id; END IF;

  IF p_edit ? 'hole_cards' THEN
    FOR v_hole IN SELECT * FROM jsonb_array_elements(p_edit->'hole_cards') LOOP
      UPDATE public.hand_players SET hole_cards=ARRAY(SELECT jsonb_array_elements_text(v_hole->'hole_cards'))
      WHERE hand_id=p_hand_id AND player_id=(v_hole->>'player_id')::uuid AND entry_number=COALESCE((v_hole->>'entry_number')::integer,1);
      IF NOT FOUND THEN RAISE EXCEPTION 'hole_player_missing' USING ERRCODE='P0001'; END IF;
    END LOOP;
  END IF;

  IF p_edit ? 'actions' THEN
    DELETE FROM public.hand_actions WHERE hand_id=p_hand_id;
    FOR v_action IN SELECT * FROM jsonb_array_elements(p_edit->'actions') LOOP
      INSERT INTO public.hand_actions(hand_id,player_id,entry_number,street,action_type,action_amount,action_order)
      VALUES(p_hand_id,(v_action->>'player_id')::uuid,COALESCE((v_action->>'entry_number')::integer,1),
        COALESCE(v_action->>'street','preflop'),v_action->>'action_type',COALESCE((v_action->>'action_amount')::numeric,0),(v_action->>'action_order')::integer);
    END LOOP;
  END IF;

  FOR v_change IN SELECT * FROM jsonb_array_elements(p_hand_changes) LOOP
    UPDATE public.hand_players SET
      starting_stack=(v_change->>'starting_stack')::numeric,
      ending_stack=(v_change->>'ending_stack')::numeric,
      is_eliminated=((v_change->>'ending_stack')::numeric=0)
    WHERE hand_id=(v_change->>'hand_id')::uuid AND player_id=(v_change->>'player_id')::uuid
      AND entry_number=COALESCE((v_change->>'entry_number')::integer,1);
    IF NOT FOUND THEN RAISE EXCEPTION 'hand_player_change_missing' USING ERRCODE='P0001'; END IF;
  END LOOP;

  FOR v_stack IN SELECT * FROM jsonb_array_elements(p_final_stacks) LOOP
    UPDATE public.tournament_chip_counts SET chip_count=(v_stack->>'chip_count')::numeric,updated_at=now()
    WHERE tournament_id=p_tournament_id AND player_id=(v_stack->>'player_id')::uuid
      AND entry_number=COALESCE((v_stack->>'entry_number')::integer,1)
      AND chip_count=(v_stack->>'expected_current')::numeric;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_live_stack' USING ERRCODE='40001'; END IF;
    UPDATE public.tournament_seats SET chip_count=(v_stack->>'chip_count')::numeric
    WHERE tournament_id=p_tournament_id AND player_id=(v_stack->>'player_id')::uuid AND entry_number=COALESCE((v_stack->>'entry_number')::integer,1);
  END LOOP;

  UPDATE public.tournament_hands SET updated_at=now() WHERE id=p_hand_id;
  v_result:=jsonb_build_object('ok',true,'changed_players',jsonb_array_length(p_final_stacks),'changed_hands',jsonb_array_length(p_hand_changes));
  INSERT INTO public.tournament_resettle_requests(tournament_id,hand_id,idempotency_key,request_hash,result,actor_user_id)
    VALUES(p_tournament_id,p_hand_id,p_idempotency_key,p_request_hash,v_result,p_actor_user_id);
  INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
    VALUES(v_club,p_actor_user_id,'tournament_hand_atomic_resettle','tournament_hand',p_hand_id,
      jsonb_build_object('reason',left(COALESCE(p_edit->>'reason',''),500),'changed_hands',jsonb_array_length(p_hand_changes),
        'winner_player_ids',p_winner_ids,'idempotency_key',p_idempotency_key));
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_tournament_live_resettle(uuid,uuid,uuid,text,text,timestamptz,integer,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tournament_live_resettle(uuid,uuid,uuid,text,text,timestamptz,integer,jsonb,jsonb,jsonb,jsonb) TO service_role;
