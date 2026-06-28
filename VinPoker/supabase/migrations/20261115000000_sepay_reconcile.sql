-- SePay ingestion — Patch 2 (Direction 1): reconcile DB support — ingest RPC + pg_cron schedule.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- ⚠️ APPLY ORDER: deploy the sepay-reconcile edge function FIRST, then apply this. The cron created
-- here POSTs to that function; if the function isn't deployed yet the POST just 404s (harmless). The
-- whole piece stays INERT until the owner configures a club (sepay_set_club_payment_config → is_active)
-- — until then sepay_get_active_payment_clubs returns nothing and the worker no-ops.
--
-- WHY the ingest RPC (and not a plain supabase-js upsert): the reconcile worker must, per pulled SePay
-- transaction, ON CONFLICT (provider, account_number, provider_txn_id):
--   - STAMP api_verified_at only if currently NULL (preserve the first-verified instant),
--   - BACKFILL amount / occurred_at only if NULL (recover a webhook-quarantined row),
--   - NEVER touch status / club_id / processed_at (a 'matched' or 'ignored' row must NOT reset to
--     'unmatched'), and
--   - SKIP the write entirely for rows already fully verified (no per-tick write amplification).
-- supabase-js .upsert() can express none of (COALESCE-merge / conditional WHERE / column subset safely),
-- so this is a SECURITY DEFINER bulk-upsert RPC. It is service_role-only (the worker is the sole caller).
--
-- CRON AUTH (no secret literal in this file): the job reads BOTH header values from Vault at run time —
--   - 'sepay_reconcile_secret'  : the shared gate secret (== the function's SEPAY_RECONCILE_SECRET env),
--   - 'sepay_reconcile_anon_key': the project's PUBLIC anon key (needed only to route through the edge
--     gateway; it is public — stored in Vault purely to keep this migration free of credential-looking
--     literals, unlike the legacy 20260428144425 cron which hard-codes the anon JWT).
-- Owner sets these out-of-band (Vault) + SEPAY_RECONCILE_SECRET in the Function env (same value as the
-- Vault one). If a secret is unset, the POST is sent with a NULL header → the function 401s (harmless).
--
-- Idempotent: CREATE OR REPLACE FUNCTION; cron.unschedule-then-schedule. Depends on: pg_cron, pg_net
-- (net.http_post), supabase_vault (verified live), bank_transactions + its uq_bank_txn unique index.
-- Rollback: SELECT cron.unschedule('sepay-reconcile'); DROP FUNCTION public.sepay_ingest_verified_transactions(jsonb);

-- ===========================================================================================
-- 1. Bulk verified-ingest RPC. Returns the number of rows inserted-or-updated (observability).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.sepay_ingest_verified_transactions(p_txns jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_txns IS NULL OR jsonb_typeof(p_txns) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.bank_transactions
    (provider, provider_txn_id, account_number, sub_account, gateway, amount, transfer_type,
     content, txn_ref, occurred_at, api_verified_at, api_verified_source, raw_payload)
  SELECT
    'sepay',
    btrim(t->>'provider_txn_id'),
    btrim(t->>'account_number'),
    NULLIF(btrim(coalesce(t->>'sub_account','')), ''),
    NULLIF(btrim(coalesce(t->>'gateway','')), ''),
    CASE WHEN NULLIF(btrim(coalesce(t->>'amount','')), '') IS NULL THEN NULL ELSE (t->>'amount')::bigint END,
    NULLIF(btrim(coalesce(t->>'transfer_type','')), ''),
    NULLIF(t->>'content', ''),
    NULLIF(btrim(coalesce(t->>'txn_ref','')), ''),
    CASE WHEN NULLIF(btrim(coalesce(t->>'occurred_at','')), '') IS NULL THEN NULL ELSE (t->>'occurred_at')::timestamptz END,
    now(),                       -- api_verified_at on a NEW (webhook-missed) row = verified now
    'sepay_v2',
    COALESCE(t->'raw_payload', '{}'::jsonb)
  FROM jsonb_array_elements(p_txns) AS t
  WHERE NULLIF(btrim(coalesce(t->>'provider_txn_id','')), '') IS NOT NULL
    AND NULLIF(btrim(coalesce(t->>'account_number','')), '') IS NOT NULL
  ON CONFLICT (provider, account_number, provider_txn_id) DO UPDATE SET
    api_verified_at     = COALESCE(public.bank_transactions.api_verified_at, now()),
    api_verified_source = COALESCE(public.bank_transactions.api_verified_source, 'sepay_v2'),
    amount              = COALESCE(public.bank_transactions.amount, EXCLUDED.amount),
    occurred_at         = COALESCE(public.bank_transactions.occurred_at, EXCLUDED.occurred_at),
    sub_account         = COALESCE(public.bank_transactions.sub_account, EXCLUDED.sub_account),
    txn_ref             = COALESCE(public.bank_transactions.txn_ref, EXCLUDED.txn_ref)
  WHERE public.bank_transactions.api_verified_at IS NULL
     OR public.bank_transactions.amount IS NULL
     OR public.bank_transactions.occurred_at IS NULL;
  -- NB: status / club_id / processed_at are deliberately NOT in the SET list → a settled/ignored row is
  -- never reset. The WHERE makes an already-verified-and-complete row a no-op (no write amplification).

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sepay_ingest_verified_transactions(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sepay_ingest_verified_transactions(jsonb) TO service_role;

-- ===========================================================================================
-- 2. pg_cron: POST the reconcile worker every 5 minutes. Secrets read from Vault (no literal here).
--    Apply ONLY after the edge function is deployed.
-- ===========================================================================================
DO $$
BEGIN
  PERFORM cron.unschedule('sepay-reconcile');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not scheduled yet
END $$;

SELECT cron.schedule(
  'sepay-reconcile',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/sepay-reconcile',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'apikey',            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sepay_reconcile_anon_key'),
      'X-Reconcile-Secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sepay_reconcile_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 28000
  );
  $cron$
);
