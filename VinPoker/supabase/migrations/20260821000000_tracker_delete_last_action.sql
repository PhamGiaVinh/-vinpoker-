-- Tracker Undo — delete_last_action RPC.
--
-- Lets the operator undo the SINGLE most-recent action of an in-progress hand
-- (a tablet mis-tap) without voiding the whole hand. Actions are recorded to
-- the server immediately (record_action) so the live viewer sees them, which is
-- why undo must delete server-side too. The client reverses its local state
-- from a snapshot stack and re-renders; the viewer auto-updates from the
-- hand_actions realtime stream.
--
-- Mirrors the existing hand RPCs: same status + lock check as show_hole_cards /
-- update_community_cards (only the lock-holding tracker may act), SECURITY
-- INVOKER like record_action (operators already satisfy the hand_actions
-- "manageable" FOR ALL policy that record_action's INSERT relies on). New,
-- additive, idempotent (CREATE OR REPLACE) — does not touch existing objects.

CREATE OR REPLACE FUNCTION public.delete_last_action(
  p_hand_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_street TEXT;
  v_action_type TEXT;
  v_action_amount INTEGER;
  v_action_order INTEGER;
BEGIN
  SELECT status, locked_by_user_id INTO v_status, v_locked_by
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  IF v_locked_by IS NOT NULL AND p_user_id IS NOT NULL AND v_locked_by != p_user_id THEN
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
