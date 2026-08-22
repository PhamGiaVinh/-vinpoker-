-- P0 Tracker lock-authority closure.
--
-- Production never received the historical takeover RPC, while the protected
-- Tracker UI still has one bounded stale-lock handoff caller. Reintroduce only
-- that write seam with the caller identity derived from auth.uid(). This does
-- not create actions, alter hand state, or touch chips, payouts, or results.
--
-- Dependencies already live before this final P0 migration: tournament_hands,
-- tournaments, is_club_tracker, is_club_floor, tracker_lock_ttl, and auth.uid.
--
-- ROLLBACK (only while no post-apply Tracker write has occurred):
--   DROP FUNCTION public.takeover_hand_lock(uuid, boolean, uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.takeover_hand_lock(
  p_hand_id uuid,
  p_force boolean DEFAULT false,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_status text;
  v_is_voided boolean;
  v_locked_by uuid;
  v_locked_at timestamptz;
  v_is_floor boolean;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  -- p_actor_user_id is ABI compatibility only. It can never select a lock owner.
  IF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  END IF;

  SELECT t.club_id, h.status, h.is_voided, h.locked_by_user_id, h.locked_at
    INTO v_club_id, v_status, v_is_voided, v_locked_by, v_locked_at
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_found');
  END IF;

  IF v_status <> 'in_progress' OR COALESCE(v_is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;

  v_is_floor := public.is_club_floor(v_actor, v_club_id);
  IF NOT (public.is_club_tracker(v_actor, v_club_id) OR v_is_floor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  IF p_force AND NOT v_is_floor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'force_requires_floor');
  END IF;

  IF NOT p_force AND public.tracker_lock_blocks(v_locked_by, v_locked_at, v_actor) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lock_fresh',
      'locked_by', v_locked_by,
      'age_seconds', floor(extract(epoch FROM (now() - v_locked_at)))
    );
  END IF;

  UPDATE public.tournament_hands
  SET locked_by_user_id = v_actor,
      locked_at = now(),
      updated_at = now()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object(
    'ok', true,
    'previous_locked_by', v_locked_by,
    'forced', p_force AND v_locked_by IS NOT NULL AND v_locked_by <> v_actor
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.takeover_hand_lock(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.takeover_hand_lock(uuid, boolean, uuid)
  TO authenticated;

COMMIT;
