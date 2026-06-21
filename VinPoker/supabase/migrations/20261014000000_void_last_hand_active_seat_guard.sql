-- 20261014000000_void_last_hand_active_seat_guard.sql
--
-- BUG: "Void Last Hand" → 500 → the operator console showed only
--   "Edge Function returned a non-2xx status code". The real Postgres error
--   (surfaced after PR that reads error.context) is:
--       duplicate key value violates unique constraint
--       "uq_tournament_seats_active_player"
--
-- ROOT CAUSE: void_last_hand (migration 20260617000000) restores a voided hand's
--   players by blindly doing `UPDATE tournament_seats SET is_active = true` for
--   every hand_player. But `uq_tournament_seats_active_player` is a PARTIAL unique
--   index — UNIQUE (tournament_id, player_id) WHERE is_active = true — i.e. a player
--   may have only ONE active seat. If a player who busted in the voided hand ALREADY
--   has another active seat (e.g. they re-entered, or a lingering active row exists),
--   reactivating their old seat creates a SECOND active seat for that player and the
--   index throws. record_hand only ever INSERTs eliminations / leaves survivors
--   active, so it never hits this — only the void restore does.
--
-- FIX (minimal, additive): restore chip_count exactly as before, but only set
--   is_active = true when the player has NO OTHER active seat. This PRESERVES the
--   invariant the constraint enforces ("one active seat per player") instead of
--   violating it — a re-entered player keeps their current active seat and the stale
--   busted seat stays inactive (correct: they are playing as the re-entry now).
--
-- SCOPE: function body is byte-identical to 20260617000000 EXCEPT the one
--   tournament_seats UPDATE. No security-context change (stays SECURITY INVOKER — the
--   error was a constraint, not a permission issue; record_hand proves the operator
--   role can write these tables). No schema change. Idempotent (CREATE OR REPLACE).
--
-- ROLLBACK: re-apply the void_last_hand definition from
--   supabase/migrations/20260617000000_realtime_hand_tracking.sql (lines 467-533).

CREATE OR REPLACE FUNCTION public.void_last_hand(p_hand_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tournament_id UUID;
  v_hand_record RECORD;
  v_player_record RECORD;
BEGIN
  SELECT * INTO v_hand_record FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_hand_record.is_voided THEN
    RETURN jsonb_build_object('error', 'Hand already voided');
  END IF;

  v_tournament_id := v_hand_record.tournament_id;

  -- Only restore chip if hand was completed (has ending_stack)
  IF v_hand_record.status = 'completed' THEN
    FOR v_player_record IN
      SELECT * FROM public.hand_players WHERE hand_id = p_hand_id
    LOOP
      UPDATE public.tournament_chip_counts
      SET chip_count = v_player_record.starting_stack, updated_at = NOW()
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;

      -- Restore the seat's chips, but only RE-ACTIVATE it when the player has no
      -- OTHER active seat (uq_tournament_seats_active_player = one active seat per
      -- player). If they already have one (e.g. a re-entry), leave is_active as-is so
      -- the restore can't create a duplicate-active-seat constraint violation.
      UPDATE public.tournament_seats AS t
      SET chip_count = v_player_record.starting_stack,
          is_active = CASE
            WHEN EXISTS (
              SELECT 1 FROM public.tournament_seats s2
              WHERE s2.tournament_id = v_tournament_id
                AND s2.player_id = v_player_record.player_id
                AND s2.is_active = true
                AND s2.id <> t.id
            ) THEN t.is_active
            ELSE true
          END
      WHERE t.tournament_id = v_tournament_id
        AND t.player_id = v_player_record.player_id
        AND t.entry_number = v_player_record.entry_number;
    END LOOP;

    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
  END IF;

  -- For in_progress hands: delete orphan actions + reset hole_cards
  IF v_hand_record.status = 'in_progress' THEN
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
    UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false WHERE hand_id = p_hand_id;
  END IF;

  -- Void hand + release lock
  UPDATE public.tournament_hands
  SET is_voided = true, status = 'voided',
      locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
  WHERE id = p_hand_id;

  -- Recalculate from source of truth
  UPDATE public.tournaments
  SET players_remaining = (
      SELECT COUNT(*) FROM public.tournament_seats WHERE tournament_id = v_tournament_id AND is_active = true
    ),
    average_stack = (
      SELECT COALESCE(AVG(chip_count), 0) FROM public.tournament_chip_counts WHERE tournament_id = v_tournament_id
    ),
    updated_at = NOW()
  WHERE id = v_tournament_id;

  RETURN jsonb_build_object('status', 'success', 'message', 'Hand voided successfully', 'hand_id', p_hand_id);
END;
$$;
