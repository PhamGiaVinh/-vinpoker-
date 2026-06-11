-- ═══════════════════════════════════════════════════════════════════════════════
-- P0 GUARD V2: Bind p_actor_user_id to auth.uid() in
--              confirm_registration_and_assign_seat + lock down EXECUTE grants.
--
-- Target: OID 271766 (single overload)
--   confirm_registration_and_assign_seat(p_registration_id uuid, p_actor_user_id uuid, p_draw_mode text)
--
-- Why v2 is needed (v1 was incomplete):
--   v1 added an actor guard that checks p_actor_user_id is a club owner/cashier.
--   But the function never verified that p_actor_user_id equals the AUTHENTICATED
--   caller (auth.uid()), and EXECUTE was granted to anon + PUBLIC. So any caller —
--   even unauthenticated — could pass a *known* owner/cashier UUID and pass the
--   guard. UUIDs leak (profiles, JWTs, API payloads), making the guard bypassable.
--
-- Proof the fix is safe (does not break the real flow):
--   The only caller is the cashier UI (TournamentRegistrationsTab.tsx) via the
--   browser supabase client, passing p_actor_user_id: user.id with the user's JWT
--   (DB role = authenticated). For a legitimate caller p_actor_user_id already
--   equals auth.uid(). There is NO edge-function / service_role caller of this RPC.
--
-- Changes (signature UNCHANGED — p_actor_user_id kept; call site stays valid):
--   1. New step 2.4 inserted BEFORE the existing step 2.5 owner/cashier check and
--      before any writes/readback:
--        IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid()
--        THEN RETURN {ok:false, error:'actor_not_allowed'};
--   2. REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role.
--
-- Not changed: signature, call site, seat-assignment logic, receipt logic,
--   tracker insert, existing error names, draw-mode behavior, the v1 owner/cashier
--   check (kept as defense-in-depth after the auth.uid() bind).
--
-- Body captured verbatim from live OID 271766 (includes v1 guard); only step 2.4
-- is added. Rollback: docs/emergency_rollbacks/P0_GUARD_V2_rollback_confirm_registration_oid_271766.sql
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_registration_and_assign_seat(p_registration_id uuid, p_actor_user_id uuid, p_draw_mode text DEFAULT 'random_balanced'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg            RECORD;
  v_tour           RECORD;
  v_display_name   TEXT;
  v_starting_stack INTEGER;
  v_entry_no       INTEGER;
  v_entry_id       UUID;
  v_seat_id        UUID;
  v_seat_number    INTEGER;
  v_table_tour_id  UUID;   -- tournament_tables.id  (FK target for tournament_seats)
  v_table_game_id  UUID;   -- game_tables.id         (FK target for entries/receipts/history)
  v_table_number   INTEGER;
  v_max_seats      INTEGER;
  v_receipt_id     UUID;
  v_receipt_code   TEXT;
  v_existing_entry RECORD;
  v_attempt        INTEGER := 0;
BEGIN
  -- 1. Lock the registration row.
  SELECT * INTO v_reg
  FROM public.tournament_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  -- 2. Not found.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found');
  END IF;

  -- ── P0 GUARD V2 ────────────────────────────────────────────────────────────
  -- 2.4. Bind the claimed actor to the authenticated caller. The browser client
  --      always sends p_actor_user_id = user.id under the user's JWT, so for any
  --      legitimate call auth.uid() = p_actor_user_id. Rejecting the mismatch
  --      stops a caller from spoofing a known owner/cashier UUID (the v1 check
  --      below only proved the UUID was *some* authorized user, not the caller).
  --      auth.uid() is NULL for anon/service_role with no JWT → also rejected.
  -- ────────────────────────────────────────────────────────────────────────────
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 2.5. Actor authorization: actor must be the club owner or a club cashier
  --      for the tournament's club. Check performed before any writes so that
  --      an unauthorized caller cannot create entries/seats/receipts.
  PERFORM 1
  FROM public.tournaments t
  WHERE t.id = v_reg.tournament_id
    AND (
      EXISTS (
        SELECT 1 FROM public.clubs c
        WHERE c.id = t.club_id AND c.owner_id = p_actor_user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.club_cashiers cc
        WHERE cc.club_id = t.club_id AND cc.user_id = p_actor_user_id
      )
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 3. Idempotency: already confirmed AND we already produced an entry + receipt.
  IF v_reg.status = 'confirmed' THEN
    SELECT te.id AS entry_id, te.table_id, te.seat_id, te.seat_number,
           sdr.id AS receipt_id, sdr.receipt_code, sdr.table_number, sdr.display_name
    INTO v_existing_entry
    FROM public.tournament_entries te
    LEFT JOIN public.seat_draw_receipts sdr
      ON sdr.entry_id = te.id AND sdr.draw_type = 'initial'
    WHERE te.registration_id = p_registration_id
    ORDER BY te.created_at ASC
    LIMIT 1;

    IF FOUND AND v_existing_entry.entry_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'registration_id', p_registration_id,
        'entry_id', v_existing_entry.entry_id,
        'seat_id', v_existing_entry.seat_id,
        'receipt_id', v_existing_entry.receipt_id,
        'receipt_code', v_existing_entry.receipt_code,
        'table_id', v_existing_entry.table_id,
        'table_number', v_existing_entry.table_number,
        'seat_number', v_existing_entry.seat_number,
        'display_name', v_existing_entry.display_name
      );
    END IF;

    -- Confirmed by a legacy flow with no entry — needs manual draw, not auto-assign.
    RETURN jsonb_build_object('ok', false, 'error', 'already_confirmed_no_entry');
  END IF;

  -- 4. Must be pending to proceed.
  IF v_reg.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_reg.status);
  END IF;

  -- 5. Lock the tournament (serializes all draws for this tournament).
  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = v_reg.tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  -- 6. Tournament must be open.
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 7. Starting stack + display name.
  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  SELECT COALESCE(NULLIF(TRIM(display_name), ''), 'PLAYER')
  INTO v_display_name
  FROM public.profiles
  WHERE user_id = v_reg.player_id;
  v_display_name := COALESCE(v_display_name, 'PLAYER');

  -- 8. Next entry number for re-entry (authoritative source = tournament_entries).
  SELECT COALESCE(MAX(entry_no), 0) + 1
  INTO v_entry_no
  FROM public.tournament_entries
  WHERE tournament_id = v_reg.tournament_id
    AND player_id = v_reg.player_id;

  -- 8b. A player may hold only ONE active seat at a time.
  PERFORM 1
  FROM public.tournament_seats
  WHERE tournament_id = v_reg.tournament_id
    AND player_id = v_reg.player_id
    AND is_active = true;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_already_active');
  END IF;

  -- 9. Pick a table with free capacity, then a random free seat.
  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count
      FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = v_reg.tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
    ORDER BY tt.table_number ASC NULLS LAST, c.active_count ASC
    LIMIT 1;
  ELSE
    -- random_balanced (default): lowest occupancy first, random tie-break.
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count
      FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = v_reg.tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
    ORDER BY c.active_count ASC, random()
    LIMIT 1;
  END IF;

  IF v_table_tour_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  -- 10. Random empty seat number in the chosen table.
  SELECT s.n
  INTO v_seat_number
  FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tournament_seats ts
    WHERE ts.table_id = v_table_tour_id
      AND ts.seat_number = s.n
      AND ts.is_active = true
  )
  ORDER BY random()
  LIMIT 1;

  IF v_seat_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_seat_available');
  END IF;

  -- 11. Create the entry (seated).
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_number, seated_at
  ) VALUES (
    v_reg.tournament_id, p_registration_id, v_reg.player_id, v_entry_no, 'online',
    'seated', v_starting_stack, v_table_game_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  -- 12. Create the live seat row (tracker reads is_active + player_name).
  INSERT INTO public.tournament_seats (
    tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
  ) VALUES (
    v_reg.tournament_id, v_reg.player_id, v_entry_no, v_table_tour_id, v_seat_number,
    v_starting_stack, true, v_display_name, v_entry_id, 'active', p_actor_user_id, now()
  ) RETURNING id INTO v_seat_id;

  -- 13. Link the seat back onto the entry.
  UPDATE public.tournament_entries
  SET seat_id = v_seat_id
  WHERE id = v_entry_id;

  -- 14. Confirm the registration.
  UPDATE public.tournament_registrations
  SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_user_id
  WHERE id = p_registration_id;

  -- 15. Issue receipt (retry on unlikely UNIQUE collision).
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_table_number::text, '?'),
      v_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        v_reg.tournament_id, p_registration_id, v_entry_id, v_reg.player_id, v_display_name,
        v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1,
          'receipt_code', v_receipt_code,
          'entry_id', v_entry_id,
          'tournament_id', v_reg.tournament_id,
          'player_id', v_reg.player_id,
          'table_number', v_table_number,
          'seat_number', v_seat_number
        ),
        'initial', 'issued', p_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 16. Audit history.
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_reg.tournament_id, v_entry_id, v_reg.player_id,
    v_table_game_id, v_table_number, v_seat_number,
    'initial_draw', 'initial', p_actor_user_id,
    jsonb_build_object('draw_mode', p_draw_mode, 'registration_id', p_registration_id)
  );

  -- 17. Result.
  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', p_registration_id,
    'entry_id', v_entry_id,
    'seat_id', v_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code,
    'table_id', v_table_game_id,
    'table_number', v_table_number,
    'seat_number', v_seat_number,
    'display_name', v_display_name,
    'starting_stack', v_starting_stack
  );
END;
$function$;

-- Lock down EXECUTE: remove anonymous/public access; keep authenticated + service_role.
REVOKE EXECUTE ON FUNCTION public.confirm_registration_and_assign_seat(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirm_registration_and_assign_seat(uuid, uuid, text) TO authenticated, service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN
--   CREATE OR REPLACE + grant changes only — no irreversible DDL.
--   To revert: run docs/emergency_rollbacks/P0_GUARD_V2_rollback_confirm_registration_oid_271766.sql
--   (restores the pre-v2 body; grant re-grant is commented there with a security warning).
-- ═══════════════════════════════════════════════════════════════════════════════
