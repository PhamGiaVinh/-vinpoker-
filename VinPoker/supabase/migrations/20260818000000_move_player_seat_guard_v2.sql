-- ═══════════════════════════════════════════════════════════════════════════════
-- ⚠️  NOT YET APPLIED — controlled patch session required. Do NOT db push.
--
-- MOVE GUARD V2: Bind p_actor_user_id to auth.uid() in move_player_seat
--                + lock down EXECUTE grants + fold in the return-payload fix.
--
-- Target (live, verified 2026-06-13): OID 272050, single overload
--   move_player_seat(p_entry_id uuid, p_to_tournament_table_id uuid,
--                    p_to_seat_number integer, p_actor_user_id uuid, p_reason text)
--
-- Why (same vulnerability class fixed for confirm RPC by 20260811000000):
--   The live function checks p_actor_user_id is a club owner/cashier but never
--   verifies it equals auth.uid(), and EXECUTE is granted to anon + PUBLIC
--   (verified live 2026-06-13). Any caller — even unauthenticated — can pass a
--   known owner/cashier UUID and move players, superseding receipts and writing
--   forged history rows.
--
-- Changes (signature UNCHANGED; no UI calls this RPC yet — verified):
--   1. New step 0 immediately after BEGIN, before any lock/read/write:
--        IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid()
--        THEN RETURN {ok:false, error:'actor_not_allowed'};
--   2. REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role.
--   3. Folds in the return-payload fix from source commit 8604cca that was never
--      applied live (documented in 20260807000002): RETURN now reports
--      'from_game_table_id' = the actual game_tables.id (was mislabeled with the
--      tournament_tables.id) and adds 'current_stack'. History/receipt writes are
--      unchanged (they were already correct live).
--
-- Apply checklist (controlled patch session ONLY):
--   1. Snapshot live def:  SELECT pg_get_functiondef(272050::oid);
--      → confirm md5(prosrc) = 1f12d30fc7818e23cd9ab053d62a6b4a (pre-apply state)
--   2. Run this file via SQL executor (single transaction).
--   3. Verify: anon call → actor_not_allowed; spoofed-UUID authenticated call →
--      actor_not_allowed; legitimate cashier call with own JWT → ok.
--   4. Verify grants: SELECT grantee FROM information_schema.routine_privileges
--      WHERE routine_name='move_player_seat'  → authenticated + service_role only
--      (+ postgres owner).
--   5. Rollback on issue: docs/emergency_rollbacks/MOVE_GUARD_V2_rollback_move_player_seat_oid_272050.sql
--
-- HARD RULE (owner-approved plan 2026-06-13): PR C (Move Player UI) must NOT be
-- exposed until this guard is live.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.move_player_seat(
  p_entry_id               UUID,
  p_to_tournament_table_id UUID,
  p_to_seat_number         INTEGER,
  p_actor_user_id          UUID,
  p_reason                 TEXT DEFAULT 'manual_move'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry            RECORD;
  v_from_seat        RECORD;
  v_to_tt            RECORD;
  v_from_table_number  INTEGER;
  v_from_tt_id         UUID;
  v_from_game_table_id UUID;  -- game_tables.id of FROM seat (for history/receipts FK)
  v_new_seat_id      UUID;
  v_receipt_id       UUID;
  v_receipt_code     TEXT;
  v_authorized       BOOLEAN;
  v_attempt          INTEGER := 0;
BEGIN
  -- ── 0. P0 GUARD V2: bind claimed actor to the authenticated caller ──────────
  --      Without this, any caller (grants were anon/PUBLIC!) could pass a known
  --      owner/cashier UUID and pass the owner/cashier EXISTS check below.
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 1. Lock the entry row.
  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;

  -- 2. Entry must be seated.
  IF v_entry.status <> 'seated' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_seated', 'status', v_entry.status);
  END IF;

  -- 3. Actor authorization: must be club owner or cashier for this tournament's club.
  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc
      ON cc.club_id = t.club_id AND cc.user_id = p_actor_user_id
    WHERE t.id = v_entry.tournament_id
      AND (c.owner_id = p_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 4. Find the current active seat.
  SELECT * INTO v_from_seat
  FROM public.tournament_seats
  WHERE entry_id = p_entry_id
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    -- Fallback: find by player_id + tournament (for entries created before entry_id was on seat)
    SELECT * INTO v_from_seat
    FROM public.tournament_seats
    WHERE tournament_id = v_entry.tournament_id
      AND player_id     = v_entry.player_id
      AND is_active     = true
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_active_seat');
    END IF;
  END IF;

  -- 5. Lock destination tournament_tables row; resolve game_tables.id.
  --    Enforce same tournament to prevent cross-tournament moves.
  SELECT * INTO v_to_tt
  FROM public.tournament_tables
  WHERE id           = p_to_tournament_table_id
    AND tournament_id = v_entry.tournament_id
    AND status        = 'active'
    AND table_id      IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;

  -- 6. Seat number range check.
  IF p_to_seat_number < 1 OR p_to_seat_number > v_to_tt.max_seats THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invalid_seat_number',
      'max_seats', v_to_tt.max_seats
    );
  END IF;

  -- 7. Same-seat check → idempotent success (not an error).
  -- v_from_seat.table_id = tournament_tables.id; compare against p_to_tournament_table_id.
  IF v_from_seat.table_id = p_to_tournament_table_id
     AND v_from_seat.seat_number = p_to_seat_number THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_there', true,
      'entry_id', p_entry_id,
      'player_name', v_from_seat.player_name,
      'to_table_number', v_to_tt.table_number,
      'to_seat_number', p_to_seat_number
    );
  END IF;

  -- 8. Resolve FROM table_number + game_tables.id (for history).
  -- v_from_seat.table_id = tournament_tables.id, so join on tt.id.
  SELECT tt.table_number, tt.id, tt.table_id
  INTO v_from_table_number, v_from_tt_id, v_from_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = v_from_seat.table_id
  LIMIT 1;

  -- 9. Mark old seat moved + insert new seat in an atomic savepoint block.
  BEGIN
    UPDATE public.tournament_seats
    SET status    = 'moved',
        is_active = false
    WHERE id = v_from_seat.id;

    -- table_id must be tournament_tables.id per live FK on tournament_seats.
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, entry_id, status,
      assigned_by, assigned_at
    ) VALUES (
      v_entry.tournament_id,
      v_entry.player_id,
      v_entry.entry_no,
      p_to_tournament_table_id,
      p_to_seat_number,
      v_from_seat.chip_count,
      true,
      v_from_seat.player_name,
      p_entry_id,
      'active',
      p_actor_user_id,
      now()
    ) RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  -- 10. Update entry: new location + sync current_stack from seat's chip_count.
  UPDATE public.tournament_entries
  SET table_id      = v_to_tt.table_id,
      seat_number   = p_to_seat_number,
      seat_id       = v_new_seat_id,
      current_stack = v_from_seat.chip_count
  WHERE id = p_entry_id;

  -- 11. Supersede old active receipts for this entry.
  UPDATE public.seat_draw_receipts
  SET status       = 'superseded',
      cancelled_at = now()
  WHERE entry_id = p_entry_id
    AND status IN ('issued', 'printed');

  -- 12. Issue new receipt for the move (receipt_code may collide; retry up to 5×).
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_to_tt.table_number::text, '?'),
      p_to_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        v_entry.tournament_id,
        v_entry.registration_id,
        p_entry_id,
        v_entry.player_id,
        v_from_seat.player_name,
        v_to_tt.table_id,
        v_to_tt.table_number,
        v_new_seat_id,
        p_to_seat_number,
        v_receipt_code,
        jsonb_build_object(
          'v', 1,
          'receipt_code', v_receipt_code,
          'entry_id', p_entry_id,
          'tournament_id', v_entry.tournament_id,
          'player_id', v_entry.player_id,
          'table_number', v_to_tt.table_number,
          'seat_number', p_to_seat_number,
          'move_reason', p_reason
        ),
        'manual_move',
        'issued',
        p_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 13. Audit history.
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    from_table_id, from_table_number, from_seat_number,
    to_table_id,   to_table_number,   to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_entry.tournament_id,
    p_entry_id,
    v_entry.player_id,
    v_from_game_table_id,  -- game_tables.id (history FK target)
    v_from_table_number,
    v_from_seat.seat_number,
    v_to_tt.table_id,      -- game_tables.id of destination
    v_to_tt.table_number,
    p_to_seat_number,
    p_reason,
    'manual_move',
    p_actor_user_id,
    jsonb_build_object(
      'from_tournament_table_id', v_from_tt_id,
      'to_tournament_table_id',   p_to_tournament_table_id,
      'chip_count_at_move',       v_from_seat.chip_count
    )
  );

  -- 14. Return: include both logical and physical table IDs so UI can't confuse them.
  RETURN jsonb_build_object(
    'ok', true,
    'entry_id',                 p_entry_id,
    'player_name',              v_from_seat.player_name,
    'from_tournament_table_id', v_from_tt_id,
    'from_game_table_id',       v_from_game_table_id,
    'from_table_number',        v_from_table_number,
    'from_seat_number',         v_from_seat.seat_number,
    'to_tournament_table_id',   p_to_tournament_table_id,
    'to_game_table_id',         v_to_tt.table_id,
    'to_table_number',          v_to_tt.table_number,
    'to_seat_number',           p_to_seat_number,
    'chip_count',               v_from_seat.chip_count,
    'current_stack',            v_from_seat.chip_count,
    'seat_id',                  v_new_seat_id,
    'receipt_id',               v_receipt_id,
    'receipt_code',             v_receipt_code
  );
END;
$$;

-- Lock down grants (pre-apply state: PUBLIC, anon, authenticated, postgres, service_role)
REVOKE EXECUTE ON FUNCTION public.move_player_seat(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.move_player_seat(UUID, UUID, INTEGER, UUID, TEXT) TO authenticated, service_role;

COMMIT;
