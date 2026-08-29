-- Marketing module (MKT-2) — core schema + SAFE write RPCs. DEPENDS ON 000000 + 000001.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 000000 → 000001 → THIS in a
-- controlled session (Management API / `supabase db query --linked --file`, NOT `db push` / not
-- deploy_db). Regen types.ts in a SEPARATE step. schema_migrations is NOT touched.
--
-- DESIGN (P0 rules from the approved plan):
--   P0-1  No broad client UPDATE on marketing_posts. Clients only SELECT (RLS) + call the
--         SECURITY DEFINER RPCs below. status/sent_at/claimed_at/approved_* are never client-set.
--   P0-2  Compliance hard-block: marketing_schedule_post() runs marketing_check_compliance()
--         FIRST; a blocked post never reaches 'scheduled'.
--   P0-3  Telegram-only P0: marketing_schedule_post() validates every requested channel is
--         configured (telegram via club_settings.telegram_chat_id, others via
--         club_channel_integrations.enabled) and refuses to schedule an unconfigured channel.
--   P0-4  marketing_channel_delivery_status enum (no free-text status).
--   P0-5  marketing_claim_due_posts() — FOR UPDATE SKIP LOCKED, scheduled→processing, exactly
--         once. UNIQUE(post_id, channel) on post_channel_status anchors per-channel idempotency.
--   P0-6  Tokens never stored here: club_channel_integrations holds only target_ref (routing) +
--         secret_ref (the NAME of a Vault/env key), never the token itself.
--
-- Additive + idempotent. No cross-module FK/write into Cashier, Payroll, Tracker, Dealer Swing,
-- the online engine, or Tournament Structure.

-- ===========================================================================================
-- 0. Enums (new types — safe to create in this file; we do NOT touch the shared app_role enum).
-- ===========================================================================================
DO $$ BEGIN
  CREATE TYPE public.marketing_post_status AS ENUM
    ('draft', 'scheduled', 'processing', 'sent', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketing_channel AS ENUM ('telegram', 'facebook', 'zalo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketing_channel_delivery_status AS ENUM
    ('pending', 'processing', 'sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketing_compliance_status AS ENUM ('clean', 'flagged', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================================
-- 1. Tables
-- ===========================================================================================

-- 1a. marketing_posts — one authored post (manual now; 'auto_event' source in a later phase).
CREATE TABLE IF NOT EXISTS public.marketing_posts (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id            uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  title              text,
  body               text NOT NULL,
  media_urls         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of Supabase Storage URLs
  channels           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of marketing_channel values
  hashtags           text[] NOT NULL DEFAULT '{}',
  utm                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             public.marketing_post_status NOT NULL DEFAULT 'draft',
  scheduled_at       timestamptz,
  claimed_at         timestamptz,                          -- set by marketing_claim_due_posts (P0-5)
  compliance_status  public.marketing_compliance_status NOT NULL DEFAULT 'clean',
  compliance_flags   jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_kind        text NOT NULL DEFAULT 'manual',       -- 'manual' | 'auto_event' (future)
  source_ref         jsonb,
  client_request_id  text NOT NULL DEFAULT gen_random_uuid()::text,  -- idempotency (P0)
  created_by         uuid DEFAULT auth.uid(),
  approved_by        uuid,                                 -- reserved for the future approval gate
  approved_at        timestamptz,
  reject_reason      text,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_posts_client_req_uq UNIQUE (club_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_mkt_posts_club        ON public.marketing_posts(club_id);
CREATE INDEX IF NOT EXISTS idx_mkt_posts_due         ON public.marketing_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_mkt_posts_created_by  ON public.marketing_posts(created_by);

ALTER TABLE public.marketing_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_posts TO authenticated;
-- P0-1: SELECT only for the client. NO insert/update/delete policy → all writes go through the
-- SECURITY DEFINER RPCs (they run as the function owner and bypass RLS for their own statements).
DROP POLICY IF EXISTS marketing_posts_select ON public.marketing_posts;
CREATE POLICY marketing_posts_select ON public.marketing_posts
  FOR SELECT TO authenticated
  USING (club_id IN (SELECT public.marketer_club_ids(auth.uid())));

-- 1b. post_channel_status — per-channel delivery audit + exactly-once anchor.
CREATE TABLE IF NOT EXISTS public.post_channel_status (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id             uuid NOT NULL REFERENCES public.marketing_posts(id) ON DELETE CASCADE,
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,  -- denorm for RLS
  channel             public.marketing_channel NOT NULL,
  status              public.marketing_channel_delivery_status NOT NULL DEFAULT 'pending',
  attempts            int NOT NULL DEFAULT 0,
  external_message_id text,
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_channel_status_uq UNIQUE (post_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_pcs_post ON public.post_channel_status(post_id);

ALTER TABLE public.post_channel_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_channel_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.post_channel_status TO authenticated;
-- Read-only for the client (to render per-channel delivery state); writes are service-role only
-- (the marketing-dispatch Edge fn uses the service role, which bypasses RLS).
DROP POLICY IF EXISTS post_channel_status_select ON public.post_channel_status;
CREATE POLICY post_channel_status_select ON public.post_channel_status
  FOR SELECT TO authenticated
  USING (club_id IN (SELECT public.marketer_club_ids(auth.uid())));

-- 1c. club_channel_integrations — per-club per-channel routing + secret POINTER (never a token).
CREATE TABLE IF NOT EXISTS public.club_channel_integrations (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  channel     public.marketing_channel NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  target_ref  text,           -- routing only: telegram chat_id / FB page id / Zalo OA id
  secret_ref  text,           -- the NAME of a Vault/env key (e.g. 'TELEGRAM_BOT_TOKEN'); NEVER the token
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_channel_integrations_uq UNIQUE (club_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_cci_club ON public.club_channel_integrations(club_id);

ALTER TABLE public.club_channel_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_channel_integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_channel_integrations TO authenticated;
-- Owner-only: marketers never read this table directly (they get the enabled-channel LIST via the
-- marketing_list_enabled_channels RPC, which omits secret_ref). Writes via the owner RPC below.
DROP POLICY IF EXISTS club_channel_integrations_select ON public.club_channel_integrations;
CREATE POLICY club_channel_integrations_select ON public.club_channel_integrations
  FOR SELECT TO authenticated
  USING (public.is_club_owner(auth.uid(), club_id));

-- 1d. marketing_blocked_terms — minimal compliance dictionary (P0-2). Global rows (club_id NULL)
--     apply to every club; club rows apply to that club only.
CREATE TABLE IF NOT EXISTS public.marketing_blocked_terms (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id     uuid REFERENCES public.clubs(id) ON DELETE CASCADE,  -- NULL = global
  term        text NOT NULL,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_blocked_terms_uq UNIQUE (club_id, term)
);
CREATE INDEX IF NOT EXISTS idx_mbt_club ON public.marketing_blocked_terms(club_id);

ALTER TABLE public.marketing_blocked_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_blocked_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_blocked_terms TO authenticated;
DROP POLICY IF EXISTS marketing_blocked_terms_select ON public.marketing_blocked_terms;
CREATE POLICY marketing_blocked_terms_select ON public.marketing_blocked_terms
  FOR SELECT TO authenticated
  USING (club_id IS NULL OR public.is_club_owner(auth.uid(), club_id));

-- Seed a high-risk set of GLOBAL terms a poker venue must not promote in VN (promoting illegal
-- real-money gambling). STARTING POINT — the owner curates at runtime via the RPCs below. Kept
-- DELIBERATELY NARROW: legitimate event words ("giải", "đăng ký", "GTD", "buy-in") are NOT blocked
-- so normal event promos pass.
-- NOTE: 'staking' / 'bankroll' are ALSO legitimate VinPoker product terms (the staking
-- marketplace). They are seeded per the owner's high-risk list; if a club needs to PROMOTE the
-- staking marketplace, remove them per-club with marketing_remove_blocked_term.
INSERT INTO public.marketing_blocked_terms (club_id, term, note) VALUES
  (NULL, 'cá độ',      'illegal sports betting'),
  (NULL, 'cá cược',    'illegal betting'),
  (NULL, 'đặt cược',   'illegal betting'),
  (NULL, 'kèo',        'betting-odds slang'),
  (NULL, 'tài xỉu',    'illegal dice gambling'),
  (NULL, 'lô đề',      'illegal numbers lottery'),
  (NULL, 'đánh bạc',   'illegal gambling'),
  (NULL, 'nổ hũ',      'slot/jackpot gambling'),
  (NULL, 'casino',     'casino gambling'),
  (NULL, 'đổi thưởng', 'prize-redemption gambling'),
  (NULL, 'tiền thật',  'real-money gambling claim'),
  (NULL, 'ăn tiền',    'real-money gambling claim'),
  (NULL, 'staking',    'real-money implication (also a product term — remove if promoting staking marketplace)'),
  (NULL, 'bankroll',   'real-money implication (also a product term — remove if needed)')
ON CONFLICT (club_id, term) DO NOTHING;

-- ===========================================================================================
-- 2. Compliance check helper (P0-2). Pure, read-only. Returns {status, flags:[matched terms]}.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_check_compliance(p_club_id uuid, p_text text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT bt.term
    FROM public.marketing_blocked_terms bt
    WHERE (bt.club_id IS NULL OR bt.club_id = p_club_id)
      AND p_text IS NOT NULL
      AND position(lower(bt.term) IN lower(p_text)) > 0
  )
  SELECT jsonb_build_object(
    'status', CASE WHEN EXISTS (SELECT 1 FROM matched) THEN 'blocked' ELSE 'clean' END,
    'flags',  COALESCE((SELECT jsonb_agg(term) FROM matched), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.marketing_check_compliance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_check_compliance(uuid, text) TO authenticated;

-- 2b. Convenience read: the clubs the caller may act on for marketing (drives the UI selector).
--     Scoped by marketer_club_ids → never leaks clubs the user can't post for.
CREATE OR REPLACE FUNCTION public.marketing_my_clubs()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name),
    '[]'::jsonb)
  FROM public.clubs c
  WHERE c.id IN (SELECT public.marketer_club_ids(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.marketing_my_clubs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_my_clubs() TO authenticated;

-- ===========================================================================================
-- 3. Client write RPCs (P0-1). All SECURITY DEFINER, gate (is_club_marketer OR is_club_owner).
-- ===========================================================================================

-- 3a. Create a draft.
CREATE OR REPLACE FUNCTION public.marketing_create_post(
  p_club_id           uuid,
  p_title             text,
  p_body              text,
  p_channels          jsonb DEFAULT '[]'::jsonb,
  p_media_urls        jsonb DEFAULT '[]'::jsonb,
  p_hashtags          text[] DEFAULT '{}',
  p_utm               jsonb DEFAULT '{}'::jsonb,
  p_client_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_crid text := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_marketer(v_uid, p_club_id) OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'body');
  END IF;
  -- channels must be an array of known channel values (or empty for a pure draft).
  IF p_channels IS NULL OR jsonb_typeof(p_channels) <> 'array' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'channels');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_channels) c
    WHERE c NOT IN ('telegram', 'facebook', 'zalo')
  ) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'channel_value');
  END IF;
  -- media_urls (if any) must be Supabase Storage object URLs (no arbitrary external URLs).
  IF p_media_urls IS NULL OR jsonb_typeof(p_media_urls) <> 'array' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'media_urls');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_media_urls) u
    WHERE position('/storage/v1/object/' IN u) = 0
  ) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'media_url_not_storage');
  END IF;

  BEGIN
    INSERT INTO public.marketing_posts (club_id, title, body, channels, media_urls, hashtags, utm,
                                        status, client_request_id, created_by)
    VALUES (p_club_id, NULLIF(btrim(COALESCE(p_title, '')), ''), btrim(p_body),
            p_channels, p_media_urls, COALESCE(p_hashtags, '{}'), COALESCE(p_utm, '{}'::jsonb),
            'draft', v_crid, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Idempotent retry: return the existing post for this (club, client_request_id).
    SELECT id INTO v_id FROM public.marketing_posts
    WHERE club_id = p_club_id AND client_request_id = v_crid;
    RETURN jsonb_build_object('status', 'ok', 'post_id', v_id, 'idempotent', true);
  END;
  RETURN jsonb_build_object('status', 'ok', 'post_id', v_id);
END;
$$;

-- 3b. Update a draft's content (only while status='draft').
CREATE OR REPLACE FUNCTION public.marketing_update_draft(
  p_post_id    uuid,
  p_title      text,
  p_body       text,
  p_channels   jsonb DEFAULT '[]'::jsonb,
  p_media_urls jsonb DEFAULT '[]'::jsonb,
  p_hashtags   text[] DEFAULT '{}',
  p_utm        jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_status public.marketing_post_status;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT club_id, status INTO v_club, v_status FROM public.marketing_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'POST_NOT_FOUND'); END IF;
  IF NOT (public.is_club_marketer(v_uid, v_club) OR public.is_club_owner(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF v_status <> 'draft' THEN RETURN jsonb_build_object('error', 'NOT_EDITABLE', 'status', v_status); END IF;
  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'body');
  END IF;
  IF p_channels IS NULL OR jsonb_typeof(p_channels) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_channels) c
                WHERE c NOT IN ('telegram', 'facebook', 'zalo')) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'channels');
  END IF;
  IF p_media_urls IS NULL OR jsonb_typeof(p_media_urls) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_media_urls) u
                WHERE position('/storage/v1/object/' IN u) = 0) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'media_urls');
  END IF;

  UPDATE public.marketing_posts
  SET title = NULLIF(btrim(COALESCE(p_title, '')), ''),
      body = btrim(p_body), channels = p_channels, media_urls = p_media_urls,
      hashtags = COALESCE(p_hashtags, '{}'), utm = COALESCE(p_utm, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_post_id;
  RETURN jsonb_build_object('status', 'ok', 'post_id', p_post_id);
END;
$$;

-- 3c. Schedule (direct-publish): compliance check FIRST (P0-2), channel-configured check (P0-3),
--     then draft|scheduled → scheduled. Never client-sets sent/processing.
CREATE OR REPLACE FUNCTION public.marketing_schedule_post(
  p_post_id      uuid,
  p_scheduled_at timestamptz DEFAULT NULL    -- NULL = publish ASAP (now)
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_post     public.marketing_posts;
  v_comp     jsonb;
  v_when     timestamptz := COALESCE(p_scheduled_at, now());
  v_ch       text;
  v_tg_chat  text;
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

  -- P0-2: compliance hard-block.
  v_comp := public.marketing_check_compliance(v_post.club_id, COALESCE(v_post.title, '') || ' ' || v_post.body);
  IF (v_comp->>'status') = 'blocked' THEN
    UPDATE public.marketing_posts
    SET compliance_status = 'blocked', compliance_flags = v_comp->'flags', updated_at = now()
    WHERE id = p_post_id;
    RETURN jsonb_build_object('error', 'COMPLIANCE_BLOCKED', 'flags', v_comp->'flags');
  END IF;

  -- P0-3: every requested channel must be configured for this club.
  FOR v_ch IN SELECT jsonb_array_elements_text(v_post.channels) LOOP
    IF v_ch = 'telegram' THEN
      -- SINGLE source of truth for Telegram = club_settings.telegram_chat_id, the SAME source the
      -- dispatcher reads. Do NOT also accept club_channel_integrations for telegram, or schedule
      -- could pass while dispatch fails with no_chat_id.
      SELECT telegram_chat_id INTO v_tg_chat FROM public.club_settings WHERE club_id = v_post.club_id;
      IF v_tg_chat IS NULL OR length(btrim(v_tg_chat)) = 0 THEN
        RETURN jsonb_build_object('error', 'CHANNEL_NOT_CONFIGURED', 'channel', 'telegram');
      END IF;
    ELSE
      -- FB/Zalo (future) use club_channel_integrations.enabled.
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

-- 3d. Cancel (draft|scheduled → cancelled).
CREATE OR REPLACE FUNCTION public.marketing_cancel_post(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_status public.marketing_post_status;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT club_id, status INTO v_club, v_status FROM public.marketing_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'POST_NOT_FOUND'); END IF;
  IF NOT (public.is_club_marketer(v_uid, v_club) OR public.is_club_owner(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF v_status NOT IN ('draft', 'scheduled') THEN
    RETURN jsonb_build_object('error', 'NOT_CANCELLABLE', 'status', v_status);
  END IF;
  UPDATE public.marketing_posts SET status = 'cancelled', updated_at = now() WHERE id = p_post_id;
  RETURN jsonb_build_object('status', 'ok', 'post_id', p_post_id);
END;
$$;

REVOKE ALL ON FUNCTION public.marketing_create_post(uuid, text, text, jsonb, jsonb, text[], jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_update_draft(uuid, text, text, jsonb, jsonb, text[], jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_schedule_post(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_cancel_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_create_post(uuid, text, text, jsonb, jsonb, text[], jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_update_draft(uuid, text, text, jsonb, jsonb, text[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_schedule_post(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_cancel_post(uuid) TO authenticated;

-- ===========================================================================================
-- 4. Channel-integration RPCs.
-- ===========================================================================================

-- 4a. Marketers + owners read the ENABLED channel list (no secret_ref) to drive composer toggles.
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
  v_tg  text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_marketer(v_uid, p_club_id) OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  -- FB/Zalo come from club_channel_integrations; Telegram comes ONLY from club_settings (single
  -- source of truth, matching the dispatcher + the schedule check). Excluding telegram from the
  -- integrations aggregation prevents a dual source where the UI shows a channel the dispatcher
  -- can't actually reach.
  SELECT COALESCE(jsonb_agg(channel::text ORDER BY channel::text), '[]'::jsonb) INTO v_arr
  FROM public.club_channel_integrations
  WHERE club_id = p_club_id AND enabled AND channel <> 'telegram';
  SELECT telegram_chat_id INTO v_tg FROM public.club_settings WHERE club_id = p_club_id;
  IF v_tg IS NOT NULL AND length(btrim(v_tg)) > 0 THEN
    v_arr := v_arr || '["telegram"]'::jsonb;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'channels', v_arr);
END;
$$;

-- 4b. Owner upserts a channel integration (routing + secret POINTER only — never a raw token).
CREATE OR REPLACE FUNCTION public.marketing_upsert_channel_integration(
  p_club_id    uuid,
  p_channel    text,
  p_enabled    boolean,
  p_target_ref text DEFAULT NULL,
  p_secret_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_channel NOT IN ('telegram', 'facebook', 'zalo') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'channel');
  END IF;
  -- secret_ref must be a KEY NAME from a FIXED ALLOWLIST — never an arbitrary env key, never a raw
  -- token. P0 Telegram uses the global TELEGRAM_BOT_TOKEN + club_settings.telegram_chat_id and needs
  -- NO secret_ref; the only allowed names are the specific Edge secrets the future FB/Zalo adapters
  -- will read. This blocks both token-pasting and cross-secret/arbitrary-env pointing.
  IF p_secret_ref IS NOT NULL AND p_secret_ref NOT IN
       ('TELEGRAM_BOT_TOKEN', 'FACEBOOK_PAGE_TOKEN', 'ZALO_OA_TOKEN') THEN
    RETURN jsonb_build_object('error', 'SECRET_REF_NOT_ALLOWED');
  END IF;
  INSERT INTO public.club_channel_integrations (club_id, channel, enabled, target_ref, secret_ref, updated_by)
  VALUES (p_club_id, p_channel::public.marketing_channel, COALESCE(p_enabled, false), p_target_ref, p_secret_ref, v_uid)
  ON CONFLICT (club_id, channel) DO UPDATE
    SET enabled = EXCLUDED.enabled, target_ref = EXCLUDED.target_ref,
        secret_ref = EXCLUDED.secret_ref, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'channel', p_channel);
END;
$$;

-- 4c. Owner manages blocked terms.
CREATE OR REPLACE FUNCTION public.marketing_add_blocked_term(p_club_id uuid, p_term text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_club_id IS NULL OR NOT public.is_club_owner(v_uid, p_club_id) THEN
    RETURN jsonb_build_object('error', 'Forbidden');  -- only super_admin can curate global terms via SQL
  END IF;
  IF p_term IS NULL OR length(btrim(p_term)) = 0 THEN RETURN jsonb_build_object('error', 'INVALID_INPUT'); END IF;
  INSERT INTO public.marketing_blocked_terms (club_id, term, note, created_by)
  VALUES (p_club_id, btrim(lower(p_term)), p_note, v_uid)
  ON CONFLICT (club_id, term) DO NOTHING;
  RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_remove_blocked_term(p_club_id uuid, p_term text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_club_id IS NULL OR NOT public.is_club_owner(v_uid, p_club_id) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  DELETE FROM public.marketing_blocked_terms WHERE club_id = p_club_id AND term = btrim(lower(p_term));
  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.marketing_list_enabled_channels(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_upsert_channel_integration(uuid, text, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_add_blocked_term(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_remove_blocked_term(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_list_enabled_channels(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_upsert_channel_integration(uuid, text, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_add_blocked_term(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_remove_blocked_term(uuid, text) TO authenticated;

-- ===========================================================================================
-- 5. Service-role dispatch RPCs (P0-5). Called ONLY by the marketing-dispatch Edge fn
--    (service role). EXECUTE granted to service_role only (NOT authenticated/anon).
-- ===========================================================================================

-- 5a. Atomically claim due posts: scheduled & due → processing, FOR UPDATE SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.marketing_claim_due_posts(p_limit int DEFAULT 20)
RETURNS SETOF public.marketing_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.marketing_posts
    WHERE status = 'scheduled' AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 20), 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.marketing_posts p
  SET status = 'processing', claimed_at = now(), updated_at = now()
  FROM due
  WHERE p.id = due.id
  RETURNING p.*;
END;
$$;

-- 5b. Record one channel's delivery result (idempotent via UNIQUE(post_id, channel)).
CREATE OR REPLACE FUNCTION public.marketing_record_channel_result(
  p_post_id        uuid,
  p_channel        text,
  p_status         text,                 -- 'sent' | 'failed' | 'skipped'
  p_external_id    text DEFAULT NULL,
  p_error          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_club uuid;
BEGIN
  SELECT club_id INTO v_club FROM public.marketing_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'POST_NOT_FOUND'); END IF;
  INSERT INTO public.post_channel_status (post_id, club_id, channel, status, attempts,
                                          external_message_id, error, sent_at)
  VALUES (p_post_id, v_club, p_channel::public.marketing_channel,
          p_status::public.marketing_channel_delivery_status, 1, p_external_id,
          left(p_error, 1000), CASE WHEN p_status = 'sent' THEN now() ELSE NULL END)
  ON CONFLICT (post_id, channel) DO UPDATE
    SET status = EXCLUDED.status, attempts = public.post_channel_status.attempts + 1,
        external_message_id = COALESCE(EXCLUDED.external_message_id, public.post_channel_status.external_message_id),
        error = EXCLUDED.error,
        sent_at = COALESCE(public.post_channel_status.sent_at, EXCLUDED.sent_at),
        updated_at = now();
  RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- 5c. Finalize a post from its per-channel rows: all requested channels sent → sent; else failed.
CREATE OR REPLACE FUNCTION public.marketing_finalize_post(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_sent  int;
  v_new   public.marketing_post_status;
BEGIN
  SELECT jsonb_array_length(channels) INTO v_total FROM public.marketing_posts WHERE id = p_post_id;
  IF v_total IS NULL THEN RETURN jsonb_build_object('error', 'POST_NOT_FOUND'); END IF;
  SELECT count(*) INTO v_sent FROM public.post_channel_status
  WHERE post_id = p_post_id AND status = 'sent';
  v_new := CASE WHEN v_sent >= v_total THEN 'sent'::public.marketing_post_status
                ELSE 'failed'::public.marketing_post_status END;
  UPDATE public.marketing_posts
  SET status = v_new, sent_at = CASE WHEN v_new = 'sent' THEN now() ELSE sent_at END, updated_at = now()
  WHERE id = p_post_id;
  RETURN jsonb_build_object('status', 'ok', 'post_status', v_new, 'sent', v_sent, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.marketing_claim_due_posts(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_record_channel_result(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_finalize_post(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_claim_due_posts(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_record_channel_result(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_finalize_post(uuid) TO service_role;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 000000+000001 first; run in a tx + ROLLBACK).
--   <owner> owns <club> (club_settings.telegram_chat_id set); <mk> granted marketer; <other> none.
--
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>'; SELECT public.marketing_grant_marketer('<club>','<mk>');
--   SET LOCAL request.jwt.claim.sub = '<mk>';
--   -- create + schedule a clean telegram post:
--   SELECT public.marketing_create_post('<club>', 'Khai mạc', 'Giải tối nay 19h', '["telegram"]'::jsonb);  -- post_id
--   SELECT public.marketing_schedule_post('<post_id>', now());   -- {status: ok, scheduled_at}
--   -- compliance hard-block:
--   SELECT public.marketing_create_post('<club>', NULL, 'Tới club chơi cá độ nhé', '["telegram"]'::jsonb); -- post2
--   SELECT public.marketing_schedule_post('<post2>', now());     -- {error: COMPLIANCE_BLOCKED, flags:["cá độ"]}
--   -- unconfigured channel refused:
--   SELECT public.marketing_create_post('<club>', NULL, 'Bài fb', '["facebook"]'::jsonb);                  -- post3
--   SELECT public.marketing_schedule_post('<post3>', now());     -- {error: CHANNEL_NOT_CONFIGURED, channel: facebook}
--   -- non-member blocked:
--   SET LOCAL request.jwt.claim.sub = '<other>';
--   SELECT public.marketing_create_post('<club>', NULL, 'x', '[]'::jsonb);                                  -- {error: Forbidden}
--   -- service-role claim picks the due post exactly once:
--   RESET request.jwt.claim.sub; SET ROLE service_role;
--   SELECT id, status FROM public.marketing_claim_due_posts(10);  -- the scheduled post → 'processing'
--   SELECT public.marketing_record_channel_result('<post_id>','telegram','sent','tg_123',NULL);
--   SELECT public.marketing_finalize_post('<post_id>');           -- {post_status: sent}
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.marketing_finalize_post(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_record_channel_result(uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.marketing_claim_due_posts(int);
--   DROP FUNCTION IF EXISTS public.marketing_remove_blocked_term(uuid, text);
--   DROP FUNCTION IF EXISTS public.marketing_add_blocked_term(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.marketing_upsert_channel_integration(uuid, text, boolean, text, text);
--   DROP FUNCTION IF EXISTS public.marketing_list_enabled_channels(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_my_clubs();
--   DROP FUNCTION IF EXISTS public.marketing_cancel_post(uuid);
--   DROP FUNCTION IF EXISTS public.marketing_schedule_post(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.marketing_update_draft(uuid, text, text, jsonb, jsonb, text[], jsonb);
--   DROP FUNCTION IF EXISTS public.marketing_create_post(uuid, text, text, jsonb, jsonb, text[], jsonb, text);
--   DROP FUNCTION IF EXISTS public.marketing_check_compliance(uuid, text);
--   DROP TABLE IF EXISTS public.marketing_blocked_terms;
--   DROP TABLE IF EXISTS public.club_channel_integrations;
--   DROP TABLE IF EXISTS public.post_channel_status;
--   DROP TABLE IF EXISTS public.marketing_posts;
--   DROP TYPE IF EXISTS public.marketing_compliance_status;
--   DROP TYPE IF EXISTS public.marketing_channel_delivery_status;
--   DROP TYPE IF EXISTS public.marketing_channel;
--   DROP TYPE IF EXISTS public.marketing_post_status;
-- ===========================================================================================
