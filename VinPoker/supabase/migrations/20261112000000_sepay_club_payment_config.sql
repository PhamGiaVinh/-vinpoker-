-- SePay ingestion — Patch 2b-cred: per-club SePay credential store (Supabase Vault).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL
-- Editor / Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: Patch 2 reconciliation pulls each club's transactions from the SePay API with that club's
-- API token. SePay tokens are FULL-account (no scoping) → they must NEVER sit in a plaintext column.
-- This mirrors the reviewed VinPoker Vault pattern 1:1 (marketing_telegram_dedicated 20261101000004
-- + online_poker_runner_cron_vault 20260917000000):
--   - tokens are stored ENCRYPTED in Supabase Vault, named deterministically per club;
--   - the config table holds only the Vault secret NAME (a pointer), never the token;
--   - an owner/super_admin SECURITY DEFINER setter writes the token straight to Vault;
--   - a service_role-ONLY SECURITY DEFINER getter reads vault.decrypted_secrets (ONLY the Patch-2
--     reconcile edge fn ever calls it);
--   - a non-secret reader returns config (master account, is_active, has_*_token) to the UI.
--
-- INERT: this patch only creates the store + functions. NOTHING calls sepay_get_club_api_token yet
-- (the reconcile edge fn + cron are later, separately-reviewed patches) — no token is read, no cron,
-- no settle, no money. The Patch-1 webhook keeps using its single SEPAY_WEBHOOK_SECRET env until a
-- later patch wires per-club push from webhook_secret_vault_key here.
--
-- Tokens are provisioned out-of-band by the owner via sepay_set_club_payment_config() — NEVER in
-- this file, never committed, never logged. Vault secret names:
--   club_<club_id>_sepay_api_token, club_<club_id>_sepay_webhook_secret.
-- Rollback: DROP the 4 functions + DROP TABLE public.club_payment_config; and (manual, owner)
--   DELETE FROM vault.secrets WHERE name LIKE 'club_%_sepay_%';
--
-- Depends on: supabase_vault (vault.create_secret / vault.update_secret / vault.secrets /
--   vault.decrypted_secrets — verified enabled on this project); helpers is_club_owner, has_role.
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE OR REPLACE FUNCTION; explicit REVOKE/GRANT.

-- ===========================================================================================
-- 1. Config table — Vault secret-name pointers + non-secret per-club SePay config. NO token here.
--    Locked: RPC-only (service_role bypasses RLS; the SECURITY DEFINER functions are the sole path).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.club_payment_config (
  club_id                  uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  provider                 text NOT NULL DEFAULT 'sepay',
  master_account_number    text,            -- SePay master account (also resolves club at settle); NOT secret
  api_token_vault_key      text,            -- Vault secret NAME for the pull token; NULL = not set. NOT the token.
  webhook_secret_vault_key text,            -- Vault secret NAME for the per-club Apikey (push); NULL = use env. NOT the secret.
  is_active                boolean NOT NULL DEFAULT false,
  last_pull_at             timestamptz,
  last_pull_status         text,
  last_pull_error          text,
  updated_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.club_payment_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_payment_config FROM PUBLIC, anon, authenticated;
-- No GRANT, no policy → only service_role / SECURITY DEFINER functions reach this table.

-- ===========================================================================================
-- 2. Owner/super_admin write: set per-club SePay config (+ optional tokens → Vault).
--    p_api_token / p_webhook_secret: NULL = leave unchanged · '' = clear · else store in Vault.
--    p_master_account_number / p_is_active: NULL = leave unchanged.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.sepay_set_club_payment_config(
  p_club_id               uuid,
  p_master_account_number text    DEFAULT NULL,
  p_api_token             text    DEFAULT NULL,
  p_webhook_secret        text    DEFAULT NULL,
  p_is_active             boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_api_name text := 'club_' || p_club_id::text || '_sepay_api_token';
  v_wh_name  text := 'club_' || p_club_id::text || '_sepay_webhook_secret';
  v_sid      uuid;
  v_api_key  text;   -- vault key to persist for the api token
  v_wh_key   text;   -- vault key to persist for the webhook secret
  v_master   text;
  v_active   boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id)
          OR public.has_role(v_uid, 'super_admin'::public.app_role)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- Load existing values so NULL params leave them unchanged.
  SELECT api_token_vault_key, webhook_secret_vault_key, master_account_number, is_active
    INTO v_api_key, v_wh_key, v_master, v_active
    FROM public.club_payment_config WHERE club_id = p_club_id;

  v_master := COALESCE(p_master_account_number, v_master);
  v_active := COALESCE(p_is_active, v_active, false);

  -- API token action (Vault). Persist only the NAME, never the token.
  IF p_api_token IS NULL THEN
    NULL;                                            -- leave v_api_key as-is
  ELSIF length(btrim(p_api_token)) = 0 THEN
    v_api_key := NULL;                               -- clear
  ELSE
    SELECT id INTO v_sid FROM vault.secrets WHERE name = v_api_name;
    IF v_sid IS NULL THEN
      PERFORM vault.create_secret(btrim(p_api_token), v_api_name, 'sepay api token');
    ELSE
      PERFORM vault.update_secret(v_sid, btrim(p_api_token));
    END IF;
    v_api_key := v_api_name;
  END IF;

  -- Webhook secret action (Vault). Same semantics.
  IF p_webhook_secret IS NULL THEN
    NULL;
  ELSIF length(btrim(p_webhook_secret)) = 0 THEN
    v_wh_key := NULL;
  ELSE
    SELECT id INTO v_sid FROM vault.secrets WHERE name = v_wh_name;
    IF v_sid IS NULL THEN
      PERFORM vault.create_secret(btrim(p_webhook_secret), v_wh_name, 'sepay webhook secret');
    ELSE
      PERFORM vault.update_secret(v_sid, btrim(p_webhook_secret));
    END IF;
    v_wh_key := v_wh_name;
  END IF;

  INSERT INTO public.club_payment_config
    (club_id, master_account_number, api_token_vault_key, webhook_secret_vault_key, is_active, updated_by, updated_at)
  VALUES (p_club_id, v_master, v_api_key, v_wh_key, v_active, v_uid, now())
  ON CONFLICT (club_id) DO UPDATE SET
    master_account_number    = EXCLUDED.master_account_number,
    api_token_vault_key      = EXCLUDED.api_token_vault_key,
    webhook_secret_vault_key = EXCLUDED.webhook_secret_vault_key,
    is_active                = EXCLUDED.is_active,
    updated_by               = EXCLUDED.updated_by,
    updated_at               = now();

  RETURN jsonb_build_object(
    'status', 'ok',
    'club_id', p_club_id,
    'has_api_token', v_api_key IS NOT NULL,
    'has_webhook_secret', v_wh_key IS NOT NULL,
    'is_active', v_active
  );
END;
$$;

-- ===========================================================================================
-- 3. Owner/super_admin read for the UI — NEVER returns a token, only whether one is set.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.sepay_get_club_payment_config(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.club_payment_config;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id)
          OR public.has_role(v_uid, 'super_admin'::public.app_role)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  SELECT * INTO v_row FROM public.club_payment_config WHERE club_id = p_club_id;
  RETURN jsonb_build_object(
    'status', 'ok',
    'provider', COALESCE(v_row.provider, 'sepay'),
    'master_account_number', v_row.master_account_number,
    'is_active', COALESCE(v_row.is_active, false),
    'has_api_token', v_row.api_token_vault_key IS NOT NULL,
    'has_webhook_secret', v_row.webhook_secret_vault_key IS NOT NULL,
    'last_pull_at', v_row.last_pull_at,
    'last_pull_status', v_row.last_pull_status
  );
END;
$$;

-- ===========================================================================================
-- 4. Service-role ONLY: active clubs for the reconcile loop (NO secret).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.sepay_get_active_payment_clubs()
RETURNS TABLE (club_id uuid, master_account_number text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cpc.club_id, cpc.master_account_number
  FROM public.club_payment_config cpc
  WHERE cpc.is_active = true AND cpc.api_token_vault_key IS NOT NULL;
$$;

-- ===========================================================================================
-- 5. Service-role ONLY: decrypt + return a club's SePay API token. ONLY the Patch-2 reconcile
--    edge fn calls this (a later patch). Fail-safe: NULL when unset/inactive → caller no-ops.
--    NOTHING calls it in this patch → the store stays inert.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.sepay_get_club_api_token(p_club_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key   text;
  v_token text;
BEGIN
  SELECT api_token_vault_key INTO v_key
  FROM public.club_payment_config WHERE club_id = p_club_id AND is_active = true;
  IF v_key IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = v_key;
  RETURN v_token;
END;
$$;

-- ===========================================================================================
-- 6. Grants. Setter + non-secret reader → authenticated (gated inside via is_club_owner/super_admin).
--    Active-clubs + token getter → service_role ONLY (the reconcile edge fn). The decrypted token is
--    NEVER reachable by anon or authenticated.
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.sepay_set_club_payment_config(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sepay_set_club_payment_config(uuid, text, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.sepay_get_club_payment_config(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sepay_get_club_payment_config(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.sepay_get_active_payment_clubs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sepay_get_active_payment_clubs() TO service_role;

REVOKE ALL ON FUNCTION public.sepay_get_club_api_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sepay_get_club_api_token(uuid) TO service_role;
