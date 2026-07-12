-- Tracker settlement outcome store (SOURCE-ONLY, CRITICAL/RED).
-- This migration is additive. It does not apply a settlement or repair a hand.
-- Production apply requires the owner-controlled migration runbook.

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS source_revision bigint NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.tournament_settlement_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL,
  source_chain_hash text NOT NULL CHECK (source_chain_hash ~ '^[0-9a-f]{64}$'),
  settlement_revision bigint NOT NULL,
  outcome_hash text NOT NULL CHECK (outcome_hash ~ '^[0-9a-f]{64}$'),
  rule_version text NOT NULL DEFAULT 'clockwise-left-of-button-v1',
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','stale','needs_resettle')),
  public_outcome jsonb NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hand_id, settlement_revision),
  UNIQUE (tournament_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_settlement_outcomes_hand_latest
  ON public.tournament_settlement_outcomes(hand_id, settlement_revision DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_outcomes_source
  ON public.tournament_settlement_outcomes(hand_id, source_revision, source_chain_hash);

ALTER TABLE public.tournament_settlement_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_settlement_outcomes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tournament_settlement_outcomes TO service_role;

CREATE OR REPLACE FUNCTION public.tracker_bump_hand_source_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tournament_hands' THEN
    NEW.source_revision := COALESCE(OLD.source_revision, 1) + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  UPDATE public.tournament_hands
  SET source_revision = source_revision + 1, updated_at = now()
  WHERE id = COALESCE(NEW.hand_id, OLD.hand_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_tracker_hand_source_revision ON public.tournament_hands;
CREATE TRIGGER trg_tracker_hand_source_revision
BEFORE UPDATE OF community_cards, pot_size, side_pots, status, is_voided
ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();

DROP TRIGGER IF EXISTS trg_tracker_hand_player_source_revision ON public.hand_players;
CREATE TRIGGER trg_tracker_hand_player_source_revision
AFTER INSERT OR UPDATE OR DELETE ON public.hand_players
FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();

DROP TRIGGER IF EXISTS trg_tracker_hand_action_source_revision ON public.hand_actions;
CREATE TRIGGER trg_tracker_hand_action_source_revision
AFTER INSERT OR UPDATE OR DELETE ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();

CREATE OR REPLACE FUNCTION public.get_tournament_settlement_source_hash(p_hand_id uuid)
RETURNS TABLE(source_revision bigint, source_chain_hash text, affected_hand_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH target AS (
    SELECT h.tournament_id, h.hand_number
    FROM public.tournament_hands h
    WHERE h.id = p_hand_id
  ), chain AS (
    SELECT h.id, h.hand_number, h.source_revision,
      encode(extensions.digest(
        convert_to(jsonb_build_object(
          'hand_id', h.id,
          'hand_number', h.hand_number,
          'community_cards', h.community_cards,
          'pot_size', h.pot_size,
          'side_pots', h.side_pots,
          'status', h.status,
          'players', COALESCE((SELECT jsonb_agg(to_jsonb(hp) - 'hole_cards' ORDER BY hp.seat_number, hp.player_id)
            FROM public.hand_players hp WHERE hp.hand_id = h.id), '[]'::jsonb),
          'actions', COALESCE((SELECT jsonb_agg(to_jsonb(ha) ORDER BY ha.action_order, ha.id)
            FROM public.hand_actions ha WHERE ha.hand_id = h.id), '[]'::jsonb)
        )::text, 'utf8'), 'sha256'), 'hex') AS hand_hash
    FROM public.tournament_hands h
    JOIN target t ON t.tournament_id = h.tournament_id AND h.hand_number >= t.hand_number
    WHERE NOT COALESCE(h.is_voided, false)
    ORDER BY h.hand_number, h.id
  ), folded AS (
    SELECT max(source_revision) FILTER (WHERE id = p_hand_id) AS revision,
      encode(extensions.digest(convert_to(COALESCE(string_agg(hand_hash, ':' ORDER BY hand_number, id), ''), 'utf8'), 'sha256'), 'hex') AS chain_hash,
      count(*)::integer AS hand_count
    FROM chain
  )
  SELECT revision, chain_hash, hand_count FROM folded;
$$;

REVOKE ALL ON FUNCTION public.get_tournament_settlement_source_hash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_settlement_source_hash(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_tournament_settlement(p_hand_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT o.public_outcome
      - 'sourceChainHash'
      - 'outcomeHash'
      - 'sourceRevision'
      - 'settlementRevision'
      - 'ruleVersion'
    FROM public.tournament_settlement_outcomes o
    JOIN public.tournament_hands h ON h.id = o.hand_id
    JOIN public.tournaments t ON t.id = h.tournament_id
    WHERE o.hand_id = p_hand_id
      AND o.status = 'verified'
      AND o.source_revision = h.source_revision
      AND t.status IN ('live','final_table','completed','finished')
    ORDER BY o.settlement_revision DESC
    LIMIT 1
  ), '{}'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.get_public_tournament_settlement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_settlement(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_tournament_settlement_outcome(
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
  p_final_stacks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hand public.tournament_hands%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_source record;
  v_existing public.tournament_settlement_outcomes%ROWTYPE;
  v_item jsonb;
  v_expected numeric;
  v_next numeric;
  v_result jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 12 THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_existing
  FROM public.tournament_settlement_outcomes o
  WHERE o.hand_id = p_hand_id AND o.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_existing.id, 'status', v_existing.status,
      'settlement_revision', v_existing.settlement_revision, 'outcome_hash', v_existing.outcome_hash);
  END IF;

  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_target_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_hand.tournament_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_club_owner(p_actor_user_id, v_tournament.club_id)
    OR public.is_club_admin(p_actor_user_id, v_tournament.club_id)) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source FROM public.get_tournament_settlement_source_hash(p_hand_id);
  IF v_source.source_revision <> p_expected_source_revision
    OR v_source.source_chain_hash <> p_expected_source_chain_hash
    OR v_hand.source_revision <> p_expected_source_revision THEN
    RAISE EXCEPTION 'stale_source_revision' USING ERRCODE = '40001';
  END IF;
  IF p_public_outcome ? 'privateEvidence' OR p_public_outcome ? 'correctionNotes'
    OR p_public_outcome ? 'staffIdentity' OR p_public_outcome ? 'holeCardsByPlayer'
    OR p_public_outcome ? 'evaluatorInput' OR p_public_outcome ? 'muckedHoleCardsByPlayer' THEN
    RAISE EXCEPTION 'private_field_in_public_outcome' USING ERRCODE = '22023';
  END IF;
  IF p_outcome_hash <> COALESCE(p_public_outcome->>'outcomeHash', '') THEN
    RAISE EXCEPTION 'outcome_hash_mismatch' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_public_outcome->'pots') <> 'array'
    OR jsonb_typeof(p_public_outcome->'players') <> 'array' THEN
    RAISE EXCEPTION 'malformed_public_outcome' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_hands WHERE tournament_id = v_hand.tournament_id
    AND status = 'in_progress' AND NOT COALESCE(is_voided, false)) THEN
    RAISE EXCEPTION 'active_hand_blocks_resettle' USING ERRCODE = 'P0001';
  END IF;

  -- The Edge recomputes and supplies authoritative edits. This RPC is the only
  -- write boundary; every source, chain and live-stack change below commits or
  -- rolls back together.
  IF p_edit ? 'community_cards' THEN
    UPDATE public.tournament_hands
    SET community_cards = ARRAY(SELECT jsonb_array_elements_text(p_edit->'community_cards'))
    WHERE id = p_hand_id;
  END IF;
  IF p_edit ? 'pot_size' THEN
    UPDATE public.tournament_hands SET pot_size = (p_edit->>'pot_size')::numeric WHERE id = p_hand_id;
  END IF;
  IF p_edit ? 'side_pots' THEN
    UPDATE public.tournament_hands SET side_pots = p_edit->'side_pots' WHERE id = p_hand_id;
  END IF;
  IF p_edit ? 'hole_cards' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_edit->'hole_cards') LOOP
      UPDATE public.hand_players
      SET hole_cards = ARRAY(SELECT jsonb_array_elements_text(v_item->'hole_cards'))
      WHERE hand_id = p_hand_id
        AND player_id = (v_item->>'player_id')::uuid
        AND entry_number = COALESCE((v_item->>'entry_number')::integer, 1);
      IF NOT FOUND THEN RAISE EXCEPTION 'hole_player_missing' USING ERRCODE = 'P0001'; END IF;
    END LOOP;
  END IF;
  IF p_edit ? 'actions' THEN
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_edit->'actions') LOOP
      INSERT INTO public.hand_actions(hand_id, player_id, entry_number, street, action_type, action_amount, action_order)
      VALUES(p_hand_id, (v_item->>'player_id')::uuid,
        COALESCE((v_item->>'entry_number')::integer, 1), COALESCE(v_item->>'street', 'preflop'),
        v_item->>'action_type', COALESCE((v_item->>'action_amount')::numeric, 0),
        (v_item->>'action_order')::integer);
    END LOOP;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_hand_changes, '[]'::jsonb)) LOOP
    UPDATE public.hand_players SET
      starting_stack = (v_item->>'starting_stack')::numeric,
      ending_stack = (v_item->>'ending_stack')::numeric,
      is_eliminated = ((v_item->>'ending_stack')::numeric = 0)
    WHERE hand_id = (v_item->>'hand_id')::uuid
      AND player_id = (v_item->>'player_id')::uuid
      AND entry_number = COALESCE((v_item->>'entry_number')::integer, 1);
    IF NOT FOUND THEN RAISE EXCEPTION 'hand_player_change_missing' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_final_stacks, '[]'::jsonb)) LOOP
    v_expected := (v_item->>'expected_current')::numeric;
    v_next := (v_item->>'chip_count')::numeric;
    IF v_expected < 0 OR v_next < 0 THEN RAISE EXCEPTION 'negative_live_stack' USING ERRCODE = '22023'; END IF;
    UPDATE public.tournament_chip_counts
    SET chip_count = v_next, updated_at = now()
    WHERE tournament_id = v_hand.tournament_id
      AND player_id = (v_item->>'player_id')::uuid
      AND entry_number = COALESCE((v_item->>'entry_number')::integer, 1)
      AND chip_count = v_expected;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_live_stack' USING ERRCODE = '40001'; END IF;
    UPDATE public.tournament_seats SET chip_count = v_next
    WHERE tournament_id = v_hand.tournament_id
      AND player_id = (v_item->>'player_id')::uuid
      AND entry_number = COALESCE((v_item->>'entry_number')::integer, 1);
  END LOOP;
  UPDATE public.tournament_hands SET updated_at = now() WHERE id = p_hand_id;
  SELECT * INTO v_source FROM public.get_tournament_settlement_source_hash(p_hand_id);

  INSERT INTO public.tournament_settlement_outcomes(
    tournament_id, hand_id, source_revision, source_chain_hash, settlement_revision,
    outcome_hash, public_outcome, request_hash, idempotency_key, actor_user_id)
  VALUES(v_hand.tournament_id, p_hand_id, v_source.source_revision, v_source.source_chain_hash,
    p_settlement_revision, p_outcome_hash, p_public_outcome, p_request_hash, p_idempotency_key, p_actor_user_id);

  v_result := jsonb_build_object('ok', true, 'status', 'verified', 'hand_id', p_hand_id,
    'settlement_revision', p_settlement_revision, 'outcome_hash', p_outcome_hash);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)
  TO service_role;
