-- TV layout editor v1 (source-only; owner-gated apply).
--
-- Adds a constrained per-club presentation document and two narrow RPCs:
--   * save_tv_branding_layout_v1: authenticated TV operators save all branding atomically.
--   * get_tv_display_state_v2: paired TVs receive the same branding as direct TV links.
--
-- ROLLBACK (only through a separately reviewed migration): drop the two RPCs,
-- drop clubs.tv_layout_config, then drop is_valid_tv_layout_config(jsonb).

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS tv_logo_url text,
  ADD COLUMN IF NOT EXISTS tv_brand_name text,
  ADD COLUMN IF NOT EXISTS tv_bg_url text;

-- RLS restrictive policy narrows the existing owner-write policy only for
-- versioned TV branding assets. Other buckets and backing-proofs paths retain
-- their existing Storage policy behavior. The path has no club id, so require
-- the authenticated path owner to control at least one enabled allowlisted
-- club; the TV publish RPC separately binds the asset to its tournament club.
CREATE OR REPLACE FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(
  p_bucket_id text,
  p_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_bucket_id IS DISTINCT FROM 'backing-proofs'
      OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/tv/branding-(logo|background)/v1/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg)$'
      THEN true
    ELSE coalesce(
      (SELECT auth.uid()) IS NOT NULL
      AND (storage.foldername(p_name))[1] = (SELECT auth.uid())::text
      AND EXISTS (
        SELECT 1
        FROM public.centerpoint_tournament_ops_release AS r
        CROSS JOIN LATERAL unnest(r.allowed_club_ids) AS allowlisted(club_id)
        WHERE r.id
          AND centerpoint_private.tournament_ops_release_allowed_v1(allowlisted.club_id)
          AND (
            public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
            OR public.is_club_dealer_control((SELECT auth.uid()), allowlisted.club_id)
          )
      ),
      false
    )
  END;
$$;
ALTER FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)
  OWNER TO postgres;
GRANT USAGE ON SCHEMA centerpoint_private TO authenticated;
REVOKE ALL ON FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)
  TO authenticated;

DROP POLICY IF EXISTS "TV branding v1 release gate on insert" ON storage.objects;
CREATE POLICY "TV branding v1 release gate on insert"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    centerpoint_private.tv_branding_storage_insert_allowed_v1(bucket_id, name)
  );

CREATE OR REPLACE FUNCTION public.is_valid_tv_layout_config(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_allowed_keys constant text[] := ARRAY[
    'brand_x', 'brand_y', 'brand_scale', 'logo_scale',
    'background_x', 'background_y', 'font', 'custom_text'
  ];
  v_key text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN false;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_value)
  LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN false;
    END IF;
  END LOOP;

  IF jsonb_typeof(p_value->'brand_x') <> 'number'
     OR (p_value->>'brand_x')::numeric NOT BETWEEN 8 AND 92
     OR jsonb_typeof(p_value->'brand_y') <> 'number'
     OR (p_value->>'brand_y')::numeric NOT BETWEEN 15 AND 85
     OR jsonb_typeof(p_value->'brand_scale') <> 'number'
     OR (p_value->>'brand_scale')::numeric NOT BETWEEN 70 AND 140
     OR jsonb_typeof(p_value->'logo_scale') <> 'number'
     OR (p_value->>'logo_scale')::numeric NOT BETWEEN 60 AND 150
     OR jsonb_typeof(p_value->'background_x') <> 'number'
     OR (p_value->>'background_x')::numeric NOT BETWEEN 0 AND 100
     OR jsonb_typeof(p_value->'background_y') <> 'number'
     OR (p_value->>'background_y')::numeric NOT BETWEEN 0 AND 100
     OR jsonb_typeof(p_value->'font') <> 'string'
     OR NOT (p_value->>'font' = ANY(ARRAY['display', 'sans', 'serif', 'mono']))
     OR jsonb_typeof(p_value->'custom_text') <> 'string'
     OR length(p_value->>'custom_text') > 80 THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_tv_layout_config(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_tv_layout_config(jsonb) TO authenticated, service_role;

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS tv_layout_config jsonb NOT NULL DEFAULT jsonb_build_object(
    'brand_x', 18,
    'brand_y', 45,
    'brand_scale', 100,
    'logo_scale', 80,
    'background_x', 50,
    'background_y', 50,
    'font', 'serif',
    'custom_text', ''
  );

ALTER TABLE public.clubs
  DROP CONSTRAINT IF EXISTS clubs_tv_layout_config_valid;

ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_tv_layout_config_valid
  CHECK (public.is_valid_tv_layout_config(tv_layout_config));

CREATE OR REPLACE FUNCTION public.save_tv_branding_layout_v1(
  p_club_id uuid,
  p_brand_name text,
  p_logo_url text,
  p_bg_url text,
  p_layout jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'tv_branding_unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_club_id IS NULL OR NOT (
    public.has_role(v_actor, 'super_admin')
    OR public.is_club_dealer_control(v_actor, p_club_id)
  ) THEN
    RAISE EXCEPTION 'tv_branding_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(p_club_id);

  IF length(coalesce(p_brand_name, '')) > 40
     OR length(coalesce(p_logo_url, '')) > 2048
     OR length(coalesce(p_bg_url, '')) > 2048
     OR NOT public.is_valid_tv_layout_config(p_layout) THEN
    RAISE EXCEPTION 'tv_branding_invalid';
  END IF;

  UPDATE public.clubs
  SET tv_brand_name = nullif(btrim(p_brand_name), ''),
      tv_logo_url = nullif(btrim(p_logo_url), ''),
      tv_bg_url = nullif(btrim(p_bg_url), ''),
      tv_layout_config = p_layout
  WHERE id = p_club_id
  RETURNING jsonb_build_object(
    'club_id', id,
    'brand_name', tv_brand_name,
    'logo_url', tv_logo_url,
    'background_url', tv_bg_url,
    'layout', tv_layout_config
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'tv_branding_club_not_found';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1(uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_tv_branding_layout_v1(uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tv_display_state_v2(p_display_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload jsonb;
  v_branding jsonb;
BEGIN
  v_payload := public.get_tv_display_state(p_display_token);

  IF coalesce(v_payload->>'status', '') <> 'paired' THEN
    RETURN v_payload;
  END IF;

  SELECT jsonb_build_object(
    'club_logo_url', c.tv_logo_url,
    'club_brand_name', c.tv_brand_name,
    'club_background_url', coalesce(c.tv_bg_url, c.cover_url),
    'club_layout', c.tv_layout_config
  )
  INTO v_branding
  FROM public.tv_displays d
  JOIN public.clubs c ON c.id = d.club_id
  WHERE d.display_token = p_display_token
    AND d.status = 'paired';

  IF v_branding IS NULL THEN
    RETURN v_payload;
  END IF;

  RETURN jsonb_set(
    v_payload,
    '{display}',
    coalesce(v_payload->'display', '{}'::jsonb) || v_branding,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tv_display_state_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v2(text) TO anon, authenticated;
