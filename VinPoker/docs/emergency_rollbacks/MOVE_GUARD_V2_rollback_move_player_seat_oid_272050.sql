-- MOVE GUARD V2 rollback snapshot — captured 2026-06-13 BEFORE applying migration
-- 20260818000000_move_player_seat_guard_v2.sql
--
-- Target OID 272050:
--   move_player_seat(p_entry_id uuid, p_to_tournament_table_id uuid,
--                    p_to_seat_number integer, p_actor_user_id uuid, p_reason text)
--
-- EXACT live function body captured via SELECT pg_get_functiondef(272050::oid)
-- immediately before guard v2 authoring. md5(prosrc) = 1f12d30fc7818e23cd9ab053d62a6b4a
-- (live stores CRLF endings; this file is LF — semantically identical).
--
-- ⚠️  SECURITY WARNING: reverting the body restores the bypassable v1 guard
--     (trusts client-supplied p_actor_user_id). Pre-apply EXECUTE grants were:
--        PUBLIC, anon, authenticated, postgres, service_role
--     The grant-restore statements are commented out at the bottom — only
--     uncomment if deliberately reverting the entire security fix.
--
-- To revert: run via SQL executor. Do NOT edit migrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.move_player_seat(p_entry_id uuid, p_to_tournament_table_id uuid, p_to_seat_number integer, p_actor_user_id uuid, p_reason text DEFAULT 'manual_move'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry              RECORD;
  v_from_seat          RECORD;
  v_to_tt              RECORD;
  v_from_table_number  INTEGER;
  v_from_tt_id         UUID;
  v_from_game_table_id UUID;
  v_new_seat_id        UUID;
  v_receipt_id         UUID;
  v_receipt_code       TEXT;
  v_authorized         BOOLEAN;
  v_attempt            INTEGER := 0;
BEGIN
  SELECT * INTO v_entry FROM public.tournament_entries
  WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;

  IF v_entry.status <> 'seated' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_seated', 'status', v_entry.status);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = p_actor_user_id
    WHERE t.id = v_entry.tournament_id
      AND (c.owner_id = p_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT * INTO v_from_seat FROM public.tournament_seats
  WHERE entry_id = p_entry_id AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_from_seat FROM public.tournament_seats
    WHERE tournament_id = v_entry.tournament_id AND player_id = v_entry.player_id
      AND is_active = true LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_active_seat');
    END IF;
  END IF;

  SELECT * INTO v_to_tt FROM public.tournament_tables
  WHERE id = p_to_tournament_table_id
    AND tournament_id = v_entry.tournament_id
    AND status = 'active' AND table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;

  IF p_to_seat_number < 1 OR p_to_seat_number > v_to_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_to_tt.max_seats);
  END IF;

  -- Same-seat: compare tournament_tables.id on both sides
  IF v_from_seat.table_id = p_to_tournament_table_id
     AND v_from_seat.seat_number = p_to_seat_number THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_there', true,
      'entry_id', p_entry_id,
      'player_name', v_from_seat.player_name,
      'to_table_number', v_to_tt.table_number,
      'to_seat_number', p_to_seat_number
    );
  END IF;

  -- Resolve FROM table_number + game_tables.id; v_from_seat.table_id = tournament_tables.id
  SELECT tt.table_number, tt.id, tt.table_id
  INTO v_from_table_number, v_from_tt_id, v_from_game_table_id
  FROM public.tournament_tables tt WHERE tt.id = v_from_seat.table_id LIMIT 1;

  BEGIN
    UPDATE public.tournament_seats SET status = 'moved', is_active = false WHERE id = v_from_seat.id;
    -- Use p_to_tournament_table_id (tournament_tables.id) per live FK
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
    ) VALUES (
      v_entry.tournament_id, v_entry.player_id, v_entry.entry_no,
      p_to_tournament_table_id, p_to_seat_number,
      v_from_seat.chip_count, true, v_from_seat.player_name,
      p_entry_id, 'active', p_actor_user_id, now()
    ) RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  UPDATE public.tournament_entries
  SET table_id = v_to_tt.table_id, seat_number = p_to_seat_number,
      seat_id = v_new_seat_id, current_stack = v_from_seat.chip_count
  WHERE id = p_entry_id;

  UPDATE public.seat_draw_receipts SET status = 'superseded', cancelled_at = now()
  WHERE entry_id = p_entry_id AND status IN ('issued', 'printed');

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_to_tt.table_number::text, '?'), p_to_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        v_entry.tournament_id, v_entry.registration_id, p_entry_id,
        v_entry.player_id, v_from_seat.player_name,
        v_to_tt.table_id, v_to_tt.table_number,
        v_new_seat_id, p_to_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code,
          'entry_id', p_entry_id, 'tournament_id', v_entry.tournament_id,
          'player_id', v_entry.player_id, 'table_number', v_to_tt.table_number,
          'seat_number', p_to_seat_number, 'move_reason', p_reason),
        'manual_move', 'issued', p_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    from_table_id, from_table_number, from_seat_number,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_entry.tournament_id, p_entry_id, v_entry.player_id,
    v_from_game_table_id, v_from_table_number, v_from_seat.seat_number,
    v_to_tt.table_id, v_to_tt.table_number, p_to_seat_number,
    p_reason, 'manual_move', p_actor_user_id,
    jsonb_build_object(
      'from_tournament_table_id', v_from_tt_id,
      'to_tournament_table_id', p_to_tournament_table_id,
      'chip_count_at_move', v_from_seat.chip_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', p_entry_id,
    'player_name', v_from_seat.player_name,
    'from_tournament_table_id', v_from_tt_id,
    'from_game_table_id', v_from_seat.table_id,
    'from_table_number', v_from_table_number,
    'from_seat_number', v_from_seat.seat_number,
    'to_tournament_table_id', p_to_tournament_table_id,
    'to_game_table_id', v_to_tt.table_id,
    'to_table_number', v_to_tt.table_number,
    'to_seat_number', p_to_seat_number,
    'chip_count', v_from_seat.chip_count,
    'seat_id', v_new_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code
  );
END;
$function$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL grant restore (pre-apply state). ⚠️ Re-opens the anon/PUBLIC bypass.
-- ─────────────────────────────────────────────────────────────────────────────
-- GRANT EXECUTE ON FUNCTION public.move_player_seat(uuid, uuid, integer, uuid, text) TO PUBLIC, anon;
