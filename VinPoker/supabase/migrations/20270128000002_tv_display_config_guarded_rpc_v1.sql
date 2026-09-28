-- TV display management hardening, Stage A (source-only; owner-gated apply).
-- Locks display configuration writes behind one narrow RPC and makes the
-- token reader fail closed when a legacy assignment crosses club boundaries
-- or points at a deleted tournament.
--
-- ROLLBACK: use a separately reviewed forward migration to revoke
-- save_tv_display_config_v1 and restore the prior get_tv_display_state_v3.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_tv_display_config_v1(
  p_display_id uuid,
  p_assigned_tournament_id uuid,
  p_layout text,
  p_announcement text,
  p_name text,
  p_zone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_display public.tv_displays%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'tv_display_unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_display
  FROM public.tv_displays
  WHERE id = p_display_id
  FOR UPDATE;

  IF NOT FOUND OR v_display.club_id IS NULL OR v_display.status <> 'paired' THEN
    RAISE EXCEPTION 'tv_display_unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(v_actor, 'super_admin'::public.app_role)
    OR public.is_club_owner(v_actor, v_display.club_id)
    OR public.is_club_floor(v_actor, v_display.club_id)
  ) THEN
    RAISE EXCEPTION 'tv_display_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_assigned_tournament_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.tournaments t
    WHERE t.id = p_assigned_tournament_id
      AND t.club_id = v_display.club_id
      AND t.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'tv_display_tournament_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_layout IS NULL OR p_layout NOT IN ('clock', 'break_screen', 'announcement', 'payouts', 'multi_board')
     OR length(coalesce(p_announcement, '')) > 500
     OR length(coalesce(p_name, '')) > 80
     OR length(coalesce(p_zone, '')) > 80 THEN
    RAISE EXCEPTION 'tv_display_config_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tv_displays
  SET assigned_tournament_id = p_assigned_tournament_id,
      layout = p_layout,
      announcement = nullif(btrim(p_announcement), ''),
      name = nullif(btrim(p_name), ''),
      zone = nullif(btrim(p_zone), '')
  WHERE id = v_display.id
  RETURNING jsonb_build_object(
    'id', id,
    'club_id', club_id,
    'display_number', display_number,
    'name', name,
    'zone', zone,
    'display_token', display_token,
    'assigned_tournament_id', assigned_tournament_id,
    'layout', layout,
    'announcement', announcement,
    'theme', theme,
    'status', status,
    'last_seen_at', last_seen_at,
    'paired_at', paired_at,
    'created_at', created_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tv_display_state_v3(p_display_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_display public.tv_displays%ROWTYPE;
  v_payload jsonb;
  v_branding jsonb;
BEGIN
  IF p_display_token IS NULL OR length(p_display_token) < 32 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- The shared lock is the reassignment/read barrier: the assignment and its
  -- branding stay one snapshot until this reader finishes.
  SELECT * INTO v_display
  FROM public.tv_displays d
  WHERE d.display_token = p_display_token
  FOR SHARE;

  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_display.status <> 'paired' OR v_display.assigned_tournament_id IS NULL THEN
    RETURN public.get_tv_display_state(p_display_token);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = v_display.assigned_tournament_id
      AND t.club_id = v_display.club_id
      AND t.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  v_payload := public.get_tv_display_state(p_display_token);
  IF coalesce(v_payload->>'status', '') <> 'paired' THEN RETURN v_payload; END IF;
  v_branding := public.get_tv_tournament_branding_v1(v_display.assigned_tournament_id);
  IF v_branding IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;

  RETURN jsonb_set(v_payload, '{display}', coalesce(v_payload->'display', '{}'::jsonb)
    || jsonb_build_object(
      'club_logo_url', v_branding->'logo_url',
      'club_brand_name', v_branding->'brand_name',
      'club_background_url', v_branding->'background_url',
      'club_layout', v_branding->'layout'), true);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tv_display_state_v3(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v3(text) TO anon, authenticated;

-- The canonical fallback matches DEFAULT_TV_BRANDING_LAYOUT and the current
-- serializer. Existing stored layouts are not rewritten.
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
      'brand_x',13,'brand_y',10,'brand_scale',70,'logo_scale',80,
      'background_x',50,'background_y',50,'font','serif','text_blocks','[]'::jsonb))
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
REVOKE ALL ON FUNCTION public.get_tv_tournament_branding_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tv_tournament_branding_v1(uuid) TO authenticated;

COMMIT;
