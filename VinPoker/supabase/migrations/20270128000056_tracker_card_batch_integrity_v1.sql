-- Forward-only exact-definition patch. No actor/role/ABI/grant changes.
-- ROLLBACK: restore reviewed pre-56 function definitions in a new compensating
-- migration; never undo validated card writes or replay historical migrations.
BEGIN;
DO $migration$
DECLARE
 v_definition text;
 v_body text;
 v_anchor text;
 v_validation text;
 v_function oid;
 v_metadata jsonb;
 v_metadata_before jsonb := '{}'::jsonb;
BEGIN
 -- Fail closed on authority drift, not just body drift. CREATE OR REPLACE
 -- below must preserve these reviewed production metadata values.
 FOREACH v_function IN ARRAY ARRAY[
  'public.show_hole_cards(uuid,jsonb,uuid)'::regprocedure::oid,
  'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure::oid] LOOP
  SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),
   'definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',(SELECT jsonb_agg(jsonb_build_array(a.grantee,a.grantor,a.privilege_type,a.is_grantable)
    ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)
    FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a))
  INTO v_metadata FROM pg_proc p WHERE p.oid=v_function;
  v_metadata_before:=jsonb_set(v_metadata_before,ARRAY[v_function::text],v_metadata);
  IF v_metadata->>'owner' IS DISTINCT FROM 'postgres'
   OR (v_metadata->>'definer')::boolean IS DISTINCT FROM false
   OR v_metadata->'config' IS DISTINCT FROM '["search_path=public"]'::jsonb
   OR EXISTS(SELECT 1 FROM pg_proc p,
    LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=v_function AND (a.grantee NOT IN
     ('postgres'::regrole::oid,'authenticated'::regrole::oid)
     OR a.grantor<>'postgres'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
   OR NOT has_function_privilege('authenticated',v_function,'EXECUTE') THEN
   RAISE EXCEPTION 'card_function_authority_metadata_mismatch: %',v_function::regprocedure;
  END IF;
 END LOOP;
 SELECT pg_get_functiondef(p.oid),replace(p.prosrc,chr(13),'')
 INTO v_definition,v_body FROM pg_proc p
 WHERE p.oid='public.show_hole_cards(uuid,jsonb,uuid)'::regprocedure;
 IF md5(v_body)<>'4f73608ff9d408b20be72dc4f88d6189' THEN
  RAISE EXCEPTION 'card_batch_source_definition_mismatch';
 END IF;
 v_definition:=replace(v_definition,chr(13),'');
 v_anchor:='  IF jsonb_typeof(p_player_hole_cards) <> ''array'' THEN';
 IF position(v_anchor in v_definition)=0 THEN
  RAISE EXCEPTION 'card_batch_envelope_anchor_missing';
 END IF;
 v_definition:=replace(v_definition,v_anchor,
  '  IF jsonb_typeof(p_player_hole_cards) IS DISTINCT FROM ''array'' THEN');
 v_definition:=replace(v_definition,'  v_entry_count INTEGER := 0;',
  '  v_entry_count INTEGER := 0;
  v_seen_entries TEXT[] := ARRAY[]::TEXT[];
  v_seen_cards TEXT[] := ARRAY[]::TEXT[];
  v_entry_key TEXT;');
 v_anchor:='  FOR v_item IN SELECT value FROM jsonb_array_elements(p_player_hole_cards) LOOP';
 v_validation:=$validate$
  -- Validate the entire additive batch before the first source mutation.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_player_hole_cards) LOOP
    BEGIN
      v_player_id := (v_item->>'player_id')::UUID;
      v_entry_number := (v_item->>'entry_number')::INTEGER;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END;
    v_cards := v_item->'hole_cards';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR v_player_id IS NULL OR v_entry_number IS NULL OR v_entry_number < 1
       OR jsonb_typeof(v_cards) IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END IF;
    v_entry_key := v_player_id::TEXT || ':' || v_entry_number::TEXT;
    IF v_entry_key = ANY(v_seen_entries) THEN
      RETURN jsonb_build_object('error', 'duplicate_hole_cards_participant');
    END IF;
    v_seen_entries := array_append(v_seen_entries,v_entry_key);
    v_validation := public.validate_cards(v_cards);
    IF v_validation IS DISTINCT FROM 'ok' OR jsonb_array_length(v_cards) <> 2 THEN
      RETURN jsonb_build_object('error',COALESCE(NULLIF(v_validation,'ok'),'invalid_hole_cards_payload'));
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
      AND hp.player_id=v_player_id AND hp.entry_number=v_entry_number) THEN
      RETURN jsonb_build_object('error','player_not_in_hand');
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_cards) proposed(card)
      WHERE proposed.card = ANY(v_seen_cards) OR proposed.card IN (
        SELECT jsonb_array_elements_text(COALESCE(v_hand.community_cards,'[]'::JSONB))
        UNION
        SELECT jsonb_array_elements_text(COALESCE(hp.hole_cards,'[]'::JSONB))
        FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
        AND (hp.player_id,hp.entry_number)<>(v_player_id,v_entry_number))) THEN
      RETURN jsonb_build_object('error','card_already_used_by_board_or_hole_cards');
    END IF;
    v_seen_cards := v_seen_cards || ARRAY(SELECT jsonb_array_elements_text(v_cards));
  END LOOP;
$validate$;
 IF position(v_anchor in v_definition)=0 THEN
  RAISE EXCEPTION 'card_batch_patch_anchor_missing';
 END IF;
 v_definition:=replace(v_definition,v_anchor,v_validation||chr(10)||v_anchor);
 EXECUTE v_definition;

 SELECT pg_get_functiondef(p.oid),replace(p.prosrc,chr(13),'')
 INTO v_definition,v_body FROM pg_proc p
 WHERE p.oid='public.update_community_cards(uuid,jsonb,uuid)'::regprocedure;
 IF md5(v_body)<>'64734d09453c95918299ca3f6e3cc339' THEN
  RAISE EXCEPTION 'card_board_source_definition_mismatch';
 END IF;
 v_definition:=replace(v_definition,chr(13),'');
 v_anchor:='  v_validation := public.validate_cards(p_community_cards);';
 IF position(v_anchor in v_definition)=0 THEN
  RAISE EXCEPTION 'card_board_envelope_anchor_missing';
 END IF;
 v_definition:=replace(v_definition,v_anchor,
  '  IF jsonb_typeof(p_community_cards) IS DISTINCT FROM ''array'' THEN
    RETURN jsonb_build_object(''error'', ''invalid_community_cards_payload'');
  END IF;
'||v_anchor);
 v_anchor:='  UPDATE public.tournament_hands
  SET community_cards = p_community_cards, updated_at = NOW(), locked_at = NOW()';
 v_validation:=$validate$
  -- The hand lock serializes both board and hole-card writers.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_community_cards) proposed(card)
    JOIN public.hand_players hp ON hp.hand_id=p_hand_id
    WHERE COALESCE(hp.hole_cards,'[]'::JSONB) ? proposed.card) THEN
    RETURN jsonb_build_object('error','card_already_used_by_hole_cards');
  END IF;
$validate$;
 IF position(v_anchor in v_definition)=0 THEN
  RAISE EXCEPTION 'card_board_patch_anchor_missing';
 END IF;
 EXECUTE replace(v_definition,v_anchor,v_validation||chr(10)||v_anchor);
 FOREACH v_function IN ARRAY ARRAY[
  'public.show_hole_cards(uuid,jsonb,uuid)'::regprocedure::oid,
  'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure::oid] LOOP
  SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),
   'definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',(SELECT jsonb_agg(jsonb_build_array(a.grantee,a.grantor,a.privilege_type,a.is_grantable)
    ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)
    FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a))
  INTO v_metadata FROM pg_proc p WHERE p.oid=v_function;
  IF v_metadata IS DISTINCT FROM v_metadata_before->v_function::text THEN
   RAISE EXCEPTION 'card_function_authority_postcheck_mismatch: %',v_function::regprocedure;
  END IF;
 END LOOP;
END;
$migration$;
COMMIT;
