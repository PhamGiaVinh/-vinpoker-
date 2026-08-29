-- Marketing module (MKT-6) — Facebook Page channel (manual Page ID + Page Access Token).
-- DEPENDS ON 000002 + 000004. SOURCE-ONLY; applied via the marketing-apply workflow.
--
-- WHY: enable posting to a club's Facebook Page. Mirrors the telegram approach (MKT-5): the club
-- admin pastes their Page ID + a Page Access Token (pages_manage_posts) obtained from their Meta app
-- for a Page they administer. The token is stored ENCRYPTED in Supabase Vault (never returned);
-- routing (page id) lives in club_channel_integrations.target_ref. The marketing-dispatch edge fn
-- reads the token via a service-role RPC and posts via the Graph API.
--
-- Unlike Telegram there is NO global Facebook bot, so a Page token is REQUIRED to enable FB.
-- Reuses the existing club_channel_integrations.bot_token_vault_key column (per-row secret pointer).

-- ===========================================================================================
-- 1. Owner write: set Facebook Page id + Page Access Token (→ Vault).
--    p_page_token: NULL = keep existing · '' = clear (disables FB — can't post without a token) · else store.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_set_facebook(
  p_club_id    uuid,
  p_page_id    text,
  p_page_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text := 'club_' || p_club_id::text || '_mkt_fb_token';
  v_sid  uuid;
  v_key  text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_page_id IS NULL OR length(btrim(p_page_id)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'page_id');
  END IF;

  IF p_page_token IS NULL THEN
    SELECT bot_token_vault_key INTO v_key FROM public.club_channel_integrations
      WHERE club_id = p_club_id AND channel = 'facebook';
  ELSIF length(btrim(p_page_token)) = 0 THEN
    v_key := NULL;  -- cleared → no token → FB disabled below
  ELSE
    SELECT id INTO v_sid FROM vault.secrets WHERE name = v_name;
    IF v_sid IS NULL THEN
      PERFORM vault.create_secret(btrim(p_page_token), v_name, 'marketing facebook page token');
    ELSE
      PERFORM vault.update_secret(v_sid, btrim(p_page_token));
    END IF;
    v_key := v_name;
  END IF;

  INSERT INTO public.club_channel_integrations
    (club_id, channel, enabled, target_ref, bot_token_vault_key, updated_by)
  VALUES (p_club_id, 'facebook', (v_key IS NOT NULL), btrim(p_page_id), v_key, v_uid)
  ON CONFLICT (club_id, channel) DO UPDATE
    SET enabled = (EXCLUDED.bot_token_vault_key IS NOT NULL), target_ref = EXCLUDED.target_ref,
        bot_token_vault_key = EXCLUDED.bot_token_vault_key,
        updated_by = EXCLUDED.updated_by, updated_at = now();

  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'enabled', v_key IS NOT NULL);
END;
$$;

-- ===========================================================================================
-- 2. Owner read for the UI — NEVER returns the token.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_get_facebook_config(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.club_channel_integrations;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_marketer(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  SELECT * INTO v_row FROM public.club_channel_integrations
    WHERE club_id = p_club_id AND channel = 'facebook';
  RETURN jsonb_build_object(
    'status', 'ok',
    'enabled', COALESCE(v_row.enabled, false),
    'page_id', v_row.target_ref,
    'has_token', v_row.bot_token_vault_key IS NOT NULL
  );
END;
$$;

-- ===========================================================================================
-- 3. Service-role ONLY: the dispatcher reads page id + decrypted token here.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_get_facebook_dispatch(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page  text;
  v_key   text;
  v_token text;
BEGIN
  SELECT target_ref, bot_token_vault_key INTO v_page, v_key
  FROM public.club_channel_integrations
  WHERE club_id = p_club_id AND channel = 'facebook' AND enabled;
  IF v_key IS NOT NULL THEN
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = v_key;
  END IF;
  RETURN jsonb_build_object('page_id', v_page, 'page_token', v_token);
END;
$$;

-- ===========================================================================================
-- 4. Tighten channel validation: EVERY channel (telegram/fb/zalo) needs enabled + a target_ref.
--    (CREATE OR REPLACE from 000004; only the non-telegram branch + the list filter change.)
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_schedule_post(
  p_post_id      uuid,
  p_scheduled_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_post public.marketing_posts;
  v_comp jsonb;
  v_when timestamptz := COALESCE(p_scheduled_at, now());
  v_ch   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT * INTO v_post FROM public.marketing_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'POST_NOT_FOUND'); END IF;
  IF NOT (public.is_club_marketer(v_uid, v_post.club_id) OR public.is_club_owner(v_uid, v_post.club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF v_post.status NOT IN ('draft', 'scheduled') THEN
    RETURN jsonb_build_object('error', 'NOT_SCHEDULABLE', 'status', v_post.status);
  END IF;
  IF v_post.channels IS NULL OR jsonb_array_length(v_post.channels) = 0 THEN
    RETURN jsonb_build_object('error', 'NO_CHANNELS');
  END IF;

  v_comp := public.marketing_check_compliance(v_post.club_id, COALESCE(v_post.title, '') || ' ' || v_post.body);
  IF (v_comp->>'status') = 'blocked' THEN
    UPDATE public.marketing_posts
    SET compliance_status = 'blocked', compliance_flags = v_comp->'flags', updated_at = now()
    WHERE id = p_post_id;
    RETURN jsonb_build_object('error', 'COMPLIANCE_BLOCKED', 'flags', v_comp->'flags');
  END IF;

  -- Every requested channel must be enabled with a non-empty target_ref in club_channel_integrations.
  FOR v_ch IN SELECT jsonb_array_elements_text(v_post.channels) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.club_channel_integrations
                   WHERE club_id = v_post.club_id AND channel = v_ch::public.marketing_channel AND enabled
                     AND target_ref IS NOT NULL AND length(btrim(target_ref)) > 0) THEN
      RETURN jsonb_build_object('error', 'CHANNEL_NOT_CONFIGURED', 'channel', v_ch);
    END IF;
  END LOOP;

  UPDATE public.marketing_posts
  SET status = 'scheduled', scheduled_at = v_when, compliance_status = 'clean',
      compliance_flags = '[]'::jsonb, updated_at = now()
  WHERE id = p_post_id;
  RETURN jsonb_build_object('status', 'ok', 'post_id', p_post_id, 'scheduled_at', v_when);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_list_enabled_channels(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_arr jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_marketer(v_uid, p_club_id) OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(channel::text ORDER BY channel::text), '[]'::jsonb) INTO v_arr
  FROM public.club_channel_integrations
  WHERE club_id = p_club_id AND enabled
    AND target_ref IS NOT NULL AND length(btrim(target_ref)) > 0;
  RETURN jsonb_build_object('status', 'ok', 'channels', v_arr);
END;
$$;

-- ===========================================================================================
-- 5. Grants.
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.marketing_set_facebook(uuid, text, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_get_facebook_config(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_get_facebook_dispatch(uuid)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_set_facebook(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_get_facebook_config(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_get_facebook_dispatch(uuid)        TO service_role;

-- ===========================================================================================
-- TEST PLAN (tx + ROLLBACK):
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.marketing_set_facebook('<club>','123456789012345','EAAB...pagetoken');  -- enabled:true
--   SELECT public.marketing_get_facebook_config('<club>');                                -- page_id + has_token:true (NO token)
--   RESET request.jwt.claim.sub; SET ROLE service_role;
--   SELECT public.marketing_get_facebook_dispatch('<club>');                              -- {page_id, page_token:'EAAB...'}
-- ROLLBACK;
--
-- ROLLBACK (undo): restore marketing_schedule_post + marketing_list_enabled_channels from 000004;
--   DROP FUNCTION IF EXISTS public.marketing_get_facebook_dispatch(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_get_facebook_config(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_set_facebook(uuid, text, text);
--   DELETE FROM vault.secrets WHERE name LIKE 'club_%_mkt_fb_token';
-- ===========================================================================================
