-- Historical Tracker display verification (SOURCE-ONLY, CRITICAL/RED).
--
-- This migration never repairs a hand or changes live stack projections. It
-- permits a server-computed, display-only settlement outcome for one completed
-- historical hand only after its saved ending stacks and elimination state
-- exactly prove the recomputed result. Production apply remains owner-gated.

ALTER TABLE public.tournament_settlement_outcomes
  ADD COLUMN IF NOT EXISTS verification_scope text NOT NULL DEFAULT 'chain';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tournament_settlement_outcomes'::regclass
      AND conname = 'tournament_settlement_outcomes_verification_scope_check'
  ) THEN
    ALTER TABLE public.tournament_settlement_outcomes
      ADD CONSTRAINT tournament_settlement_outcomes_verification_scope_check
      CHECK (verification_scope IN ('chain', 'historical_display'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.tournament_settlement_outcomes.verification_scope IS
  'chain changes hand/live-stack state; historical_display is an immutable, target-hand-only display proof.';

-- Chain outcomes depend on later hands. Historical display proofs depend only
-- on their target hand and must not disappear because a later re-entry changes.
CREATE OR REPLACE FUNCTION public.tracker_mark_prior_settlements_stale(p_changed_hand_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tournament_settlement_outcomes o
  SET status = 'stale', updated_at = now()
  FROM public.tournament_hands settled_hand, public.tournament_hands changed_hand
  WHERE changed_hand.id = p_changed_hand_id
    AND settled_hand.id = o.hand_id
    AND settled_hand.tournament_id = changed_hand.tournament_id
    AND (
      (COALESCE(o.verification_scope, 'chain') = 'chain'
        AND settled_hand.hand_number <= changed_hand.hand_number)
      OR (COALESCE(o.verification_scope, 'chain') = 'historical_display'
        AND settled_hand.id = changed_hand.id)
    )
    AND o.status = 'verified';
$$;
REVOKE ALL ON FUNCTION public.tracker_mark_prior_settlements_stale(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Target-only fingerprint. The value never leaves the service boundary and is
-- intentionally independent of later hands, current seats, entries and chips.
CREATE OR REPLACE FUNCTION public.get_tournament_historical_display_source_hash(p_hand_id uuid)
RETURNS TABLE(source_revision bigint, source_chain_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    h.source_revision,
    encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'hand_id', h.id,
            'tournament_id', h.tournament_id,
            'hand_number', h.hand_number,
            'source_revision', h.source_revision,
            'button_seat', h.button_seat,
            'community_cards', h.community_cards,
            'pot_size', h.pot_size,
            'side_pots', h.side_pots,
            'status', h.status,
            'is_voided', h.is_voided,
            'players', COALESCE((
              SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.seat_number, hp.player_id, hp.entry_number)
              FROM public.hand_players hp
              WHERE hp.hand_id = h.id
            ), '[]'::jsonb),
            'actions', COALESCE((
              SELECT jsonb_agg(to_jsonb(ha) ORDER BY ha.action_order, ha.id)
              FROM public.hand_actions ha
              WHERE ha.hand_id = h.id
            ), '[]'::jsonb)
          )::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    )
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_historical_display_source_hash(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_historical_display_source_hash(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.commit_historical_tournament_settlement_display_outcome(
  p_hand_id uuid,
  p_actor_user_id uuid,
  p_expected_source_revision bigint,
  p_expected_source_chain_hash text,
  p_outcome_hash text,
  p_request_hash text,
  p_idempotency_key text,
  p_public_outcome jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hand public.tournament_hands%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_source record;
  v_existing public.tournament_settlement_outcomes%ROWTYPE;
  v_item jsonb;
  v_player_id uuid;
  v_starting numeric;
  v_committed numeric;
  v_award numeric;
  v_refund numeric;
  v_credited numeric;
  v_delta numeric;
  v_external numeric;
  v_ending numeric;
  v_player_count integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 12 THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = '22023';
  END IF;
  IF p_request_hash !~ '^[0-9a-f]{64}$' OR p_outcome_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_hash' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_hand
  FROM public.tournament_hands
  WHERE id = p_hand_id
  FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = v_hand.tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001'; END IF;

  -- Lock the exact proof inputs. This function never updates them.
  PERFORM hp.id
  FROM public.hand_players hp
  WHERE hp.hand_id = p_hand_id
  ORDER BY hp.seat_number, hp.player_id, hp.entry_number
  FOR UPDATE;
  PERFORM ha.id
  FROM public.hand_actions ha
  WHERE ha.hand_id = p_hand_id
  ORDER BY ha.action_order, ha.id
  FOR UPDATE;

  SELECT o.* INTO v_existing
  FROM public.tournament_settlement_outcomes o
  WHERE o.tournament_id = v_hand.tournament_id
    AND o.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.hand_id <> p_hand_id
      OR v_existing.request_hash <> p_request_hash
      OR v_existing.actor_user_id <> p_actor_user_id
      OR COALESCE(v_existing.verification_scope, 'chain') <> 'historical_display' THEN
      RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'status', v_existing.status,
      'hand_id', v_existing.hand_id,
      'settlement_revision', v_existing.settlement_revision,
      'outcome_hash', v_existing.outcome_hash,
      'idempotent', true
    );
  END IF;

  IF NOT (
    public.is_club_owner(p_actor_user_id, v_tournament.club_id)
    OR public.is_club_admin(p_actor_user_id, v_tournament.club_id)
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source
  FROM public.get_tournament_historical_display_source_hash(p_hand_id);
  IF NOT FOUND
    OR v_source.source_revision <> p_expected_source_revision
    OR v_source.source_chain_hash <> p_expected_source_chain_hash
    OR v_hand.source_revision <> p_expected_source_revision THEN
    RAISE EXCEPTION 'stale_source_revision' USING ERRCODE = '40001';
  END IF;

  IF p_public_outcome->>'schemaVersion' <> 'settlement-outcome-v1'
    OR p_public_outcome->>'status' <> 'verified'
    OR p_public_outcome->>'sourceRevision' <> p_expected_source_revision::text
    OR p_public_outcome->>'sourceChainHash' <> p_expected_source_chain_hash
    OR p_public_outcome->>'settlementRevision' <> '1'
    OR p_public_outcome->>'outcomeHash' <> p_outcome_hash
    OR p_public_outcome->>'ruleVersion' <> 'clockwise-first-eligible-winner-left-of-button/v1'
    OR jsonb_typeof(p_public_outcome->'players') <> 'array'
    OR jsonb_typeof(p_public_outcome->'pots') <> 'array'
    OR jsonb_typeof(p_public_outcome->'refunds') <> 'array'
    OR jsonb_typeof(p_public_outcome->'handRanks') <> 'array'
    OR jsonb_typeof(p_public_outcome->'totals') <> 'object' THEN
    RAISE EXCEPTION 'malformed_public_outcome' USING ERRCODE = '22023';
  END IF;
  IF jsonb_path_exists(p_public_outcome, '$.**.privateEvidence')
    OR jsonb_path_exists(p_public_outcome, '$.**.holeCards')
    OR jsonb_path_exists(p_public_outcome, '$.**.holeCardsByPlayer')
    OR jsonb_path_exists(p_public_outcome, '$.**.muckedHoleCardsByPlayer')
    OR jsonb_path_exists(p_public_outcome, '$.**.externalAdjustments')
    OR jsonb_path_exists(p_public_outcome, '$.**.evaluatorInput')
    OR jsonb_path_exists(p_public_outcome, '$.**.correctionNotes')
    OR jsonb_path_exists(p_public_outcome, '$.**.staffIdentity')
    OR jsonb_path_exists(p_public_outcome, '$.**.actor') THEN
    RAISE EXCEPTION 'private_field_in_public_outcome' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_player_count
  FROM public.hand_players
  WHERE hand_id = p_hand_id;
  IF jsonb_array_length(p_public_outcome->'players') <> v_player_count
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_public_outcome->'players') AS p(value)
      GROUP BY p.value->>'playerId'
      HAVING count(*) <> 1
    ) THEN
    RAISE EXCEPTION 'historical_player_projection_mismatch' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_public_outcome->'players') LOOP
    BEGIN
      v_player_id := (v_item->>'playerId')::uuid;
      v_starting := (v_item->>'startingStack')::numeric;
      v_committed := (v_item->>'committedTotal')::numeric;
      v_award := (v_item->>'potAward')::numeric;
      v_refund := (v_item->>'refund')::numeric;
      v_credited := (v_item->>'creditedTotal')::numeric;
      v_delta := (v_item->>'netDelta')::numeric;
      v_external := (v_item->>'externalDelta')::numeric;
      v_ending := (v_item->>'endingStack')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'malformed_historical_player_projection' USING ERRCODE = '22023';
    END;
    IF v_starting < 0 OR v_committed < 0 OR v_award < 0 OR v_refund < 0
      OR v_credited < 0 OR v_ending < 0
      OR v_starting <> trunc(v_starting) OR v_committed <> trunc(v_committed)
      OR v_award <> trunc(v_award) OR v_refund <> trunc(v_refund)
      OR v_credited <> trunc(v_credited) OR v_delta <> trunc(v_delta)
      OR v_external <> trunc(v_external) OR v_ending <> trunc(v_ending)
      OR v_credited <> v_award + v_refund
      OR v_delta <> v_credited - v_committed
      OR v_external <> 0
      OR v_ending <> v_starting + v_delta
      OR NOT EXISTS (
        SELECT 1
        FROM public.hand_players hp
        WHERE hp.hand_id = p_hand_id
          AND hp.player_id = v_player_id
          AND hp.starting_stack = v_starting
          AND hp.ending_stack = v_ending
          AND hp.is_eliminated = (v_ending = 0)
      ) THEN
      RAISE EXCEPTION 'historical_player_projection_mismatch' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = p_hand_id
  ) THEN
    RAISE EXCEPTION 'historical_settlement_already_exists' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tournament_settlement_outcomes(
    tournament_id, hand_id, source_revision, source_chain_hash, settlement_revision,
    outcome_hash, rule_version, status, public_outcome, request_hash, idempotency_key,
    actor_user_id, verification_scope
  ) VALUES (
    v_hand.tournament_id, p_hand_id, p_expected_source_revision,
    p_expected_source_chain_hash, 1, p_outcome_hash,
    p_public_outcome->>'ruleVersion', 'verified', p_public_outcome,
    p_request_hash, p_idempotency_key, p_actor_user_id, 'historical_display'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'verified',
    'hand_id', p_hand_id,
    'settlement_revision', 1,
    'outcome_hash', p_outcome_hash,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_historical_tournament_settlement_display_outcome(
  uuid, uuid, bigint, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_historical_tournament_settlement_display_outcome(
  uuid, uuid, bigint, text, text, text, text, jsonb
) TO service_role;

-- Rollback source: do not DROP applied audit outcomes. To disable the path,
-- revoke service_role execute on the commit RPC and stop routing requests.
