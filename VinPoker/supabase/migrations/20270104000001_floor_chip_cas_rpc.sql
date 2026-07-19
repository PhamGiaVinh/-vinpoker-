-- Floor chip correction must not grant club_floors direct UPDATE access to the
-- entire tournament_seats row. This caller-bound RPC is the only new write path:
-- it locks one active seat and changes only chip_count under optimistic CAS.
-- SOURCE ONLY: production apply is a separate owner-gated operation.
--
-- ROLLBACK (only after the Edge consumer has been rolled back):
-- DROP FUNCTION IF EXISTS public.floor_update_tournament_seat_chip(uuid, uuid, integer, integer);

BEGIN;

CREATE OR REPLACE FUNCTION public.floor_update_tournament_seat_chip(
  p_tournament_id UUID,
  p_seat_id UUID,
  p_expected_chip_count INTEGER,
  p_chip_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_seat public.tournament_seats%ROWTYPE;
  v_club_id UUID;
  v_authorized BOOLEAN := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_expected_chip_count IS NULL OR p_expected_chip_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_expected_chip_count');
  END IF;
  IF p_chip_count IS NULL OR p_chip_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_chip_count');
  END IF;

  SELECT t.club_id
  INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = v_club_id
        AND c.owner_id = v_actor
    )
    OR EXISTS (
      SELECT 1
      FROM public.club_cashiers cc
      WHERE cc.club_id = v_club_id
        AND cc.user_id = v_actor
    )
    OR EXISTS (
      SELECT 1
      FROM public.club_floors cf
      WHERE cf.club_id = v_club_id
        AND cf.user_id = v_actor
    )
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT *
  INTO v_seat
  FROM public.tournament_seats ts
  WHERE ts.id = p_seat_id
    AND ts.tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_found');
  END IF;
  IF NOT v_seat.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_active');
  END IF;
  IF v_seat.entry_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.tournament_entries te
    WHERE te.id = v_seat.entry_id
      AND te.tournament_id = p_tournament_id
      AND te.player_id = v_seat.player_id
      AND te.entry_no = v_seat.entry_number
      AND te.status = 'seated'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
  END IF;
  IF v_seat.chip_count IS DISTINCT FROM p_expected_chip_count THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_seat_state',
      'current_chip_count', v_seat.chip_count
    );
  END IF;
  IF p_chip_count = v_seat.chip_count THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'seat_id', v_seat.id,
      'chip_count', v_seat.chip_count
    );
  END IF;

  UPDATE public.tournament_seats
  SET chip_count = p_chip_count
  WHERE id = p_seat_id
    AND tournament_id = p_tournament_id
    AND is_active = true
    AND chip_count = p_expected_chip_count;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_seat_state');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'seat_id', p_seat_id,
    'chip_count', p_chip_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_update_tournament_seat_chip(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_update_tournament_seat_chip(UUID, UUID, INTEGER, INTEGER) TO authenticated;

COMMIT;
