\set ON_ERROR_STOP on

-- Exact PostgreSQL implementation from
-- 20270107000001_series_decision_packet_v1.sql. A Vitest contract compares
-- these definitions so the Voice PostgreSQL harness cannot drift back to the
-- former p_payload::text substitute.
CREATE OR REPLACE FUNCTION public._series_canonical_json_v1(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_type text;
  v_text text;
  v_key text;
  v_child jsonb;
  v_result text;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'series_canonical_json_sql_null' USING ERRCODE = '22023';
  END IF;

  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'null' THEN
    RETURN 'null';
  ELSIF v_type = 'boolean' THEN
    v_text := p_value #>> '{}';
    IF v_text NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_boolean' USING ERRCODE = '22023';
    END IF;
    RETURN v_text;
  ELSIF v_type = 'number' THEN
    v_text := p_value #>> '{}';
    IF v_text !~ '^(0|[1-9][0-9]*)$'
      OR v_text::numeric > 9007199254740991::numeric
    THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_safe_integer' USING ERRCODE = '22023';
    END IF;
    RETURN v_text;
  ELSIF v_type = 'string' THEN
    v_text := pg_catalog.btrim(pg_catalog.normalize(p_value #>> '{}', 'NFC'));
    IF v_text ~ E'[\001-\010\013\014\016-\037\177]' THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_control' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.to_json(v_text)::text;
  ELSIF v_type = 'array' THEN
    SELECT '[' || COALESCE(
      pg_catalog.string_agg(public._series_canonical_json_v1(member.value), ',' ORDER BY member.ordinality),
      ''
    ) || ']'
    INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS member(value, ordinality);
    RETURN v_result;
  ELSIF v_type = 'object' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
      WHERE pg_catalog.btrim(pg_catalog.normalize(member.key, 'NFC')) !~ '^[A-Za-z][A-Za-z0-9]*$'
    ) THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_machine_key' USING ERRCODE = '22023';
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
      RAISE EXCEPTION 'series_canonical_json_duplicate_key_after_nfc' USING ERRCODE = '22023';
    END IF;
    SELECT '{' || COALESCE(
      pg_catalog.string_agg(
        pg_catalog.to_json(member.normalized_key)::text
        || ':' || public._series_canonical_json_v1(member.value),
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

  RAISE EXCEPTION 'series_canonical_json_unsupported_value' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public._series_sha256_jsonb_v1(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(public._series_canonical_json_v1(p_payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

REVOKE ALL ON FUNCTION public._series_canonical_json_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_sha256_jsonb_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

SELECT 'TRACKER_VOICE_STRICT_SERIES_CANONICALIZER_READY' AS result;
