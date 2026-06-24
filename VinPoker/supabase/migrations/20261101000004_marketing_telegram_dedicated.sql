-- Marketing module (MKT-5) — dedicated marketing Telegram + role-assignment helper.
-- DEPENDS ON 000000..000002. SOURCE-ONLY; applied via the marketing-apply workflow.
--
-- WHY: marketing currently reuses club_settings.telegram_chat_id (the DEALER/FLOOR group, shared by
-- dealer-swing/shift-schedule/webhook). This gives marketing its OWN Telegram destination:
--   - chat id (required) stored in club_channel_integrations(channel='telegram').target_ref
--   - bot token (OPTIONAL) stored ENCRYPTED in Supabase Vault; NULL = use the global TELEGRAM_BOT_TOKEN.
-- Vault precedent: 20260917000000_online_poker_runner_cron_vault.sql.
--
-- WHAT (additive, idempotent):
--   1. club_channel_integrations.bot_token_vault_key (nullable) — Vault secret NAME, never the token.
--   2. marketing_set_telegram(club, chat_id, bot_token?) — owner-gated write; token→Vault.
--   3. marketing_get_telegram_config(club) — owner read for the UI (NEVER returns the token).
--   4. marketing_get_telegram_dispatch(club) — service_role ONLY; returns {chat_id, bot_token}.
--   5. marketing_list_club_members(club) — owner read for the staff role-assignment UI.
--   6. CREATE OR REPLACE marketing_schedule_post + marketing_list_enabled_channels → telegram now
--      validates against club_channel_integrations (NOT club_settings). club_settings is untouched.

-- ===========================================================================================
-- 1. Column: Vault secret-name pointer for the optional per-club marketing bot token.
-- ===========================================================================================
ALTER TABLE public.club_channel_integrations
  ADD COLUMN IF NOT EXISTS bot_token_vault_key text;

-- ===========================================================================================
-- 2. Owner write: set marketing Telegram chat id (+ optional bot token → Vault).
--    p_bot_token: NULL = leave token unchanged · '' = clear (use global bot) · else store in Vault.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_set_telegram(
  p_club_id   uuid,
  p_chat_id   text,
  p_bot_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_name    text := 'club_' || p_club_id::text || '_mkt_tg_token';
  v_sid     uuid;
  v_key     text;  -- the vault key to persist (kept as-is unless changed below)
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_chat_id IS NULL OR length(btrim(p_chat_id)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'chat_id');
  END IF;

  -- Resolve the token action.
  IF p_bot_token IS NULL THEN
    -- keep whatever vault key is already stored
    SELECT bot_token_vault_key INTO v_key FROM public.club_channel_integrations
      WHERE club_id = p_club_id AND channel = 'telegram';
  ELSIF length(btrim(p_bot_token)) = 0 THEN
    -- clear → use the global bot
    v_key := NULL;
  ELSE
    -- store/replace the per-club token in Vault (encrypted at rest); persist only its NAME.
    SELECT id INTO v_sid FROM vault.secrets WHERE name = v_name;
    IF v_sid IS NULL THEN
      PERFORM vault.create_secret(btrim(p_bot_token), v_name, 'marketing telegram bot token');
    ELSE
      PERFORM vault.update_secret(v_sid, btrim(p_bot_token));
    END IF;
    v_key := v_name;
  END IF;

  INSERT INTO public.club_channel_integrations
    (club_id, channel, enabled, target_ref, bot_token_vault_key, updated_by)
  VALUES (p_club_id, 'telegram', true, btrim(p_chat_id), v_key, v_uid)
  ON CONFLICT (club_id, channel) DO UPDATE
    SET enabled = true, target_ref = EXCLUDED.target_ref,
        bot_token_vault_key = EXCLUDED.bot_token_vault_key,
        updated_by = EXCLUDED.updated_by, updated_at = now();

  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'has_custom_token', v_key IS NOT NULL);
END;
$$;

-- ===========================================================================================
-- 3. Owner read for the UI — NEVER returns the token, only whether one is set.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_get_telegram_config(p_club_id uuid)
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
    WHERE club_id = p_club_id AND channel = 'telegram';
  RETURN jsonb_build_object(
    'status', 'ok',
    'enabled', COALESCE(v_row.enabled, false),
    'chat_id', v_row.target_ref,
    'has_custom_token', v_row.bot_token_vault_key IS NOT NULL
  );
END;
$$;

-- ===========================================================================================
-- 4. Service-role ONLY: the dispatcher reads chat id + decrypted token here.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_get_telegram_dispatch(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chat  text;
  v_key   text;
  v_token text;
BEGIN
  SELECT target_ref, bot_token_vault_key INTO v_chat, v_key
  FROM public.club_channel_integrations
  WHERE club_id = p_club_id AND channel = 'telegram' AND enabled;
  IF v_key IS NOT NULL THEN
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = v_key;
  END IF;
  RETURN jsonb_build_object('chat_id', v_chat, 'bot_token', v_token);  -- bot_token NULL → caller uses global env
END;
$$;

-- ===========================================================================================
-- 5. Owner read: candidate accounts for the marketing role-assignment UI (+ who's assigned).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_list_club_members(p_club_id uuid)
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
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  WITH cand AS (
    SELECT cm.player_user_id AS user_id,
           COALESCE(p.display_name, cm.full_name) AS name,
           COALESCE(p.phone, cm.phone) AS phone
    FROM public.club_members cm
    LEFT JOIN public.profiles p ON p.user_id = cm.player_user_id
    WHERE cm.club_id = p_club_id AND cm.player_user_id IS NOT NULL
    UNION
    SELECT m.user_id, p.display_name, p.phone
    FROM public.club_marketers m
    LEFT JOIN public.profiles p ON p.user_id = m.user_id
    WHERE m.club_id = p_club_id
  ),
  dedup AS (
    SELECT DISTINCT ON (user_id) user_id, name, phone FROM cand ORDER BY user_id, name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', d.user_id,
    'name', d.name,
    'phone', d.phone,
    'is_marketer', EXISTS (SELECT 1 FROM public.club_marketers mm
                            WHERE mm.club_id = p_club_id AND mm.user_id = d.user_id)
  ) ORDER BY d.name NULLS LAST), '[]'::jsonb) INTO v_arr
  FROM (SELECT * FROM dedup ORDER BY name NULLS LAST LIMIT 300) d;

  RETURN jsonb_build_object('status', 'ok', 'members', v_arr);
END;
$$;

-- ===========================================================================================
-- 6. Re-point telegram validation away from club_settings → club_channel_integrations.
--    (CREATE OR REPLACE the two RPCs from 20261101000002; bodies identical except the telegram
--     source. club_settings.telegram_chat_id is left entirely to dealer-swing.)
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

  -- Every requested channel must be configured via club_channel_integrations (incl. telegram now).
  FOR v_ch IN SELECT jsonb_array_elements_text(v_post.channels) LOOP
    IF v_ch = 'telegram' THEN
      -- Dedicated marketing Telegram (NOT the dealer group): channel='telegram' enabled with a chat id.
      IF NOT EXISTS (SELECT 1 FROM public.club_channel_integrations
                     WHERE club_id = v_post.club_id AND channel = 'telegram' AND enabled
                       AND target_ref IS NOT NULL AND length(btrim(target_ref)) > 0) THEN
        RETURN jsonb_build_object('error', 'CHANNEL_NOT_CONFIGURED', 'channel', 'telegram');
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.club_channel_integrations
                     WHERE club_id = v_post.club_id AND channel = v_ch::public.marketing_channel AND enabled) THEN
        RETURN jsonb_build_object('error', 'CHANNEL_NOT_CONFIGURED', 'channel', v_ch);
      END IF;
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
  -- All channels (incl. telegram) come from club_channel_integrations now. Telegram additionally
  -- requires a non-empty target_ref (the marketing chat id). club_settings is no longer consulted.
  SELECT COALESCE(jsonb_agg(channel::text ORDER BY channel::text), '[]'::jsonb) INTO v_arr
  FROM public.club_channel_integrations
  WHERE club_id = p_club_id AND enabled
    AND (channel <> 'telegram' OR (target_ref IS NOT NULL AND length(btrim(target_ref)) > 0));
  RETURN jsonb_build_object('status', 'ok', 'channels', v_arr);
END;
$$;

-- ===========================================================================================
-- 7. Grants.
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.marketing_set_telegram(uuid, text, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_get_telegram_config(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_get_telegram_dispatch(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_list_club_members(uuid)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_set_telegram(uuid, text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_get_telegram_config(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_get_telegram_dispatch(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_list_club_members(uuid)         TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (run in a tx + ROLLBACK):
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.marketing_set_telegram('<club>','-1009999999999', NULL);   -- ok, no token → global bot
--   SELECT public.marketing_get_telegram_config('<club>');                   -- {enabled:true, chat_id:-100..., has_custom_token:false}
--   SELECT public.marketing_set_telegram('<club>','-1009999999999','123:ABC');-- store token in Vault
--   SELECT public.marketing_get_telegram_config('<club>');                   -- has_custom_token:true (token NEVER returned)
--   RESET request.jwt.claim.sub; SET ROLE service_role;
--   SELECT public.marketing_get_telegram_dispatch('<club>');                 -- {chat_id, bot_token:'123:ABC'}
--   RESET ROLE;
-- ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   CREATE OR REPLACE ... restore marketing_schedule_post + marketing_list_enabled_channels from 20261101000002.
--   DROP FUNCTION IF EXISTS public.marketing_list_club_members(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_get_telegram_dispatch(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_get_telegram_config(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_set_telegram(uuid, text, text);
--   ALTER TABLE public.club_channel_integrations DROP COLUMN IF EXISTS bot_token_vault_key;
--   DELETE FROM vault.secrets WHERE name LIKE 'club_%_mkt_tg_token';
-- ===========================================================================================
