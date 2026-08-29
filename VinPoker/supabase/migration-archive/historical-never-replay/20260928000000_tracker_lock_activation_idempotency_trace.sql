-- Tracker Session A — write-path hardening for live hand input.
--
-- TWO concerns, one migration (both source-only; NOT applied here):
--   1) Idempotency + trace plumbing for record_action: a network retry / double-tap
--      of the SAME action no longer duplicates or 500s — it returns the cached
--      result. A trace_id is threaded for later (P1) observability.
--   2) ACTIVATE the single-operator hand lock. Today `locked_by_user_id` is never
--      claimed (only released to NULL), so the lock check in show_hole_cards /
--      update_community_cards / delete_last_action never fires. This migration:
--        - makes heartbeat_lock CLAIM the lock (with a 5-minute TTL takeover),
--        - makes record_action claim it on-write,
--        - routes all four enforcing RPCs through ONE TTL-aware predicate so a
--          stale lock (departed operator) never freezes a legitimate handoff.
--
-- DEPLOY ORDER (critical): the tournament-live-update Edge function forwards the
-- new record_action params (p_user_id / p_idempotency_key / p_trace_id). The Edge
-- MUST be deployed only AFTER this migration is live — calling the OLD signature
-- with the new params would reject. A push to main auto-redeploys Edge, so the
-- accompanying PR must NOT be merged before this is applied.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE / DROP-all-overloads. No old migration edited.

-- ============================================================================
-- (a) hand_actions: idempotency_key + trace_id (nullable → backward-compatible)
-- ============================================================================
ALTER TABLE public.hand_actions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.hand_actions ADD COLUMN IF NOT EXISTS trace_id TEXT;

-- Dedupe scope = one key per hand. Partial index → existing/un-keyed rows (NULL)
-- stay unconstrained; only keyed inserts are deduped.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hand_actions_idempotency
  ON public.hand_actions (hand_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- (b) Shared lock helpers — single source of the TTL
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tracker_lock_ttl()
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT INTERVAL '5 minutes'
$$;

-- TRUE only when the hand is held by a DIFFERENT user whose lock is still FRESH
-- (within TTL). NULL owner, same user, or a stale lock never blocks → handoffs OK.
CREATE OR REPLACE FUNCTION public.tracker_lock_blocks(
  p_locked_by uuid,
  p_locked_at timestamptz,
  p_user_id uuid
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user_id IS NOT NULL
     AND p_locked_by IS NOT NULL
     AND p_locked_by <> p_user_id
     AND p_locked_at IS NOT NULL
     AND p_locked_at > now() - public.tracker_lock_ttl()
$$;

-- ============================================================================
-- (c) heartbeat_lock → CLAIM + refresh + TTL takeover
--     (was: only extended locked_at; never set an owner → lock was inert)
--     Preserves SECURITY DEFINER; adds SET search_path = public (hardening).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.heartbeat_lock(
  p_hand_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_locked_at TIMESTAMPTZ;
BEGIN
  SELECT status, locked_by_user_id, locked_at
  INTO v_status, v_locked_by, v_locked_at
  FROM public.tournament_hands WHERE id = p_hand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  -- Claim / refresh / takeover when unowned, self-owned, or stale.
  IF v_locked_by IS NULL
     OR v_locked_by = p_user_id
     OR v_locked_at IS NULL
     OR v_locked_at <= now() - public.tracker_lock_ttl()
  THEN
    UPDATE public.tournament_hands
    SET locked_by_user_id = p_user_id, locked_at = NOW(), updated_at = NOW()
    WHERE id = p_hand_id;
    RETURN jsonb_build_object('status', 'success', 'locked_by', p_user_id, 'locked_at', NOW());
  END IF;

  -- Held by someone else with a still-fresh lock.
  RETURN jsonb_build_object('error', 'Unauthorized: Hand is locked by another user', 'locked_by', v_locked_by);
END;
$$;

-- ============================================================================
-- (d) record_action → drop ALL overloads, recreate with a VALID signature
--     (non-default params first), idempotency-first ordering, on-write lock claim.
--     Preserves SECURITY INVOKER. New optional params are matched BY NAME by the
--     Edge, so reordering the existing ones is safe.
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'record_action' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE FUNCTION public.record_action(
  p_hand_id UUID,
  p_player_id UUID,
  p_action_type TEXT,
  p_action_order INTEGER,
  p_entry_number INTEGER DEFAULT 1,
  p_street TEXT DEFAULT 'preflop',
  p_action_amount INTEGER DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_locked_at TIMESTAMPTZ;
  v_existing public.hand_actions%ROWTYPE;
BEGIN
  -- 1) Basics (unchanged semantics)
  SELECT status INTO v_status FROM public.tournament_hands WHERE id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found', 'trace_id', p_trace_id);
  END IF;
  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress', 'trace_id', p_trace_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hand_players
    WHERE hand_id = p_hand_id AND player_id = p_player_id AND entry_number = p_entry_number
  ) THEN
    RETURN jsonb_build_object('error', 'Player not found in this hand', 'trace_id', p_trace_id);
  END IF;
  IF p_action_order IS NULL OR p_action_order < 1 THEN
    RETURN jsonb_build_object('error', 'Invalid action_order', 'trace_id', p_trace_id);
  END IF;

  -- 2) Idempotency BEFORE lock: a retry of the same action always returns the
  --    cached verdict, regardless of who holds the lock now.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.hand_actions
    WHERE hand_id = p_hand_id AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      IF v_existing.player_id = p_player_id
         AND v_existing.entry_number = p_entry_number
         AND COALESCE(v_existing.street, 'preflop') = COALESCE(p_street, 'preflop')
         AND v_existing.action_type = p_action_type
         AND COALESCE(v_existing.action_amount, 0) = COALESCE(p_action_amount, 0)
         AND v_existing.action_order = p_action_order
      THEN
        RETURN jsonb_build_object('status', 'success', 'duplicate', true, 'trace_id', p_trace_id);
      ELSE
        RETURN jsonb_build_object('error', 'idempotency_key_conflict', 'trace_id', p_trace_id);
      END IF;
    END IF;
  END IF;

  -- 3) Lock claim on-write (TTL-aware). FOR UPDATE serialises concurrent writers
  --    on the same hand, so the first action also claims the lock.
  SELECT locked_by_user_id, locked_at INTO v_locked_by, v_locked_at
  FROM public.tournament_hands WHERE id = p_hand_id
  FOR UPDATE;
  IF public.tracker_lock_blocks(v_locked_by, v_locked_at, p_user_id) THEN
    RETURN jsonb_build_object('error', 'Hand is locked by another tracker', 'locked_by', v_locked_by, 'trace_id', p_trace_id);
  END IF;
  IF p_user_id IS NOT NULL THEN
    UPDATE public.tournament_hands
    SET locked_by_user_id = p_user_id, locked_at = NOW(), updated_at = NOW()
    WHERE id = p_hand_id;
  END IF;

  -- 4) Insert. A same-key race → duplicate; a same-(hand,action_order) collision →
  --    structured conflict (not a raw 500).
  BEGIN
    INSERT INTO public.hand_actions
      (hand_id, player_id, entry_number, street, action_type, action_amount, action_order, idempotency_key, trace_id)
    VALUES
      (p_hand_id, p_player_id, p_entry_number, p_street, p_action_type, p_action_amount, p_action_order, p_idempotency_key, p_trace_id);
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.hand_actions
      WHERE hand_id = p_hand_id AND idempotency_key = p_idempotency_key
    ) THEN
      RETURN jsonb_build_object('status', 'success', 'duplicate', true, 'trace_id', p_trace_id);
    END IF;
    RETURN jsonb_build_object(
      'error', 'action_order_conflict',
      'reason', 'Another action already exists at this action_order',
      'trace_id', p_trace_id
    );
  END;

  RETURN jsonb_build_object('status', 'success', 'trace_id', p_trace_id);
END;
$$;

-- ============================================================================
-- (e) Retrofit the 3 peer enforcers to the shared TTL-aware predicate, so that
--     activating the claim never freezes a legitimate handoff on a stale lock.
--     CREATE OR REPLACE (same signatures) preserves their grants/owner/mode.
-- ============================================================================

-- update_community_cards (SECURITY INVOKER preserved)
CREATE OR REPLACE FUNCTION public.update_community_cards(
  p_hand_id UUID,
  p_community_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_locked_at TIMESTAMPTZ;
  v_validation TEXT;
BEGIN
  SELECT status, locked_by_user_id, locked_at INTO v_status, v_locked_by, v_locked_at
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress', 'status', v_status);
  END IF;

  IF public.tracker_lock_blocks(v_locked_by, v_locked_at, p_user_id) THEN
    RETURN jsonb_build_object('error', 'Hand is locked by another tracker', 'locked_by', v_locked_by);
  END IF;

  v_validation := public.validate_cards(p_community_cards);
  IF v_validation != 'ok' THEN
    RETURN jsonb_build_object('error', v_validation);
  END IF;

  IF jsonb_array_length(p_community_cards) NOT IN (0, 3, 4, 5) THEN
    RETURN jsonb_build_object('error', 'Invalid number of community cards', 'count', jsonb_array_length(p_community_cards));
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = p_community_cards,
      updated_at = NOW(),
      locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- show_hole_cards (SECURITY INVOKER preserved; FOR UPDATE on hand_players kept)
CREATE OR REPLACE FUNCTION public.show_hole_cards(
  p_hand_id UUID,
  p_player_hole_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_locked_at TIMESTAMPTZ;
  v_community_cards JSONB;
  v_validation TEXT;
  v_item JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_cards JSONB;
BEGIN
  SELECT status, locked_by_user_id, locked_at, community_cards
  INTO v_status, v_locked_by, v_locked_at, v_community_cards
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  IF public.tracker_lock_blocks(v_locked_by, v_locked_at, p_user_id) THEN
    RETURN jsonb_build_object('error', 'Hand is locked by another tracker');
  END IF;

  -- Lock all player rows for this hand to prevent race condition
  PERFORM 1 FROM public.hand_players
  WHERE hand_id = p_hand_id
  FOR UPDATE;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_player_hole_cards) LOOP
    v_player_id := (v_item ->> 'player_id')::UUID;
    v_entry_number := COALESCE((v_item ->> 'entry_number')::INTEGER, 1);
    v_cards := v_item -> 'hole_cards';

    v_validation := public.validate_cards(v_cards);
    IF v_validation != 'ok' THEN
      RETURN jsonb_build_object('error', v_validation);
    END IF;

    IF jsonb_array_length(v_cards) != 2 THEN
      RETURN jsonb_build_object('error', 'Must provide exactly 2 hole cards per player');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.hand_players
      WHERE hand_id = p_hand_id AND player_id = v_player_id AND entry_number = v_entry_number
    ) THEN
      RETURN jsonb_build_object('error', 'Player not found in this hand');
    END IF;

    -- Cross-validate: check against community cards + other players' hole cards
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_cards) AS new_card(c1)
      WHERE c1 IN (
        SELECT jsonb_array_elements_text(v_community_cards)
        UNION
        SELECT jsonb_array_elements_text(hp.hole_cards)
        FROM public.hand_players hp
        WHERE hp.hand_id = p_hand_id
          AND hp.player_id != v_player_id
          AND hp.hole_cards IS NOT NULL
          AND hp.hole_cards != '[]'::jsonb
      )
    ) THEN
      RETURN jsonb_build_object('error', 'Card already used by another player or in community cards');
    END IF;

    UPDATE public.hand_players
    SET hole_cards = v_cards
    WHERE hand_id = p_hand_id AND player_id = v_player_id AND entry_number = v_entry_number;
  END LOOP;

  -- Auto-extend lock (heartbeat)
  UPDATE public.tournament_hands
  SET updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- delete_last_action (SECURITY INVOKER preserved; FOR UPDATE on hand_actions kept)
CREATE OR REPLACE FUNCTION public.delete_last_action(
  p_hand_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_locked_at TIMESTAMPTZ;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_street TEXT;
  v_action_type TEXT;
  v_action_amount INTEGER;
  v_action_order INTEGER;
BEGIN
  SELECT status, locked_by_user_id, locked_at INTO v_status, v_locked_by, v_locked_at
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  IF public.tracker_lock_blocks(v_locked_by, v_locked_at, p_user_id) THEN
    RETURN jsonb_build_object('error', 'Hand is locked by another tracker');
  END IF;

  -- Lock this hand's action rows to avoid a concurrent-delete race.
  PERFORM 1 FROM public.hand_actions WHERE hand_id = p_hand_id FOR UPDATE;

  -- Delete only the single most-recent action (highest action_order).
  DELETE FROM public.hand_actions
  WHERE id = (
    SELECT id FROM public.hand_actions
    WHERE hand_id = p_hand_id
    ORDER BY action_order DESC, created_at DESC
    LIMIT 1
  )
  RETURNING player_id, entry_number, street, action_type, action_amount, action_order
  INTO v_player_id, v_entry_number, v_street, v_action_type, v_action_amount, v_action_order;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'No action to undo');
  END IF;

  -- Auto-extend the lock (heartbeat), matching the other action RPCs.
  UPDATE public.tournament_hands
  SET updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'deleted', jsonb_build_object(
      'player_id', v_player_id,
      'entry_number', v_entry_number,
      'street', v_street,
      'action_type', v_action_type,
      'action_amount', v_action_amount,
      'action_order', v_action_order
    )
  );
END;
$$;

-- ============================================================================
-- (f) Grants. record_action was DROPped+recreated → its EXECUTE grant reset to
--     the PUBLIC default; lock it back down to operators. The 2 new helpers also
--     default to PUBLIC. (CREATE OR REPLACE on the 4 peers preserves their grants.)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.record_action(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_action(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.tracker_lock_ttl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tracker_lock_ttl() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.tracker_lock_blocks(uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tracker_lock_blocks(uuid, timestamptz, uuid) TO authenticated;
