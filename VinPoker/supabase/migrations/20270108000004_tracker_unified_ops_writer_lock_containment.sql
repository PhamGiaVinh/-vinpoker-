BEGIN;

-- This forward migration depends on the PR2A shared tournament lock. Fail
-- closed instead of recreating a semantically different helper.
DO $$
BEGIN
  IF to_regprocedure('public.tracker_unified_ops_lock_tournament(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tracker_unified_ops_lock_tournament(uuid) is required before writer containment'
      USING ERRCODE = '42883';
  END IF;
END;
$$;

-- Lock-only containment for the proven PR2A race. Business validation,
-- revision CAS, audit payload and response shape intentionally match the
-- current-main writer body.
CREATE OR REPLACE FUNCTION public.floor_set_table_control_mode(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_control_mode TEXT,
  p_expected_control_revision BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_tt RECORD;
  v_authorized BOOLEAN;
  v_previous_mode TEXT;
  v_next_revision BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_control_mode IS NULL OR p_control_mode NOT IN ('manual', 'tracker') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_floor_control_mode');
  END IF;
  IF p_expected_control_revision IS NULL OR p_expected_control_revision < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_control_revision');
  END IF;

  -- Join the V2 tournament-scoped lock before any context row lock. This
  -- serializes mode changes with start_tracker_hand_v2 for one tournament,
  -- while leaving different tournaments independent.
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

  -- Preserve the current writer's table -> tournament row order after the
  -- shared lock, including its existing table-scoped advisory lock.
  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
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
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tournament_id::text),
    hashtext(v_tt.id::text)
  );

  -- Re-read after the existing table advisory lock so a concurrent mode
  -- change cannot make this decision from a stale row.
  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id
      AND h.status = 'in_progress'
      AND h.table_id IN (v_tt.id, v_tt.table_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  v_previous_mode := v_tt.floor_control_mode;
  UPDATE public.tournament_tables
  SET floor_control_mode = p_control_mode,
      floor_control_revision = floor_control_revision + 1
  WHERE id = v_tt.id
    AND tournament_id = p_tournament_id
    AND status = 'active'
    AND floor_control_revision = p_expected_control_revision
  RETURNING floor_control_revision INTO v_next_revision;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_table_control_mode');
  END IF;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_tour.club_id, v_actor, 'floor_table_control_mode_changed', 'tournament_table', v_tt.id,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'previous_mode', v_previous_mode,
      'next_mode', p_control_mode,
      'previous_revision', p_expected_control_revision,
      'next_revision', v_next_revision,
      'payout_applied', false
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'floor_control_mode', p_control_mode,
    'floor_control_revision', v_next_revision,
    'payout_applied', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_set_table_control_mode(UUID, UUID, TEXT, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_set_table_control_mode(UUID, UUID, TEXT, BIGINT) TO authenticated;

COMMIT;
