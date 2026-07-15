-- Floor production readiness follow-up: make clock start server-authoritative.
--
-- The legacy update_tournament_state RPC changes status and appends the transition
-- separately from the Edge clock write. A retry/race could therefore leave the
-- status, clock fields and audit history out of sync. This forward-only RPC locks
-- the tournament and makes all three changes in one transaction.
--
-- ROLLBACK: do not edit or replay this migration. If rollback is required, add a
-- new forward migration that revokes the RPC and restores the previous behavior
-- only after an owner-approved incident review.

BEGIN;

CREATE OR REPLACE FUNCTION public.floor_start_tournament_clock(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_level INTEGER;
  v_authorized BOOLEAN;
  v_started_at TIMESTAMPTZ;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_close_report
    WHERE tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;
  IF v_tour.clock_started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_already_started');
  END IF;

  v_level := v_tour.current_level;
  IF v_level IS NULL THEN
    SELECT level_number INTO v_level
    FROM public.tournament_levels
    WHERE tournament_id = p_tournament_id
    ORDER BY level_number ASC
    LIMIT 1;
  END IF;
  IF v_level IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tournament_level');
  END IF;

  UPDATE public.tournaments
  SET status = 'live',
      current_level = v_level,
      clock_started_at = clock_timestamp(),
      clock_paused_at = NULL,
      pause_accumulated = 0,
      updated_at = now()
  WHERE id = p_tournament_id
    AND clock_started_at IS NULL
  RETURNING clock_started_at INTO v_started_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_already_started');
  END IF;

  IF v_tour.status IS DISTINCT FROM 'live' THEN
    INSERT INTO public.tournament_state_transitions (
      tournament_id, previous_state, new_state, changed_by, reason
    ) VALUES (
      p_tournament_id, v_tour.status, 'live', v_actor, 'floor_clock_started'
    );
  END IF;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_tour.club_id, v_actor, 'floor_tournament_clock_started', 'tournament', p_tournament_id,
    jsonb_build_object(
      'previous_status', v_tour.status,
      'current_level', v_level,
      'clock_started_at', v_started_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'clock_started',
    'current_level', v_level,
    'clock_started_at', v_started_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_start_tournament_clock(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_start_tournament_clock(UUID) TO authenticated, service_role;

COMMIT;
