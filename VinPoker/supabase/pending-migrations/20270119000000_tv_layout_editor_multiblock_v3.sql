-- TV layout v3: bounded independent text blocks, immutable published revisions,
-- and versioned TV assets. Source-only until the controlled DB apply gate.
-- Depends on Centerpoint gate #1307 and TV V1/V2; release order is #1307 -> V1 -> V2 -> V3.
--
-- ROLLBACK: use a separately reviewed forward migration to revoke the v3 writer
-- and remove its Storage policies/trigger. Keep layout version rows and Storage
-- objects; never delete published snapshots or assets as part of rollback.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_valid_tv_layout_config(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_allowed_keys constant text[] := ARRAY[
    'brand_x', 'brand_y', 'brand_scale', 'logo_scale',
    'background_x', 'background_y', 'font', 'custom_text', 'text_blocks'
  ];
  v_block_allowed_keys constant text[] := ARRAY[
    'id', 'text', 'x', 'y', 'width', 'height', 'font', 'size', 'style'
  ];
  v_key text;
  v_block jsonb;
  v_prior jsonb;
  v_index bigint;
  v_x numeric;
  v_y numeric;
  v_width numeric;
  v_height numeric;
  v_left numeric;
  v_top numeric;
  v_right numeric;
  v_bottom numeric;
  v_brand_left numeric;
  v_brand_top numeric;
  v_brand_right numeric;
  v_brand_bottom numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_value)
  LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN RETURN false; END IF;
  END LOOP;

  IF jsonb_typeof(p_value->'brand_x') IS DISTINCT FROM 'number'
     OR (p_value->>'brand_x')::numeric NOT BETWEEN 8 AND 92
     OR jsonb_typeof(p_value->'brand_y') IS DISTINCT FROM 'number'
     OR (p_value->>'brand_y')::numeric NOT BETWEEN 4 AND 96
     OR jsonb_typeof(p_value->'brand_scale') IS DISTINCT FROM 'number'
     OR (p_value->>'brand_scale')::numeric NOT BETWEEN 70 AND 140
     OR jsonb_typeof(p_value->'logo_scale') IS DISTINCT FROM 'number'
     OR (p_value->>'logo_scale')::numeric NOT BETWEEN 60 AND 150
     OR jsonb_typeof(p_value->'background_x') IS DISTINCT FROM 'number'
     OR (p_value->>'background_x')::numeric NOT BETWEEN 0 AND 100
     OR jsonb_typeof(p_value->'background_y') IS DISTINCT FROM 'number'
     OR (p_value->>'background_y')::numeric NOT BETWEEN 0 AND 100
     OR jsonb_typeof(p_value->'font') IS DISTINCT FROM 'string'
     OR NOT (p_value->>'font' = ANY(ARRAY['display', 'sans', 'serif', 'mono'])) THEN
    RETURN false;
  END IF;

  -- V1 stored a single custom_text string. Keep accepting that exact shape so
  -- old rows remain readable; new serialized documents use text_blocks only.
  IF NOT (p_value ? 'text_blocks') THEN
    IF jsonb_typeof(p_value->'custom_text') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    RETURN length(p_value->>'custom_text') <= 80;
  END IF;
  IF p_value ? 'custom_text' AND nullif(p_value->>'custom_text', '') IS NOT NULL THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_value->'text_blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_value->'text_blocks') > 6 THEN
    RETURN false;
  END IF;

  -- Match the renderer's logo box: width 20%; its 12% height can be exceeded by
  -- the independently scaled square logo (9.6% * logo_scale), then brand_scale.
  v_brand_left := (p_value->>'brand_x')::numeric - 10 * (p_value->>'brand_scale')::numeric / 100;
  v_brand_right := (p_value->>'brand_x')::numeric + 10 * (p_value->>'brand_scale')::numeric / 100;
  v_brand_top := (p_value->>'brand_y')::numeric - greatest(12, 9.6 * (p_value->>'logo_scale')::numeric / 100) * (p_value->>'brand_scale')::numeric / 200;
  v_brand_bottom := (p_value->>'brand_y')::numeric + greatest(12, 9.6 * (p_value->>'logo_scale')::numeric / 100) * (p_value->>'brand_scale')::numeric / 200;
  IF v_brand_left < 4 OR v_brand_top < 4 OR v_brand_right > 96 OR v_brand_bottom > 96
     OR (v_brand_left < 71 AND v_brand_right > 29 AND v_brand_top < 76 AND v_brand_bottom > 24)
     OR (v_brand_left < 34 AND v_brand_right > 3 AND v_brand_top < 84 AND v_brand_bottom > 16)
     OR (v_brand_left < 97 AND v_brand_right > 66 AND v_brand_top < 84 AND v_brand_bottom > 16) THEN
    RETURN false;
  END IF;

  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_value->'text_blocks'))
       <> jsonb_array_length(p_value->'text_blocks') THEN
    RETURN false;
  END IF;

  FOR v_block, v_index IN
    SELECT value, ordinality FROM jsonb_array_elements(p_value->'text_blocks') WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_block) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_block)
    LOOP
      IF NOT (v_key = ANY(v_block_allowed_keys)) THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_typeof(v_block->'id') IS DISTINCT FROM 'string'
       OR (v_block->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR jsonb_typeof(v_block->'text') IS DISTINCT FROM 'string'
       OR length(btrim(v_block->>'text')) = 0 OR length(v_block->>'text') > 100
       OR jsonb_typeof(v_block->'x') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_block->'y') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_block->'width') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_block->'height') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_block->'size') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_block->'font') IS DISTINCT FROM 'string'
       OR NOT (v_block->>'font' = ANY(ARRAY['display', 'sans', 'serif', 'mono']))
       OR jsonb_typeof(v_block->'style') IS DISTINCT FROM 'string'
       OR NOT (v_block->>'style' = ANY(ARRAY['plain', 'outline', 'label'])) THEN
      RETURN false;
    END IF;

    v_x := (v_block->>'x')::numeric;
    v_y := (v_block->>'y')::numeric;
    v_width := (v_block->>'width')::numeric;
    v_height := (v_block->>'height')::numeric;
    IF v_x NOT BETWEEN 4 AND 96 OR v_y NOT BETWEEN 4 AND 96
       OR v_width NOT BETWEEN 8 AND 40 OR v_height NOT BETWEEN 4 AND 12
       OR (v_block->>'size')::numeric NOT BETWEEN 12 AND 42 THEN
      RETURN false;
    END IF;

    -- Positions are centers; validate the complete rendered box, not its anchor.
    v_left := v_x - v_width / 2;
    v_right := v_x + v_width / 2;
    v_top := v_y - v_height / 2;
    v_bottom := v_y + v_height / 2;
    IF v_left < 4 OR v_top < 4 OR v_right > 96 OR v_bottom > 96
       OR (v_left < 71 AND v_right > 29 AND v_top < 76 AND v_bottom > 24)
       OR (v_left < 34 AND v_right > 3 AND v_top < 84 AND v_bottom > 16)
       OR (v_left < 97 AND v_right > 66 AND v_top < 84 AND v_bottom > 16)
       OR (v_left < v_brand_right AND v_right > v_brand_left
           AND v_top < v_brand_bottom AND v_bottom > v_brand_top) THEN
      RETURN false;
    END IF;

    FOR v_prior IN
      SELECT value FROM jsonb_array_elements(p_value->'text_blocks') WITH ORDINALITY AS prior(value, ordinal)
      WHERE ordinal < v_index
    LOOP
      IF v_left < (v_prior->>'x')::numeric + (v_prior->>'width')::numeric / 2
         AND v_right > (v_prior->>'x')::numeric - (v_prior->>'width')::numeric / 2
         AND v_top < (v_prior->>'y')::numeric + (v_prior->>'height')::numeric / 2
         AND v_bottom > (v_prior->>'y')::numeric - (v_prior->>'height')::numeric / 2 THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

ALTER TABLE public.tv_tournament_layouts
  DROP CONSTRAINT IF EXISTS tv_tournament_layout_valid_v2;
ALTER TABLE public.tv_tournament_layouts
  ADD CONSTRAINT tv_tournament_layout_valid_v3
  CHECK (public.is_valid_tv_layout_config(layout));

CREATE TABLE IF NOT EXISTS public.tv_tournament_layout_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id uuid NOT NULL REFERENCES public.tv_tournament_layouts(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  brand_name text,
  logo_url text,
  background_url text,
  layout jsonb NOT NULL CHECK (public.is_valid_tv_layout_config(layout)),
  published_by uuid NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tv_tournament_layout_versions_revision_unique UNIQUE (layout_id, revision)
);
ALTER TABLE public.tv_tournament_layout_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tv_tournament_layout_versions FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the currently published snapshot when this migration is promoted.
INSERT INTO public.tv_tournament_layout_versions
  (layout_id, revision, brand_name, logo_url, background_url, layout, published_by, published_at)
SELECT id, revision, brand_name, logo_url, background_url, layout, updated_by, updated_at
FROM public.tv_tournament_layouts
ON CONFLICT (layout_id, revision) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reject_tv_layout_version_mutation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'tv_layout_version_immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_tv_layout_version_mutation_v1() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tv_tournament_layout_versions_immutable ON public.tv_tournament_layout_versions;
CREATE TRIGGER tv_tournament_layout_versions_immutable
  BEFORE UPDATE OR DELETE ON public.tv_tournament_layout_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_tv_layout_version_mutation_v1();

-- New v1 uploads are immutable even before publishing. Also protect legacy
-- objects for as long as any published head or immutable version references them.
CREATE OR REPLACE FUNCTION private.is_tv_branding_asset_immutable_v1(p_bucket_id text, p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(p_bucket_id = 'backing-proofs' AND (
    p_name ~ '^[0-9a-f-]{36}/tv/branding-(logo|background)/v1/[0-9a-f-]{36}[.](png|jpg)$'
    OR EXISTS (
      SELECT 1 FROM public.tv_tournament_layouts l
      WHERE l.logo_url = 'https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/' || p_name
         OR l.background_url = 'https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/' || p_name
    )
    OR EXISTS (
      SELECT 1 FROM public.tv_tournament_layout_versions v
      WHERE v.logo_url = 'https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/' || p_name
         OR v.background_url = 'https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/' || p_name
    )
  ), false);
$$;
ALTER FUNCTION private.is_tv_branding_asset_immutable_v1(text,text) OWNER TO postgres;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON FUNCTION private.is_tv_branding_asset_immutable_v1(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_tv_branding_asset_immutable_v1(text,text) TO authenticated;

DROP POLICY IF EXISTS "TV branding v3 assets immutable on update" ON storage.objects;
CREATE POLICY "TV branding v3 assets immutable on update"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT private.is_tv_branding_asset_immutable_v1(bucket_id, name))
  WITH CHECK (NOT private.is_tv_branding_asset_immutable_v1(bucket_id, name));
DROP POLICY IF EXISTS "TV branding v3 assets immutable on delete" ON storage.objects;
CREATE POLICY "TV branding v3 assets immutable on delete"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT private.is_tv_branding_asset_immutable_v1(bucket_id, name));

CREATE OR REPLACE FUNCTION public.save_tv_tournament_layout_v1(
  p_tournament_id uuid, p_expected_revision bigint,
  p_brand_name text, p_logo_url text, p_bg_url text, p_layout jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tour public.tournaments%ROWTYPE;
  v_existing public.tv_tournament_layouts%ROWTYPE;
  v_result jsonb;
  v_asset_path text;
  v_club_logo_url text;
  v_club_background_url text;
  v_current_logo_url text;
  v_current_background_url text;
BEGIN
  SELECT * INTO v_tour FROM public.tournaments
  WHERE id = p_tournament_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL THEN
    RAISE EXCEPTION 'tv_layout_tournament_unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_actor, 'super_admin')
    OR public.is_club_owner(v_actor, v_tour.club_id)
    OR public.is_club_floor(v_actor, v_tour.club_id)) THEN
    RAISE EXCEPTION 'tv_layout_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_tour.club_id);
  -- Event lock keeps all Main Event flights on the same published layout.
  IF v_tour.event_id IS NOT NULL THEN
    PERFORM 1 FROM public.tournament_events WHERE id = v_tour.event_id AND club_id = v_tour.club_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'tv_layout_event_unavailable'; END IF;
  END IF;
  SELECT c.tv_logo_url, coalesce(c.tv_bg_url, c.cover_url)
  INTO v_club_logo_url, v_club_background_url
  FROM public.clubs c WHERE c.id = v_tour.club_id;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
    OR length(coalesce(p_brand_name,'')) > 40
    OR length(coalesce(p_logo_url,'')) > 2048
    OR length(coalesce(p_bg_url,'')) > 2048
    OR NOT public.is_valid_tv_layout_config(p_layout) THEN
    RAISE EXCEPTION 'tv_layout_invalid';
  END IF;

  SELECT * INTO v_existing FROM public.tv_tournament_layouts
  WHERE (v_tour.event_id IS NOT NULL AND event_id = v_tour.event_id)
     OR (v_tour.event_id IS NULL AND tournament_id = v_tour.id)
  FOR UPDATE;
  IF coalesce(v_existing.revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'tv_layout_stale_revision' USING ERRCODE = '40001';
  END IF;
  v_current_logo_url := CASE WHEN v_existing.id IS NULL THEN v_club_logo_url ELSE v_existing.logo_url END;
  v_current_background_url := CASE WHEN v_existing.id IS NULL THEN v_club_background_url ELSE v_existing.background_url END;

  IF nullif(btrim(coalesce(p_logo_url,'')), '') IS NOT NULL THEN
    IF p_logo_url !~ '^https://orlesggcjamwuknxwcpk[.]supabase[.]co/storage/v1/object/public/backing-proofs/[0-9a-f-]{36}/tv/branding-logo/v1/[0-9a-f-]{36}[.](png|jpg)$'
       AND NOT coalesce(p_logo_url = v_current_logo_url
         AND p_logo_url ~ '^https://orlesggcjamwuknxwcpk[.]supabase[.]co/storage/v1/object/public/backing-proofs/[^?#[:space:]]+[.](png|jpg)$', false) THEN
      RAISE EXCEPTION 'tv_layout_asset_invalid';
    END IF;
    v_asset_path := split_part(p_logo_url, '/storage/v1/object/public/backing-proofs/', 2);
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'backing-proofs' AND name = v_asset_path) THEN
      RAISE EXCEPTION 'tv_layout_asset_missing';
    END IF;
  END IF;
  IF nullif(btrim(coalesce(p_bg_url,'')), '') IS NOT NULL THEN
    IF p_bg_url !~ '^https://orlesggcjamwuknxwcpk[.]supabase[.]co/storage/v1/object/public/backing-proofs/[0-9a-f-]{36}/tv/branding-background/v1/[0-9a-f-]{36}[.](png|jpg)$'
       AND NOT coalesce(p_bg_url = v_current_background_url
         AND p_bg_url ~ '^https://orlesggcjamwuknxwcpk[.]supabase[.]co/storage/v1/object/public/backing-proofs/[^?#[:space:]]+[.](png|jpg)$', false) THEN
      RAISE EXCEPTION 'tv_layout_asset_invalid';
    END IF;
    v_asset_path := split_part(p_bg_url, '/storage/v1/object/public/backing-proofs/', 2);
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'backing-proofs' AND name = v_asset_path) THEN
      RAISE EXCEPTION 'tv_layout_asset_missing';
    END IF;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.tv_tournament_layouts
      (club_id,tournament_id,event_id,brand_name,logo_url,background_url,layout,updated_by)
    VALUES (v_tour.club_id, CASE WHEN v_tour.event_id IS NULL THEN v_tour.id END,
      v_tour.event_id, nullif(btrim(p_brand_name),''), nullif(btrim(p_logo_url),''),
      nullif(btrim(p_bg_url),''), p_layout, v_actor)
    RETURNING * INTO v_existing;
  ELSE
    UPDATE public.tv_tournament_layouts SET
      brand_name = nullif(btrim(p_brand_name),''), logo_url = nullif(btrim(p_logo_url),''),
      background_url = nullif(btrim(p_bg_url),''), layout = p_layout,
      revision = revision + 1, updated_by = v_actor, updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;
  END IF;

  INSERT INTO public.tv_tournament_layout_versions
    (layout_id,revision,brand_name,logo_url,background_url,layout,published_by,published_at)
  VALUES (v_existing.id,v_existing.revision,v_existing.brand_name,v_existing.logo_url,
    v_existing.background_url,v_existing.layout,v_actor,v_existing.updated_at);
  v_result := public.get_tv_tournament_branding_v1(p_tournament_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb) TO authenticated;

COMMIT;
