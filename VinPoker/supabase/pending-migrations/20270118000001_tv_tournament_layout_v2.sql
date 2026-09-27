-- Source-only follow-up to 20260924065041. The earlier per-club writer is
-- disabled; tournament/event presentation is now the sole published layout.
-- RELEASE ORDER: #1307 gate -> V1 gated writer -> this V2 migration -> V3.
-- V1 remains fail-closed until its club is explicitly allowlisted.
-- ROLLBACK: owner-gated new migration revokes the V2 RPCs and leaves rows as
-- audit history. Do not restore the per-club writer or delete Storage objects.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tv_tournament_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  event_id uuid REFERENCES public.tournament_events(id) ON DELETE RESTRICT,
  brand_name text,
  logo_url text,
  background_url text,
  layout jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tv_tournament_layout_scope_v2 CHECK ((tournament_id IS NULL) <> (event_id IS NULL)),
  CONSTRAINT tv_tournament_layout_valid_v2 CHECK (public.is_valid_tv_layout_config(layout))
);
CREATE UNIQUE INDEX IF NOT EXISTS tv_tournament_layout_one_tournament_v2
  ON public.tv_tournament_layouts(tournament_id) WHERE tournament_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tv_tournament_layout_one_event_v2
  ON public.tv_tournament_layouts(event_id) WHERE event_id IS NOT NULL;
ALTER TABLE public.tv_tournament_layouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tv_tournament_layouts FROM PUBLIC, anon, authenticated;

-- Existing PR's per-club function must not remain a reachable writer.
REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tv_display_state_v2(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_tv_tournament_branding_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'scope_type', CASE WHEN t.event_id IS NULL THEN 'tournament' ELSE 'event' END,
    'revision', coalesce(l.revision, 0),
    'brand_name', CASE WHEN l.id IS NULL THEN coalesce(c.tv_brand_name, c.name) ELSE coalesce(l.brand_name, c.name) END,
    'logo_url', CASE WHEN l.id IS NULL THEN c.tv_logo_url ELSE l.logo_url END,
    'background_url', CASE WHEN l.id IS NULL THEN coalesce(c.tv_bg_url, c.cover_url) ELSE l.background_url END,
    'layout', coalesce(l.layout, jsonb_build_object(
      'brand_x',18,'brand_y',45,'brand_scale',100,'logo_scale',80,
      'background_x',50,'background_y',50,'font','serif','custom_text',''))
  ) INTO v_result
  FROM public.tournaments t
  JOIN public.clubs c ON c.id = t.club_id
  LEFT JOIN public.tv_tournament_layouts l
    ON l.club_id = t.club_id
   AND ((t.event_id IS NOT NULL AND l.event_id = t.event_id)
     OR (t.event_id IS NULL AND l.tournament_id = t.id))
  WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_tv_tournament_branding_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tv_tournament_branding_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_edit_tv_tournament_layout_v1(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = p_tournament_id AND t.deleted_at IS NULL
      AND (public.has_role(auth.uid(), 'super_admin')
        OR public.is_club_owner(auth.uid(), t.club_id)
        OR public.is_club_floor(auth.uid(), t.club_id))
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_tv_tournament_layout_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_edit_tv_tournament_layout_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_tv_tournament_layout_v1(
  p_tournament_id uuid, p_expected_revision bigint,
  p_brand_name text, p_logo_url text, p_bg_url text, p_layout jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tour public.tournaments%ROWTYPE;
  v_existing public.tv_tournament_layouts%ROWTYPE;
  v_result jsonb;
  v_asset_url text;
  v_asset_path text;
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
  -- Every flight/final belonging to the same Main Event locks the same anchor.
  IF v_tour.event_id IS NOT NULL THEN
    PERFORM 1 FROM public.tournament_events WHERE id = v_tour.event_id AND club_id = v_tour.club_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'tv_layout_event_unavailable'; END IF;
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
    OR length(coalesce(p_brand_name,'')) > 40
    OR length(coalesce(p_logo_url,'')) > 2048
    OR length(coalesce(p_bg_url,'')) > 2048
    OR NOT public.is_valid_tv_layout_config(p_layout) THEN
    RAISE EXCEPTION 'tv_layout_invalid';
  END IF;
  FOREACH v_asset_url IN ARRAY ARRAY[p_logo_url, p_bg_url] LOOP
    IF nullif(btrim(coalesce(v_asset_url,'')), '') IS NULL THEN CONTINUE; END IF;
    IF v_asset_url !~ '^https://orlesggcjamwuknxwcpk[.]supabase[.]co/storage/v1/object/public/backing-proofs/[^?#[:space:]]+[.](png|jpg)$' THEN
      RAISE EXCEPTION 'tv_layout_asset_invalid';
    END IF;
    v_asset_path := split_part(v_asset_url, '/storage/v1/object/public/backing-proofs/', 2);
    IF NOT EXISTS (SELECT 1 FROM storage.objects
      WHERE bucket_id = 'backing-proofs' AND name = v_asset_path) THEN
      RAISE EXCEPTION 'tv_layout_asset_missing';
    END IF;
  END LOOP;
  SELECT * INTO v_existing FROM public.tv_tournament_layouts
  WHERE (v_tour.event_id IS NOT NULL AND event_id = v_tour.event_id)
     OR (v_tour.event_id IS NULL AND tournament_id = v_tour.id)
  FOR UPDATE;
  IF coalesce(v_existing.revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'tv_layout_stale_revision' USING ERRCODE = '40001';
  END IF;
  IF v_existing.id IS NULL THEN
    INSERT INTO public.tv_tournament_layouts
      (club_id,tournament_id,event_id,brand_name,logo_url,background_url,layout,updated_by)
    VALUES (v_tour.club_id, CASE WHEN v_tour.event_id IS NULL THEN v_tour.id END,
      v_tour.event_id, nullif(btrim(p_brand_name),''), nullif(btrim(p_logo_url),''),
      nullif(btrim(p_bg_url),''), p_layout, v_actor);
  ELSE
    UPDATE public.tv_tournament_layouts SET
      brand_name = nullif(btrim(p_brand_name),''), logo_url = nullif(btrim(p_logo_url),''),
      background_url = nullif(btrim(p_bg_url),''), layout = p_layout,
      revision = revision + 1, updated_by = v_actor, updated_at = now()
    WHERE id = v_existing.id;
  END IF;
  v_result := public.get_tv_tournament_branding_v1(p_tournament_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tv_display_state_v3(p_display_token text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payload jsonb;
  v_tournament_id uuid;
  v_branding jsonb;
BEGIN
  v_payload := public.get_tv_display_state(p_display_token);
  IF coalesce(v_payload->>'status','') <> 'paired' THEN RETURN v_payload; END IF;
  SELECT assigned_tournament_id INTO v_tournament_id FROM public.tv_displays
  WHERE display_token = p_display_token AND status = 'paired';
  IF v_tournament_id IS NULL THEN RETURN v_payload; END IF;
  v_branding := public.get_tv_tournament_branding_v1(v_tournament_id);
  IF v_branding IS NULL THEN RETURN v_payload; END IF;
  RETURN jsonb_set(v_payload, '{display}', coalesce(v_payload->'display','{}'::jsonb)
    || jsonb_build_object(
      'club_logo_url',v_branding->'logo_url',
      'club_brand_name',v_branding->'brand_name',
      'club_background_url',v_branding->'background_url',
      'club_layout',v_branding->'layout'), true);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tv_display_state_v3(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v3(text) TO anon,authenticated;
COMMIT;
