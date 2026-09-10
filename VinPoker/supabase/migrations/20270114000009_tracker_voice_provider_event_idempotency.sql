-- Fail closed on a replayed provider event before attempting a second immutable insert.
-- Rollback: restore the prior function body from the reviewed 13000007 chain.
BEGIN;

DO $migration$
DECLARE
  v_signature REGPROCEDURE := 'public._tracker_voice_register_validated_event(uuid,uuid,uuid,uuid,text,text,text,numeric,text,jsonb,text,text,text,text,text,boolean,text)'::REGPROCEDURE;
  v_current_definition TEXT;
  v_rewritten_definition TEXT;
  v_old_lookup_pattern TEXT := $pattern$SELECT\s+e\.\*\s+INTO\s+v_existing\s+FROM\s+public\.tracker_voice_events\s+e\s+WHERE\s+e\.actor_user_id\s*=\s*v_actor\s+AND\s+e\.idempotency_key\s*=\s*p_idempotency_key\s+AND\s+e\.event_kind\s*=\s*'final_transcript';\s+IF\s+FOUND\s+THEN\s+IF\s+v_existing\.request_hash\s*<>\s*v_request_hash\s+THEN\s+RETURN\s+jsonb_build_object\('ok',\s*false,\s*'error',\s*'idempotency_mismatch'\);\s+END\s+IF;\s+RETURN\s+v_existing\.receipt\s*\|\|\s*jsonb_build_object\('duplicate',\s*true\);\s+END\s+IF;\s+PERFORM\s+public\.tracker_unified_ops_lock_tournament\(p_tournament_id\);$pattern$;
  v_new_lookup TEXT := $new$
  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript';
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  -- Gemini may deliver the same final more than once. The provider event identity
  -- is immutable even when the browser has lost its original idempotency key.
  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.provider_name = p_provider_name
    AND e.provider_event_id = NULLIF(p_provider_event_id, '')
    AND e.event_kind = 'final_transcript';
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_event_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

  -- Repeat after the tournament lock so concurrent callbacks for this hand
  -- converge on the first immutable receipt.
  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.provider_name = p_provider_name
    AND e.provider_event_id = NULLIF(p_provider_event_id, '')
    AND e.event_kind = 'final_transcript'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'provider_event_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_current_definition;
  IF v_current_definition IS NULL
     OR position('gemini-3.5-transcribe-live' IN v_current_definition) = 0
     OR (SELECT count(*) FROM regexp_matches(v_current_definition, v_old_lookup_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tracker_voice_provider_event_idempotency_precondition_failed';
  END IF;

  v_rewritten_definition := regexp_replace(v_current_definition, v_old_lookup_pattern, v_new_lookup);
  IF v_rewritten_definition = v_current_definition
     OR position('provider_event_mismatch' IN v_rewritten_definition) = 0 THEN
    RAISE EXCEPTION 'tracker_voice_provider_event_idempotency_rewrite_failed';
  END IF;
  EXECUTE v_rewritten_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public._tracker_voice_register_validated_event(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tracker_voice_register_validated_event(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO service_role;

COMMIT;
