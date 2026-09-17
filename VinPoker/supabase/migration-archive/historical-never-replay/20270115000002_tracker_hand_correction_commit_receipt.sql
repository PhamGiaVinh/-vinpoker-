-- Tracker completed-hand correction commit receipt (SOURCE-ONLY, CRITICAL/RED).
-- The dedicated Edge route recomputes every action and ending stack before it
-- calls this service-role-only wrapper. This migration neither repairs a hand
-- nor enables the client capability.
-- ROLLBACK: revoke this wrapper's service_role grant; do not remove correction
-- receipts or rewrite poker history.

DO $preflight$
BEGIN
  IF to_regclass('public.tournament_settlement_outcomes') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'commit_tournament_settlement_outcome'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.hand_actions'::regclass
        AND tgname = 'trg_guard_tracker_blind_post_amount'
        AND NOT tgisinternal
    ) THEN
    RAISE EXCEPTION 'tracker_hand_correction_commit_dependency_missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.tournament_settlement_outcomes
  ADD COLUMN IF NOT EXISTS correction_reason text;

CREATE OR REPLACE FUNCTION public.commit_tracker_hand_correction_outcome(
  p_hand_id uuid,
  p_actor_user_id uuid,
  p_expected_source_revision bigint,
  p_expected_source_chain_hash text,
  p_settlement_revision bigint,
  p_outcome_hash text,
  p_request_hash text,
  p_idempotency_key text,
  p_public_outcome jsonb,
  p_edit jsonb,
  p_hand_changes jsonb,
  p_final_stacks jsonb,
  p_correction_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := btrim(COALESCE(p_correction_reason, ''));
  v_result jsonb;
  v_outcome_id uuid;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 8 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_correction_reason' USING ERRCODE = '22023';
  END IF;

  v_result := public.commit_tournament_settlement_outcome(
    p_hand_id,
    p_actor_user_id,
    p_expected_source_revision,
    p_expected_source_chain_hash,
    p_settlement_revision,
    p_outcome_hash,
    p_request_hash,
    p_idempotency_key,
    p_public_outcome,
    p_edit,
    p_hand_changes,
    p_final_stacks
  );
  SELECT id INTO v_outcome_id
  FROM public.tournament_settlement_outcomes
  WHERE hand_id = p_hand_id
    AND idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'correction_receipt_missing' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tournament_settlement_outcomes
  SET correction_reason = v_reason, updated_at = now()
  WHERE id = v_outcome_id
    AND (correction_reason IS NULL OR correction_reason = v_reason);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
  END IF;

  RETURN v_result || jsonb_build_object('correction_reason_recorded', true);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_tracker_hand_correction_outcome(
  uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tracker_hand_correction_outcome(
  uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text
) TO service_role;

COMMENT ON FUNCTION public.commit_tracker_hand_correction_outcome(
  uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text
) IS 'Service-only atomic Tracker hand correction with immutable outcome receipt and audit reason.';
