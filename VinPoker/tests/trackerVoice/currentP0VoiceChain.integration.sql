\set ON_ERROR_STOP on

-- This suite runs only after the exact current-production P0 baseline and the
-- future prerequisite order: 080 -> 12003 -> 12008. It protects the P0
-- catalog while allowing the reviewed Voice-aware record_action/heartbeat
-- definitions to replace their pre-Voice equivalents.

DO $$
DECLARE
  v_start_hand TEXT;
  v_record_action TEXT;
  v_heartbeat TEXT;
  v_takeover TEXT;
  v_void_hand TEXT;
  v_cleanup TEXT;
  v_signature TEXT;
  v_security_definer BOOLEAN;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.start_hand(uuid,uuid,integer,timestamp with time zone,uuid,integer)',
    'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)',
    'public.heartbeat_lock(uuid,uuid)',
    'public.update_community_cards(uuid,jsonb,uuid)',
    'public.show_hole_cards(uuid,jsonb,uuid)',
    'public.delete_last_action(uuid,uuid)',
    'public.takeover_hand_lock(uuid,boolean,uuid)',
    'public.void_last_hand(uuid)',
    'public.cleanup_orphan_hands(interval)'
  ] LOOP
    PERFORM public.tracker_voice_test_assert(
      to_regprocedure(v_signature) IS NOT NULL,
      format('required P0 function is missing: %s', v_signature)
    );
    PERFORM public.tracker_voice_test_assert(
      NOT has_function_privilege('anon', v_signature::regprocedure, 'EXECUTE')
      AND NOT has_function_privilege('service_role', v_signature::regprocedure, 'EXECUTE')
      AND has_function_privilege('authenticated', v_signature::regprocedure, 'EXECUTE'),
      format('P0 mutation ACL regressed: %s', v_signature)
    );
    v_security_definer := v_signature = ANY (ARRAY[
      'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)',
      'public.heartbeat_lock(uuid,uuid)',
      'public.takeover_hand_lock(uuid,boolean,uuid)',
      'public.void_last_hand(uuid)',
      'public.cleanup_orphan_hands(interval)'
    ]);
    PERFORM public.tracker_voice_test_assert(
      EXISTS (
        SELECT 1
        FROM pg_proc p
        WHERE p.oid = v_signature::regprocedure
          AND pg_get_userbyid(p.proowner) = 'postgres'
          AND p.prosecdef = v_security_definer
          AND coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=public%'
      ),
      format('P0 owner, security mode, or search_path regressed: %s', v_signature)
    );
  END LOOP;

  SELECT pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamp with time zone,uuid,integer)'::regprocedure)
    INTO v_start_hand;
  SELECT pg_get_functiondef('public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure)
    INTO v_record_action;
  SELECT pg_get_functiondef('public.heartbeat_lock(uuid,uuid)'::regprocedure)
    INTO v_heartbeat;
  SELECT pg_get_functiondef('public.takeover_hand_lock(uuid,boolean,uuid)'::regprocedure)
    INTO v_takeover;
  SELECT pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure)
    INTO v_void_hand;
  SELECT pg_get_functiondef('public.cleanup_orphan_hands(interval)'::regprocedure)
    INTO v_cleanup;

  PERFORM public.tracker_voice_test_assert(
    position('v_actor_user_id UUID := auth.uid()' IN v_start_hand) > 0
    AND position('actor_mismatch' IN v_start_hand) > 0
    AND position('public.is_club_tracker(v_actor_user_id, v_tt.club_id)' IN v_start_hand) > 0,
    'start_hand auth.uid authority regressed after the Voice chain'
  );
  PERFORM public.tracker_voice_test_assert(
    position('v_actor UUID := auth.uid()' IN v_record_action) > 0
    AND position('actor_mismatch' IN v_record_action) > 0
    AND position('tracker_lock_required' IN v_record_action) > 0
    AND position('FOR UPDATE OF h' IN v_record_action) > 0
    AND position('UPDATE public.tournament_hands' IN v_record_action) = 0,
    'Voice-aware record_action lost P0 actor or lock containment'
  );
  PERFORM public.tracker_voice_test_assert(
    position('v_actor UUID := auth.uid()' IN v_heartbeat) > 0
    AND position('actor_mismatch' IN v_heartbeat) > 0
    AND position('SET locked_by_user_id = p_user_id' IN v_heartbeat) = 0
    AND position('tracker_lock_owned_by_another' IN v_heartbeat) > 0,
    'heartbeat can forge or steal a fresh lock after the Voice chain'
  );
  PERFORM public.tracker_voice_test_assert(
    position('v_actor uuid := auth.uid()' IN v_takeover) > 0
    AND position('SET locked_by_user_id = p_actor_user_id' IN v_takeover) = 0
    AND position('public.is_club_tracker(v_actor, v_club_id)' IN v_takeover) > 0,
    'takeover authority regressed after the Voice chain'
  );
  PERFORM public.tracker_voice_test_assert(
    position('v_actor UUID := auth.uid()' IN pg_get_functiondef(
      'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure
    )) > 0
    AND position('actor_mismatch' IN pg_get_functiondef(
      'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure
    )) > 0
    AND position('tracker_lock_owned_by_another' IN pg_get_functiondef(
      'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure
    )) > 0
    AND position('v_actor UUID := auth.uid()' IN pg_get_functiondef(
      'public.show_hole_cards(uuid,jsonb,uuid)'::regprocedure
    )) > 0
    AND position('actor_mismatch' IN pg_get_functiondef(
      'public.show_hole_cards(uuid,jsonb,uuid)'::regprocedure
    )) > 0
    AND position('v_actor UUID := auth.uid()' IN pg_get_functiondef(
      'public.delete_last_action(uuid,uuid)'::regprocedure
    )) > 0
    AND position('actor_mismatch' IN pg_get_functiondef(
      'public.delete_last_action(uuid,uuid)'::regprocedure
    )) > 0,
    'board, showdown, or undo writer authority regressed after the Voice chain'
  );
  PERFORM public.tracker_voice_test_assert(
    position('v_actor UUID := auth.uid()' IN v_void_hand) > 0
    AND position('v_actor UUID := auth.uid()' IN v_cleanup) > 0,
    'terminal writer authority regressed after the Voice chain'
  );

  PERFORM public.tracker_voice_test_assert(
    to_regclass('public.tracker_voice_configs') IS NOT NULL
    AND to_regclass('public.tracker_voice_events') IS NOT NULL
    AND to_regclass('public.tracker_floor_alerts') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.tracker_voice_events'::regclass
        AND c.conname = 'tracker_voice_events_provider_name_check'
        AND pg_get_constraintdef(c.oid) LIKE '%gemini_live%'
    ),
    'Voice/Gemini objects are not fully present after the exact chain'
  );
  PERFORM public.tracker_voice_test_assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tracker_voice_events'::regclass)
    AND NOT has_function_privilege(
      'authenticated',
      'public._tracker_voice_register_validated_event(uuid,uuid,uuid,uuid,text,text,text,numeric,text,jsonb,text,text,text,text,text,boolean,text)'::regprocedure,
      'EXECUTE'
    )
    AND has_function_privilege(
      'service_role',
      'public._tracker_voice_register_validated_event(uuid,uuid,uuid,uuid,text,text,text,numeric,text,jsonb,text,text,text,text,text,boolean,text)'::regprocedure,
      'EXECUTE'
    ),
    'Voice service-only registration or RLS regressed after the exact chain'
  );
END;
$$;

SELECT 'TRACKER_VOICE_CURRENT_P0_CHAIN_PASS' AS result;
