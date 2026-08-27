-- Source-only forward migration. Apply only after a separately approved controlled rollout.
BEGIN;

DO $migration$
DECLARE
  v_signature REGPROCEDURE := 'public._tracker_voice_register_validated_event(uuid,uuid,uuid,uuid,text,text,text,numeric,text,jsonb,text,text,text,text,text,boolean,text)'::REGPROCEDURE;
  v_current_definition TEXT;
  v_rewritten_definition TEXT;
  v_old_provider_guard TEXT := $old$
    IF p_provider_name = 'gemini_live'
     AND v_config.provider_model <> 'gemini-3.1-flash-live-preview' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
  IF p_provider_name = 'openai_realtime'
     AND v_config.provider_model = 'gemini-3.1-flash-live-preview' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
$old$;
  v_new_provider_guard TEXT := $new$
  -- Config chooses the provider. A browser/Edge caller may not substitute a model.
  IF v_config.provider_model IN ('gemini-3.1-flash-live-preview', 'gemini-3.5-transcribe-live') THEN
    IF p_provider_name <> 'gemini_live'
       OR p_provider_model <> v_config.provider_model THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
    END IF;
  ELSIF p_provider_name <> 'openai_realtime'
     OR p_provider_model <> v_config.provider_model THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_current_definition;
  IF v_current_definition IS NULL
     OR position('edge_service_role_required' IN v_current_definition) = 0
     OR position(v_old_provider_guard IN v_current_definition) = 0 THEN
    RAISE EXCEPTION 'tracker_voice_provider_binding_precondition_failed';
  END IF;

  v_rewritten_definition := replace(v_current_definition, v_old_provider_guard, v_new_provider_guard);
  IF v_rewritten_definition = v_current_definition
     OR position('gemini-3.5-transcribe-live' IN v_rewritten_definition) = 0
     OR position('p_provider_model <> v_config.provider_model' IN v_rewritten_definition) = 0 THEN
    RAISE EXCEPTION 'tracker_voice_provider_binding_rewrite_failed';
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
