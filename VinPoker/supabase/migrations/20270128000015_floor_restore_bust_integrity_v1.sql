-- Restore mistaken bust only from stored entry/seat evidence; preserve history and payout.
-- Rollback: forward restore reviewed pre-apply function snapshots and revoke writers
-- until their integrity postchecks pass. Never delete receipts or rewrite chip history.
BEGIN;
CREATE OR REPLACE FUNCTION public.floor_restore_busted_player_to_seat_v3(
  p_entry_id uuid,
  p_to_tournament_table_id uuid,
  p_to_seat_number integer,
  p_expected_revision bigint,
  p_expected_control_epoch bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_busted_seat public.tournament_seats%ROWTYPE;
  v_destination_table public.tournament_tables%ROWTYPE;
  v_destination_session public.table_sessions%ROWTYPE;
  v_game_table_id uuid;
  v_stack integer;
  v_remaining integer;
  v_new_seat_id uuid;
  v_next_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_entry_id IS NULL
     OR p_to_tournament_table_id IS NULL
     OR p_to_seat_number IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_control_epoch IS NULL
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT entry_row.tournament_id INTO v_tournament_id
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry_id', p_entry_id,
    'to_tournament_table_id', p_to_tournament_table_id,
    'to_seat_number', p_to_seat_number,
    'expected_revision', p_expected_revision,
    'expected_control_epoch', p_expected_control_epoch
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tournament.id)
    OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=v_tournament.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','restore_result_dependency');
  END IF;
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id;
  IF NOT FOUND OR v_entry.status <> 'busted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_busted');
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_entries later_entry
    WHERE later_entry.tournament_id=v_tournament.id AND later_entry.player_id=v_entry.player_id
      AND later_entry.entry_no>v_entry.entry_no AND later_entry.status<>'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','restore_reentry_dependency');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats active_seat
    WHERE active_seat.tournament_id = v_tournament.id
      AND active_seat.entry_id = v_entry.id
      AND active_seat.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_already_seated');
  END IF;
  SELECT * INTO v_busted_seat
  FROM public.tournament_seats busted_seat
  WHERE busted_seat.tournament_id = v_tournament.id
    AND busted_seat.entry_id = v_entry.id
    AND busted_seat.player_id = v_entry.player_id
    AND busted_seat.entry_number = v_entry.entry_no
    AND busted_seat.status = 'busted'
  ORDER BY busted_seat.assigned_at DESC NULLS LAST, busted_seat.id DESC
  LIMIT 1;
  IF NOT FOUND OR v_busted_seat.chip_count IS NULL OR v_busted_seat.chip_count < 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','restore_stack_evidence_missing');
  END IF;
  v_stack := v_busted_seat.chip_count;

  SELECT tt.game_table_id INTO v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.tournament_id = v_tournament.id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = v_game_table_id AND gt.club_id = v_tournament.club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_destination_session FROM public.table_sessions session_row
  WHERE session_row.game_table_id = v_game_table_id AND session_row.closed_at IS NULL FOR UPDATE;
  SELECT * INTO v_destination_table FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.table_session_id = v_destination_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF v_destination_session.id IS NULL
     OR v_destination_table.id IS NULL
     OR v_destination_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id
  FOR UPDATE;
  IF NOT FOUND OR v_entry.status <> 'busted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_busted');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats active_seat
    WHERE active_seat.tournament_id = v_tournament.id
      AND active_seat.entry_id = v_entry.id
      AND active_seat.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_already_seated');
  END IF;
  SELECT * INTO v_busted_seat
  FROM public.tournament_seats busted_seat
  WHERE busted_seat.tournament_id = v_tournament.id
    AND busted_seat.entry_id = v_entry.id
    AND busted_seat.player_id = v_entry.player_id
    AND busted_seat.entry_number = v_entry.entry_no
    AND busted_seat.status = 'busted'
  ORDER BY busted_seat.assigned_at DESC NULLS LAST, busted_seat.id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_busted_seat.chip_count IS NULL OR v_busted_seat.chip_count < 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','restore_stack_evidence_missing');
  END IF;
  v_stack := v_busted_seat.chip_count;
  IF v_destination_table.max_seats NOT IN (8,9) OR p_to_seat_number < 1 OR p_to_seat_number > v_destination_table.max_seats THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF v_destination_session.revision <> p_expected_revision
     OR v_destination_session.control_epoch <> p_expected_control_epoch THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE',
      'current_revision', v_destination_session.revision,
      'current_control_epoch', v_destination_session.control_epoch
    );
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_destination_table.id, v_destination_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  IF EXISTS(SELECT 1 FROM public.table_session_seat_locks l
    WHERE l.table_session_id=v_destination_session.id AND l.seat_number=p_to_seat_number AND l.unlocked_at IS NULL) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','seat_locked');
  END IF;
  BEGIN
    UPDATE public.table_sessions
    SET revision = revision + 1
    WHERE id = v_destination_session.id
      AND revision = p_expected_revision
    RETURNING revision INTO v_next_revision;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
    END IF;
    INSERT INTO public.tournament_seats (
      tournament_id,
      player_id,
      entry_number,
      tournament_table_id,
      table_session_id,
      seat_number,
      chip_count,
      is_active,
      entry_id,
      status,
      assigned_by,
      assigned_at
    ) VALUES (
      v_tournament.id,
      v_entry.player_id,
      v_entry.entry_no,
      v_destination_table.id,
      v_destination_session.id,
      p_to_seat_number,
      v_stack,
      true,
      v_entry.id,
      'active',
      v_actor,
      pg_catalog.now()
    )
    RETURNING id INTO v_new_seat_id;
    UPDATE public.tournament_entries
    SET status = 'seated',
        current_stack = v_stack,
        busted_at = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_entry.id
      AND status = 'busted';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_state_changed';
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  SELECT pg_catalog.count(*)::integer INTO v_remaining FROM public.tournament_seats
    WHERE tournament_id=v_tournament.id AND is_active;
  UPDATE public.tournaments SET players_remaining=v_remaining WHERE id=v_tournament.id;
  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'entry_id', v_entry.id,
    'seat_id', v_new_seat_id,
    'tournament_table_id', v_destination_table.id,
    'table_session_id', v_destination_session.id,
    'seat_number', p_to_seat_number,
    'chip_count', v_stack,
    'revision', v_next_revision,
    'payout_applied', false
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.floor_restore_busted_player_to_seat_v4(
  p_entry_id uuid,p_to_tournament_table_id uuid,p_to_seat_number integer,
  p_expected_revision bigint,p_expected_control_epoch bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.floor_restore_busted_player_to_seat_v3(p_entry_id,p_to_tournament_table_id,p_to_seat_number,
    p_expected_revision,p_expected_control_epoch,p_request_id);
$$;
REVOKE ALL ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid,uuid,integer,bigint,bigint,uuid),
  public.floor_restore_busted_player_to_seat_v4(uuid,uuid,integer,bigint,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid,uuid,integer,bigint,bigint,uuid),
  public.floor_restore_busted_player_to_seat_v4(uuid,uuid,integer,bigint,bigint,uuid) TO authenticated;
COMMIT;
