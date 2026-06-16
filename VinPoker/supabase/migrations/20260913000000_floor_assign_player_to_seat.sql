-- ============================================================================
-- Floor Table Ops Phase A1 — floor_assign_player_to_seat RPC  (SOURCE-ONLY)
-- ============================================================================
-- "Thêm người" on the FLOOR = PURE seat placement. NO money: no buy-in, no fee,
-- no tournament_registrations row → FINANCE-NEUTRAL (never counted in the rake
-- formula `rake_amount × paying confirmed entries`). The cashier offline buy-in
-- (create_offline_buyin_and_seat) is the ONLY money path; the two stay disjoint.
--
-- Shape mirrors the seed's manual seating (registration_id NULL, source 'manual')
-- and the seat-claim / receipt / history machinery of create_offline_buyin_and_seat
-- and move_player_seat. Actor = auth.uid() ONLY. Owner/cashier gate. Atomic.
--
-- Seat conventions (live drift, same as move_player_seat / offline buy-in):
--   tournament_seats.table_id   = tournament_tables.id
--   tournament_entries.table_id = game_tables.id
--   receipts / history table_id = game_tables.id
--
-- ROLLBACK: DROP FUNCTION public.floor_assign_player_to_seat(uuid, text, uuid, integer);
-- Controlled apply only. NO supabase db push, NO deploy_db, NO schema_migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.floor_assign_player_to_seat(
  p_tournament_id        UUID,
  p_player_name          TEXT,
  p_tournament_table_id  UUID,
  p_seat_number          INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          UUID := auth.uid();
  v_authorized     BOOLEAN;
  v_tour           RECORD;
  v_tt             RECORD;
  v_name           TEXT := NULLIF(TRIM(p_player_name), '');
  v_player_id      UUID := gen_random_uuid();
  v_starting_stack INTEGER;
  v_seat_id        UUID;
  v_entry_id       UUID;
  v_receipt_id     UUID;
  v_receipt_code   TEXT;
  v_attempt        INTEGER := 0;
BEGIN
  -- 0. Actor from auth.uid() ONLY.
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 1. Validate name (no money inputs at all).
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_player_name');
  END IF;

  -- 2. Lock tournament; must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 3. Authorization: owner or club_cashier.
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = p_tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 4. Destination table must be active + linked; seat number in range.
  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active' AND tt.table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF p_seat_number IS NULL OR p_seat_number < 1 OR p_seat_number > v_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_tt.max_seats);
  END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  -- 5. CLAIM the seat (table_id = tournament_tables.id). Partial unique index is the
  --    guard — on a concurrent claim the INSERT throws → seat_occupied, nothing else written.
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      p_tournament_id, v_player_id, 1, v_tt.id, p_seat_number,
      v_starting_stack, true, v_name, 'active', v_actor, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  -- 6. Entry — registration_id NULL (NO money / NOT a paying confirmed registration),
  --    source 'manual' (existing CHECK value; floor manually seated a walk-in).
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, NULL, v_player_id, 1, 'manual',
    'seated', v_starting_stack, v_tt.table_id, v_seat_id, p_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- 7. Seat ticket (NO amounts; registration_id NULL). Retry code on collision.
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_tt.table_number::text, '?'), p_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        p_tournament_id, NULL, v_entry_id, v_player_id, v_name,
        v_tt.table_id, v_tt.table_number, v_seat_id, p_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', v_player_id,
          'table_number', v_tt.table_number, 'seat_number', p_seat_number, 'source', 'floor'),
        'manual', 'issued', v_actor
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 8. Audit.
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    p_tournament_id, v_entry_id, v_player_id,
    v_tt.table_id, v_tt.table_number, p_seat_number,
    'floor_seat_add', 'manual', v_actor,
    jsonb_build_object('source', 'floor', 'money', false, 'tournament_table_id', v_tt.id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'seat_id', v_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code,
    'table_id', v_tt.table_id,
    'table_number', v_tt.table_number,
    'seat_number', p_seat_number,
    'display_name', v_name,
    'starting_stack', v_starting_stack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_assign_player_to_seat(UUID, TEXT, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_assign_player_to_seat(UUID, TEXT, UUID, INTEGER) TO authenticated;
