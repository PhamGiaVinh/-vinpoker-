-- Tracker Voice uses an existing snake_case wire/storage contract. Keep the
-- stricter Series and generic Unified Ops hash contracts unchanged, and
-- isolate the wider-but-still-bounded machine-key grammar to Voice only.
BEGIN;

DO $migration_precondition$
BEGIN
  IF pg_catalog.to_regprocedure('public._tracker_voice_request_hash(jsonb)') IS NULL
    OR pg_catalog.to_regprocedure('public._series_canonical_json_v1(jsonb)') IS NULL
    OR pg_catalog.to_regprocedure('public._series_sha256_jsonb_v1(jsonb)') IS NULL
    OR pg_catalog.to_regprocedure('public._tracker_unified_ops_request_hash_v2(jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'tracker_voice_hash_v2_dependency_missing'
      USING ERRCODE = '55000';
  END IF;
END;
$migration_precondition$;

CREATE OR REPLACE FUNCTION public._tracker_voice_canonical_json_v2(p_value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_type TEXT;
  v_text TEXT;
  v_result TEXT;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'tracker_voice_canonical_json_sql_null' USING ERRCODE = '22023';
  END IF;

  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'null' THEN
    RETURN 'null';
  ELSIF v_type = 'boolean' THEN
    v_text := p_value #>> '{}';
    IF v_text NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'tracker_voice_canonical_json_invalid_boolean' USING ERRCODE = '22023';
    END IF;
    RETURN v_text;
  ELSIF v_type = 'number' THEN
    v_text := p_value #>> '{}';
    IF v_text !~ '^(0|[1-9][0-9]*)$'
      OR v_text::NUMERIC > 9007199254740991::NUMERIC
    THEN
      RAISE EXCEPTION 'tracker_voice_canonical_json_invalid_safe_integer' USING ERRCODE = '22023';
    END IF;
    RETURN v_text;
  ELSIF v_type = 'string' THEN
    v_text := pg_catalog.btrim(pg_catalog.normalize(p_value #>> '{}', 'NFC'));
    IF v_text ~ E'[\001-\010\013\014\016-\037\177]' THEN
      RAISE EXCEPTION 'tracker_voice_canonical_json_invalid_control' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.to_json(v_text)::TEXT;
  ELSIF v_type = 'array' THEN
    SELECT '[' || COALESCE(
      pg_catalog.string_agg(
        public._tracker_voice_canonical_json_v2(member.value),
        ',' ORDER BY member.ordinality
      ),
      ''
    ) || ']'
    INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value)
      WITH ORDINALITY AS member(value, ordinality);
    RETURN v_result;
  ELSIF v_type = 'object' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
      WHERE pg_catalog.btrim(pg_catalog.normalize(member.key, 'NFC'))
        !~ '^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$'
    ) THEN
      RAISE EXCEPTION 'tracker_voice_canonical_json_invalid_machine_key' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT pg_catalog.btrim(pg_catalog.normalize(member.key, 'NFC')) AS normalized_key
        FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
      ) AS normalized
      GROUP BY normalized.normalized_key
      HAVING pg_catalog.count(*) > 1
    ) THEN
      RAISE EXCEPTION 'tracker_voice_canonical_json_duplicate_key_after_nfc' USING ERRCODE = '22023';
    END IF;
    SELECT '{' || COALESCE(
      pg_catalog.string_agg(
        pg_catalog.to_json(member.normalized_key)::TEXT
        || ':' || public._tracker_voice_canonical_json_v2(member.value),
        ',' ORDER BY member.normalized_key COLLATE "C"
      ),
      ''
    ) || '}'
    INTO v_result
    FROM (
      SELECT
        pg_catalog.btrim(pg_catalog.normalize(source.key, 'NFC')) AS normalized_key,
        source.value
      FROM pg_catalog.jsonb_each(p_value) AS source(key, value)
    ) AS member;
    RETURN v_result;
  END IF;

  RAISE EXCEPTION 'tracker_voice_canonical_json_unsupported_value' USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public._tracker_voice_sha256_jsonb_v2(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(public._tracker_voice_canonical_json_v2(p_payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$function$;

CREATE OR REPLACE FUNCTION public._tracker_voice_request_hash(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT public._tracker_voice_sha256_jsonb_v2(
    COALESCE(p_payload, '{}'::JSONB)
  )
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_canonical_json_v2(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._tracker_voice_sha256_jsonb_v2(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._tracker_voice_request_hash(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
