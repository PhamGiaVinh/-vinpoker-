-- Source-catalog containment: retain the service-only ingest RPC, but omit the
-- legacy cron which targeted a fixed production Edge URL. A future scheduler
-- needs a new owner-gated runtime-config migration and dedicated money UAT.
-- This source-only migration must not be used as a production apply runbook.

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
    now(),
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

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sepay_ingest_verified_transactions(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sepay_ingest_verified_transactions(jsonb) TO service_role;
