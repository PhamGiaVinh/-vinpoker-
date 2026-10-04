-- Additive follow-up for the merged historical-display completion migration.
-- Rollback: stop dispatcher activation; revoke newly granted service RPCs and restore the previous function definitions from the prior migration snapshot.
ALTER TABLE public.tracker_hand_blind_correction_audit ADD COLUMN IF NOT EXISTS selected_level_id uuid;
ALTER TABLE public.tracker_hand_blind_correction_audit ADD COLUMN IF NOT EXISTS selected_snapshot jsonb;
ALTER TABLE public.tracker_hand_blind_correction_audit ADD COLUMN IF NOT EXISTS source_kind text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_hand_blind_correction_audit_source_kind_check'
      AND conrelid = 'public.tracker_hand_blind_correction_audit'::regclass) THEN
    ALTER TABLE public.tracker_hand_blind_correction_audit
      ADD CONSTRAINT tracker_hand_blind_correction_audit_source_kind_check
      CHECK (source_kind IS NULL OR source_kind = 'owner_admin_selected_snapshot');
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,text,text,jsonb);
CREATE OR REPLACE FUNCTION public.tracker_enqueue_historical_display(p_hand_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hand record;
BEGIN
  SELECT id, status, is_voided, source_revision INTO v_hand
  FROM public.tournament_hands WHERE id = p_hand_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_hand.status = 'completed' AND NOT COALESCE(v_hand.is_voided, false) THEN
    UPDATE public.tracker_historical_display_queue SET status = 'cancelled', lease_token = NULL,
      lease_until = NULL, updated_at = now()
    WHERE hand_id = p_hand_id AND source_revision <> v_hand.source_revision
      AND status IN ('pending','processing');
    INSERT INTO public.tracker_historical_display_queue(hand_id, source_revision, status, attempts,
      next_attempt_at, lease_token, lease_until, last_error_code, enqueued_at, updated_at, completed_at)
    VALUES (v_hand.id, v_hand.source_revision, 'pending', 0, now(), NULL, NULL, NULL, now(), now(), NULL)
    ON CONFLICT (hand_id, source_revision) DO NOTHING;
  ELSE
    UPDATE public.tracker_historical_display_queue SET status = 'cancelled', lease_token = NULL,
      lease_until = NULL, last_error_code = NULL, updated_at = now()
    WHERE hand_id = p_hand_id AND status IN ('pending','processing');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tracker_enqueue_historical_display_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.source_revision IS NOT DISTINCT FROM OLD.source_revision
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.is_voided IS NOT DISTINCT FROM OLD.is_voided THEN
    RETURN NEW;
  END IF;
  PERFORM public.tracker_enqueue_historical_display(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.get_tracker_historical_display_snapshot(
  p_hand_id uuid, p_tournament_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
WITH target AS (
  SELECT h.* FROM public.tournament_hands h
  WHERE h.id = p_hand_id AND (p_tournament_id IS NULL OR h.tournament_id = p_tournament_id)
), player_rows AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(hp) ORDER BY hp.seat_number, hp.player_id, hp.entry_number), '[]'::jsonb) AS items
  FROM public.hand_players hp JOIN target h ON h.id = hp.hand_id
), action_rows AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(ha) ORDER BY ha.action_order, ha.id), '[]'::jsonb) AS items
  FROM public.hand_actions ha JOIN target h ON h.id = ha.hand_id
), source AS (
  SELECT h.source_revision,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'hand_id', h.id, 'tournament_id', h.tournament_id, 'hand_number', h.hand_number,
      'source_revision', h.source_revision, 'button_seat', h.button_seat,
      'community_cards', h.community_cards, 'pot_size', h.pot_size, 'side_pots', h.side_pots,
      'status', h.status, 'is_voided', h.is_voided,
      'tracker_level_id', h.tracker_level_id, 'tracker_level_number', h.tracker_level_number,
      'tracker_small_blind', h.tracker_small_blind, 'tracker_big_blind', h.tracker_big_blind,
      'tracker_bba', h.tracker_bba, 'tracker_is_break', h.tracker_is_break,
      'tracker_blind_evidence', h.tracker_blind_evidence,
      'players', (SELECT items FROM player_rows), 'actions', (SELECT items FROM action_rows)
    )::text, 'utf8'), 'sha256'), 'hex') AS source_chain_hash
  FROM target h
)
SELECT jsonb_build_object('hand', to_jsonb(h), 'players', pr.items, 'actions', ar.items,
  'sourceRevision', s.source_revision, 'sourceChainHash', s.source_chain_hash)
FROM target h CROSS JOIN player_rows pr CROSS JOIN action_rows ar CROSS JOIN source s;
$$;

CREATE OR REPLACE FUNCTION public.get_tracker_historical_display_commit_receipt(
  p_hand_id uuid, p_tournament_id uuid, p_actor_user_id uuid, p_idempotency_key text,
  p_expected_source_revision bigint, p_expected_source_chain_hash text, p_expected_outcome_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_outcome public.tournament_settlement_outcomes%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_outcome FROM public.tournament_settlement_outcomes o
  WHERE o.hand_id = p_hand_id AND o.tournament_id = p_tournament_id
    AND o.idempotency_key = p_idempotency_key FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_outcome.actor_kind <> 'owner_admin' OR v_outcome.actor_user_id <> p_actor_user_id
    OR v_outcome.source_revision <> p_expected_source_revision
    OR v_outcome.source_chain_hash <> p_expected_source_chain_hash
    OR v_outcome.outcome_hash <> p_expected_outcome_hash THEN
    RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('ok', true, 'idempotent', true,
    'settlement_revision', v_outcome.settlement_revision, 'source_revision', v_outcome.source_revision,
    'outcome_hash', v_outcome.outcome_hash);
END $$;

CREATE OR REPLACE FUNCTION public.claim_tracker_historical_display_jobs(p_limit integer DEFAULT 20)
RETURNS TABLE(hand_id uuid, source_revision bigint, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid_batch_limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT q.hand_id, q.source_revision FROM public.tracker_historical_display_queue q
    JOIN public.tournament_hands h ON h.id = q.hand_id AND h.source_revision = q.source_revision
    WHERE ((q.status = 'pending' AND q.next_attempt_at <= now())
      OR (q.status = 'processing' AND q.lease_until < now()))
      AND h.status = 'completed' AND NOT COALESCE(h.is_voided, false)
    ORDER BY q.next_attempt_at, q.enqueued_at, q.hand_id, q.source_revision
    LIMIT p_limit FOR UPDATE OF q SKIP LOCKED
  ), claimed AS (
    UPDATE public.tracker_historical_display_queue q SET status = 'processing',
      attempts = q.attempts + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    FROM candidates c WHERE q.hand_id = c.hand_id AND q.source_revision = c.source_revision
    RETURNING q.hand_id, q.source_revision, q.lease_token
  ) SELECT * FROM claimed;
END $$;

CREATE OR REPLACE FUNCTION public.correct_tracker_historical_hand_blinds(
  p_hand_id uuid, p_actor_user_id uuid, p_expected_source_revision bigint,
  p_level_id uuid, p_level_number integer, p_small_blind bigint, p_big_blind bigint, p_ante bigint,
  p_reason text, p_idempotency_key text, p_evidence jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hand public.tournament_hands%ROWTYPE;
  v_level_id uuid;
  v_club_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_existing public.tracker_hand_blind_correction_audit%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 8 OR length(trim(COALESCE(p_idempotency_key, ''))) < 12
    OR COALESCE(jsonb_typeof(p_evidence) <> 'object' OR p_evidence = '{}'::jsonb, true)
    OR p_level_number IS NULL OR p_level_number < 1 OR p_small_blind IS NULL OR p_small_blind <= 0
    OR p_big_blind IS NULL OR p_big_blind <= p_small_blind OR p_ante IS NULL OR p_ante < 0 THEN
    RAISE EXCEPTION 'invalid_blind_correction_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_existing FROM public.tracker_hand_blind_correction_audit
   WHERE hand_id = p_hand_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.expected_source_revision IS DISTINCT FROM p_expected_source_revision
      OR v_existing.selected_level_id IS DISTINCT FROM p_level_id
      OR v_existing.selected_snapshot IS DISTINCT FROM jsonb_build_object('levelId', p_level_id, 'levelNumber', p_level_number,
        'smallBlind', p_small_blind, 'bigBlind', p_big_blind, 'ante', p_ante, 'isBreak', false)
      OR v_existing.source_kind IS DISTINCT FROM 'owner_admin_selected_snapshot'
      OR v_existing.reason IS DISTINCT FROM trim(p_reason) OR v_existing.evidence IS DISTINCT FROM p_evidence THEN
      RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'source_revision', v_existing.resulting_source_revision);
  END IF;
  IF v_hand.source_revision <> p_expected_source_revision THEN
    RAISE EXCEPTION 'stale_source_revision' USING ERRCODE = '40001';
  END IF;
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = v_hand.tournament_id;
  IF NOT FOUND OR NOT (public.is_club_owner(p_actor_user_id, v_club_id)
    OR public.is_club_admin(p_actor_user_id, v_club_id)) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Keep every existing non-null field. The level row only proves tournament
  -- membership; the owner supplies and audits the exact historical values.
  IF v_hand.tracker_small_blind > 0 AND v_hand.tracker_big_blind > v_hand.tracker_small_blind
    AND COALESCE(v_hand.tracker_bba, -1) >= 0 AND v_hand.tracker_level_id IS NOT NULL
    AND COALESCE(v_hand.tracker_level_number, 0) > 0 AND NOT COALESCE(v_hand.tracker_is_break, true) THEN
    RAISE EXCEPTION 'blind_snapshot_already_present' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_level_id FROM public.tournament_levels
  WHERE id = p_level_id AND tournament_id = v_hand.tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_tournament_level_snapshot' USING ERRCODE = '22023';
  END IF;
  IF (v_hand.tracker_level_id IS NOT NULL AND v_hand.tracker_level_id IS DISTINCT FROM p_level_id)
    OR (v_hand.tracker_level_number IS NOT NULL AND v_hand.tracker_level_number IS DISTINCT FROM p_level_number)
    OR (v_hand.tracker_small_blind IS NOT NULL AND v_hand.tracker_small_blind IS DISTINCT FROM p_small_blind)
    OR (v_hand.tracker_big_blind IS NOT NULL AND v_hand.tracker_big_blind IS DISTINCT FROM p_big_blind)
    OR (v_hand.tracker_bba IS NOT NULL AND v_hand.tracker_bba IS DISTINCT FROM p_ante)
    OR v_hand.tracker_is_break IS TRUE THEN
    INSERT INTO public.tracker_historical_display_queue(hand_id, source_revision, status, last_error_code,
      lease_token, lease_until, updated_at)
    VALUES (p_hand_id, v_hand.source_revision, 'needs_attention', 'blind_snapshot_conflict', NULL, NULL, now())
    ON CONFLICT (hand_id, source_revision) DO UPDATE SET status = 'needs_attention',
      last_error_code = 'blind_snapshot_conflict', lease_token = NULL, lease_until = NULL, updated_at = now();
    RETURN jsonb_build_object('ok', false, 'status', 'needs_attention', 'code', 'blind_snapshot_conflict');
  END IF;
  v_before := jsonb_build_object('levelId', v_hand.tracker_level_id, 'levelNumber', v_hand.tracker_level_number,
    'smallBlind', v_hand.tracker_small_blind, 'bigBlind', v_hand.tracker_big_blind,
    'ante', v_hand.tracker_bba, 'isBreak', v_hand.tracker_is_break,
    'blindEvidence', v_hand.tracker_blind_evidence);
  UPDATE public.tournament_hands SET tracker_level_id = COALESCE(tracker_level_id, p_level_id),
    tracker_level_number = COALESCE(tracker_level_number, p_level_number),
    tracker_small_blind = COALESCE(tracker_small_blind, p_small_blind),
    tracker_big_blind = COALESCE(tracker_big_blind, p_big_blind),
    tracker_bba = COALESCE(tracker_bba, p_ante), tracker_is_break = COALESCE(tracker_is_break, false),
    tracker_blind_evidence = COALESCE(tracker_blind_evidence, jsonb_build_object(
      'kind', 'owner_admin_selected_snapshot', 'selectedSnapshot', jsonb_build_object('levelId', p_level_id,
        'levelNumber', p_level_number, 'smallBlind', p_small_blind, 'bigBlind', p_big_blind,
        'ante', p_ante, 'isBreak', false), 'evidence', p_evidence, 'reason', trim(p_reason),
      'actorUserId', p_actor_user_id))
  WHERE id = p_hand_id RETURNING * INTO v_hand;
  v_after := jsonb_build_object('levelId', v_hand.tracker_level_id, 'levelNumber', v_hand.tracker_level_number,
    'smallBlind', v_hand.tracker_small_blind, 'bigBlind', v_hand.tracker_big_blind,
    'ante', v_hand.tracker_bba, 'isBreak', v_hand.tracker_is_break,
    'blindEvidence', v_hand.tracker_blind_evidence);
  INSERT INTO public.tracker_hand_blind_correction_audit(hand_id, expected_source_revision,
    resulting_source_revision, actor_user_id, selected_level_id, selected_snapshot, source_kind,
    idempotency_key, reason, evidence, before_snapshot, after_snapshot)
  VALUES (p_hand_id, p_expected_source_revision, v_hand.source_revision, p_actor_user_id,
    p_level_id, jsonb_build_object('levelId', p_level_id, 'levelNumber', p_level_number,
      'smallBlind', p_small_blind, 'bigBlind', p_big_blind, 'ante', p_ante, 'isBreak', false),
    'owner_admin_selected_snapshot', p_idempotency_key, trim(p_reason), p_evidence, v_before, v_after);
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'source_revision', v_hand.source_revision);
END $$;

CREATE OR REPLACE FUNCTION public.get_tracker_historical_display_queue_status(p_tournament_id uuid)
RETURNS TABLE(hand_id uuid, hand_number integer, source_revision bigint, queue_status text,
  last_error_code text, enqueued_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR NOT (public.is_club_owner(auth.uid(), v_club_id)
    OR public.is_club_admin(auth.uid(), v_club_id)) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT h.id, h.hand_number, h.source_revision,
    CASE WHEN h.tracker_small_blind IS NULL OR h.tracker_small_blind <= 0
        OR h.tracker_big_blind IS NULL OR h.tracker_big_blind <= h.tracker_small_blind
        OR h.tracker_bba IS NULL OR h.tracker_bba < 0 OR h.tracker_level_id IS NULL
      THEN 'missing_blind'
      WHEN q.status = 'needs_attention'
        OR (q.status IN ('pending','processing') AND now() - q.enqueued_at > interval '10 seconds')
      THEN 'needs_attention'
      WHEN q.status IN ('pending','processing') THEN 'pending'
      WHEN EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes stale
        WHERE stale.hand_id = h.id AND stale.verification_scope = 'historical_display' AND stale.status = 'stale')
      THEN 'stale'
      ELSE 'missing_outcome' END, q.last_error_code,
    q.enqueued_at, q.updated_at
  FROM public.tournament_hands h LEFT JOIN public.tracker_historical_display_queue q
    ON q.hand_id = h.id AND q.source_revision = h.source_revision
  LEFT JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) current_source ON true
  WHERE h.tournament_id = p_tournament_id AND h.status = 'completed' AND NOT COALESCE(h.is_voided, false)
    AND (h.tracker_small_blind IS NULL OR h.tracker_small_blind <= 0
      OR h.tracker_big_blind IS NULL OR h.tracker_big_blind <= h.tracker_small_blind
      OR h.tracker_bba IS NULL OR h.tracker_bba < 0 OR h.tracker_level_id IS NULL
      OR q.status IN ('needs_attention','pending','processing')
      OR NOT EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id = h.id
        AND o.status = 'verified' AND o.verification_scope = 'historical_display'
        AND o.source_revision = h.source_revision
        AND o.source_chain_hash = current_source.source_chain_hash));
END $$;

CREATE OR REPLACE FUNCTION public.get_public_tournament_table_history_v2(
  p_tournament_id uuid, p_tournament_table_id uuid, p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH scope AS (
  SELECT tt.id FROM public.tournament_tables tt JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE tt.id = p_tournament_table_id AND tt.tournament_id = p_tournament_id AND t.deleted_at IS NULL
), rows AS (
  SELECT h.id, h.table_session_id, h.hand_number, h.created_at, h.community_cards, h.pot_size,
    h.button_seat, h.source_revision, h.tracker_small_blind, h.tracker_big_blind,
    h.tracker_level_number, h.tracker_bba
  FROM public.tournament_hands h JOIN scope s ON s.id = h.tournament_table_id
  WHERE h.tournament_id = p_tournament_id AND h.status = 'completed'
    AND NOT COALESCE(h.is_voided, false)
    AND (p_before_created_at IS NULL OR (h.created_at, h.id) < (p_before_created_at, p_before_id))
  ORDER BY h.created_at DESC, h.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
), page AS (
  SELECT * FROM rows ORDER BY created_at DESC, id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50)
), tail AS (
  SELECT created_at, id FROM rows ORDER BY created_at DESC, id DESC
  OFFSET LEAST(GREATEST(p_limit, 1), 50) LIMIT 1
), current_sources AS (
  SELECT p.id, historical.source_revision AS historical_revision,
    historical.source_chain_hash AS historical_hash,
    chain.source_revision AS chain_revision, chain.source_chain_hash AS chain_hash
  FROM page p
  LEFT JOIN LATERAL public.get_tournament_historical_display_source_hash(p.id) historical ON true
  LEFT JOIN LATERAL public.get_tournament_settlement_source_hash(p.id) chain ON true
), page_results AS (
  SELECT p.*, outcome.public_outcome,
    CASE WHEN p.tracker_small_blind > 0 AND p.tracker_big_blind > p.tracker_small_blind
      AND p.tracker_bba >= 0 AND outcome.public_outcome IS NOT NULL AND recipient.items IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(outcome.public_outcome->'pots') checked_pot
        JOIN LATERAL jsonb_array_elements(checked_pot.value->'allocations') checked_allocation ON true
        WHERE (checked_allocation.value->>'amount')::bigint > 0
          AND (SELECT count(*) FROM public.hand_players checked_player WHERE checked_player.hand_id = p.id
            AND checked_player.player_id::text = checked_allocation.value->>'winnerId') <> 1
      ) THEN jsonb_build_object('status','verified','recipients',recipient.items)
      ELSE jsonb_build_object('status','pending') END AS result
  FROM page p JOIN current_sources current_source ON current_source.id = p.id
  LEFT JOIN LATERAL (
    SELECT o.public_outcome FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = p.id AND o.status = 'verified'
      AND ((o.verification_scope = 'historical_display'
          AND o.source_revision = current_source.historical_revision
          AND o.source_chain_hash = current_source.historical_hash)
        OR (o.verification_scope = 'chain'
          AND o.source_revision = current_source.chain_revision
          AND o.source_chain_hash = current_source.chain_hash))
    ORDER BY CASE WHEN o.verification_scope = 'historical_display' THEN 0 ELSE 1 END,
      o.settlement_revision DESC LIMIT 1
  ) outcome ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
      'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
      'holeCards',COALESCE(hp.hole_cards,'[]'::jsonb),
      'potAward',(player.value->>'potAward')::bigint,'netDelta',(player.value->>'netDelta')::bigint,
      'potKinds',(SELECT COALESCE(jsonb_agg(DISTINCT pot.value->>'kind'),'[]'::jsonb)
        FROM jsonb_array_elements(outcome.public_outcome->'pots') pot
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(pot.value->'allocations') allocation
          WHERE allocation.value->>'winnerId' = hp.player_id::text AND (allocation.value->>'amount')::bigint > 0))
    ) ORDER BY hp.seat_number,hp.player_id) AS items
    FROM jsonb_array_elements(outcome.public_outcome->'players') player
    JOIN public.hand_players hp ON hp.hand_id = p.id AND hp.player_id::text = player.value->>'playerId'
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(outcome.public_outcome->'pots') pot
      JOIN LATERAL jsonb_array_elements(pot.value->'allocations') allocation ON true
      WHERE allocation.value->>'winnerId' = hp.player_id::text AND (allocation.value->>'amount')::bigint > 0)
  ) recipient ON true
)
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50
    OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN jsonb_build_object('error','invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access','revoked','items','[]'::jsonb)
  WHEN NOT EXISTS (SELECT 1 FROM scope) THEN jsonb_build_object('error','table_out_of_scope')
  ELSE jsonb_build_object('access','public',
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'handId',p.id,'tableSessionId',p.table_session_id,'handNumber',p.hand_number,'createdAt',p.created_at,
      'board',COALESCE(p.community_cards,'[]'::jsonb),'pot',p.pot_size,'buttonSeat',p.button_seat,
      'smallBlind',p.tracker_small_blind,'bigBlind',p.tracker_big_blind,'levelNumber',p.tracker_level_number,
      'ante',p.tracker_bba,'result',p.result) ORDER BY p.created_at DESC,p.id DESC) FROM page_results p),'[]'::jsonb),
    'nextCursor',CASE WHEN EXISTS (SELECT 1 FROM tail) THEN
      (SELECT jsonb_build_object('createdAt',p.created_at,'id',p.id) FROM page p ORDER BY p.created_at ASC,p.id ASC LIMIT 1)
      ELSE NULL END)
END;
$$;

ALTER FUNCTION public.get_tracker_historical_display_snapshot(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tracker_historical_display_snapshot(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracker_historical_display_snapshot(uuid,uuid) TO service_role;
ALTER FUNCTION public.get_tracker_historical_display_commit_receipt(uuid,uuid,uuid,text,bigint,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tracker_historical_display_commit_receipt(uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracker_historical_display_commit_receipt(uuid,uuid,uuid,text,bigint,text,text) TO service_role;
ALTER FUNCTION public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,integer,bigint,bigint,bigint,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,integer,bigint,bigint,bigint,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,integer,bigint,bigint,bigint,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid) TO anon, authenticated, service_role;

INSERT INTO public.tracker_historical_display_queue(hand_id, source_revision)
SELECT h.id, h.source_revision
FROM public.tournament_hands h
JOIN public.tournament_tables tt ON tt.id = h.tournament_table_id
JOIN public.tournaments t ON t.id = h.tournament_id AND t.deleted_at IS NULL
JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) current_source ON true
WHERE h.status = 'completed' AND NOT COALESCE(h.is_voided, false)
  AND NOT EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = h.id AND o.status = 'verified' AND o.verification_scope = 'historical_display'
      AND o.source_revision = current_source.source_revision
      AND o.source_chain_hash = current_source.source_chain_hash)
ON CONFLICT (hand_id, source_revision) DO NOTHING;
