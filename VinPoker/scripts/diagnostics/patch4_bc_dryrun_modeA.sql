-- ============================================================================
-- PATCH 4 / STAGE B + C — Mode A CONTROLLED DRY-RUN  (BEGIN … ROLLBACK, ZERO COMMIT)
-- ============================================================================
-- Run the WHOLE block at ONCE in the Supabase SQL Editor. Applies B + C inside ONE transaction, runs
-- structural asserts + the 9-case headless test, returns ONE combined result grid, then ROLLBACKs
-- everything (nothing persists). The Editor shows the LAST result grid, which is that combined grid.
-- Rollback proof = the separate file patch4_bc_rollback_proof.sql (must run AFTER, post-rollback reads).
-- Do NOT add a COMMIT. Do NOT run piecemeal.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS _dryrun_asserts;
CREATE TEMP TABLE _dryrun_asserts(seq int, check_name text, result text);

-- ===== STAGE B (20261122000000) =====
-- PATCH 4 / STAGE B — tournament_registrations.source_entry_id + re-entry-aware active uniques.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: an online re-entry needs a PENDING registration (pay-first), but a busted player still holds their
-- ORIGINAL registration at status='confirmed' — so the existing `uniq_treg_active` (one live reg per
-- tournament+player) would block a second pending re-entry reg. This (1) adds `source_entry_id` to link a
-- re-entry reg to its busted source entry (so the confirm step knows which entry to re-enter), and (2)
-- replaces `uniq_treg_active` with two partial uniques that keep the INITIAL-reg behaviour byte-identical
-- while allowing one live re-entry per busted entry.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP INDEX IF EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS.
-- Rollback (only while no re-entry rows exist): drop the two new indexes; recreate uniq_treg_active on
-- (tournament_id, player_id) WHERE status IN ('pending','confirmed'); ALTER TABLE … DROP COLUMN source_entry_id.

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS source_entry_id uuid REFERENCES public.tournament_entries(id) ON DELETE SET NULL;

-- Drop the old "one live reg per tournament+player" unique (it blocks the pending re-entry).
DROP INDEX IF EXISTS public.uniq_treg_active;

-- INITIAL regs: one live (pending/confirmed) per (tournament, player) — UNCHANGED behaviour, scoped to
-- non-re-entry rows (source_entry_id IS NULL). Every existing row has source_entry_id NULL → covered.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_treg_active_initial
  ON public.tournament_registrations (tournament_id, player_id)
  WHERE status IN ('pending', 'confirmed') AND source_entry_id IS NULL;

-- RE-ENTRY regs: at most ONE live re-entry per busted source entry (prevents double-tap / two-device duplicate
-- re-entry for the same bust; still allows re-entry across DIFFERENT busted entries — entry_no increments).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_treg_pending_reentry_per_entry
  ON public.tournament_registrations (source_entry_id)
  WHERE status IN ('pending', 'confirmed') AND source_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treg_source_entry
  ON public.tournament_registrations (source_entry_id)
  WHERE source_entry_id IS NOT NULL;

-- ===== STAGE C helper/confirm (20261122000001) =====
-- PATCH 4 / STAGE C — shared re-entry seat helper + reenter refactor + confirm_reentry_and_assign_seat.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched. Apply AFTER STAGE B
-- (20261122000000 — needs tournament_registrations.source_entry_id).
--
-- WHY: online re-entry is pay-first — a PENDING re-entry reg (STAGE B) must, on payment, become confirmed +
-- get a seat. This adds confirm_reentry_and_assign_seat (mirrors confirm_registration_and_assign_seat's guards
-- for the pay-first shape) and, to avoid TWO forks of the proven seat-draw, extracts the seat draw/claim/
-- entry/receipt/history into ONE shared helper `_assign_reentry_seat` that BOTH the existing cashier
-- reenter_tournament_player AND the new confirm call. No copy-paste of seat logic → no drift.
--
-- confirm_registration_and_assign_seat (the INITIAL path, 20260811000000) is NOT touched.
-- Idempotent: CREATE OR REPLACE FUNCTION; explicit REVOKE/GRANT.
-- Rollback: see docs/sepay/ runbook — DROP confirm_reentry_and_assign_seat + _assign_reentry_seat and
--   CREATE OR REPLACE reenter_tournament_player back to its 20260901000001 body.

-- ============================================================================
-- 1. Shared seat-draw helper. INTERNAL ONLY (REVOKEd from everyone): the two SECURITY DEFINER callers
--    (owned by the migration role) can invoke it; a direct authenticated/anon call is denied. It does NOT
--    gate auth or re-validate state — the CALLERS do that before invoking it. It draws+claims a seat, creates
--    the new seated entry (entry_no = MAX+1, source preserved from the busted entry), links the seat, issues a
--    receipt, and writes audit history. Returns the same shape the confirm fns return on success, or
--    {ok:false,error:'no_table_available'|'no_seat_available'|'seat_occupied'} with NOTHING else written.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._assign_reentry_seat(
  p_tournament_id   uuid,
  p_player_id       uuid,
  p_source_entry_id uuid,
  p_registration_id uuid,
  p_actor_user_id   uuid,
  p_draw_mode       text,
  p_starting_stack  integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name           TEXT;
  v_source         TEXT;
  v_entry_no       INTEGER;
  v_entry_id       UUID;
  v_seat_id        UUID;
  v_seat_number    INTEGER;
  v_table_tour_id  UUID;   -- tournament_tables.id (FK target for tournament_seats)
  v_table_game_id  UUID;   -- game_tables.id        (FK target for entries/receipts/history)
  v_table_number   INTEGER;
  v_max_seats      INTEGER;
  v_receipt_id     UUID;
  v_receipt_code   TEXT;
  v_attempt        INTEGER := 0;
BEGIN
  -- source channel preserved from the busted entry
  SELECT source INTO v_source FROM public.tournament_entries WHERE id = p_source_entry_id;
  v_source := COALESCE(v_source, 'online');

  -- display name (profile → prior receipt → prior seat → fallback)
  v_name := COALESCE(
    (SELECT NULLIF(TRIM(p.display_name), '') FROM public.profiles p WHERE p.user_id = p_player_id),
    (SELECT sdr.display_name FROM public.seat_draw_receipts sdr WHERE sdr.entry_id = p_source_entry_id ORDER BY sdr.issued_at DESC LIMIT 1),
    (SELECT ts.player_name FROM public.tournament_seats ts WHERE ts.entry_id = p_source_entry_id ORDER BY ts.assigned_at DESC NULLS LAST LIMIT 1),
    'PLAYER'
  );

  -- next entry number for this player
  SELECT COALESCE(MAX(entry_no), 0) + 1 INTO v_entry_no
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- draw a table with free capacity — NO WRITES YET
  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active' AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
    ORDER BY tt.table_number ASC NULLS LAST, c.active_count ASC
    LIMIT 1;
  ELSE
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active' AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
    ORDER BY c.active_count ASC, random()
    LIMIT 1;
  END IF;
  IF v_table_tour_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  -- random empty seat in that table — NO WRITES YET
  SELECT s.n INTO v_seat_number
  FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tournament_seats ts
    WHERE ts.table_id = v_table_tour_id AND ts.seat_number = s.n AND ts.is_active = true
  )
  ORDER BY random()
  LIMIT 1;
  IF v_seat_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_seat_available');
  END IF;

  -- claim the seat first (concurrent claim → partial unique throws → seat_occupied, nothing else written)
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      p_tournament_id, p_player_id, v_entry_no, v_table_tour_id, v_seat_number,
      p_starting_stack, true, v_name, 'active', p_actor_user_id, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  -- new seated entry (entry_no incremented, source preserved) + link the seat
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, p_registration_id, p_player_id, v_entry_no, v_source,
    'seated', p_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- receipt (retry code on collision)
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_table_number::text, '?'), v_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        p_tournament_id, p_registration_id, v_entry_id, p_player_id, v_name,
        v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', p_player_id,
          'table_number', v_table_number, 'seat_number', v_seat_number,
          'reentry', true, 'entry_no', v_entry_no),
        'initial', 'issued', p_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- audit history (reason='re_entry')
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    p_tournament_id, v_entry_id, p_player_id,
    v_table_game_id, v_table_number, v_seat_number,
    're_entry', 'initial', p_actor_user_id,
    jsonb_build_object('draw_mode', p_draw_mode, 'registration_id', p_registration_id,
      'entry_no', v_entry_no, 'from_entry_id', p_source_entry_id)
  );

  RETURN jsonb_build_object(
    'ok', true, 'entry_id', v_entry_id, 'seat_id', v_seat_id, 'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code, 'table_id', v_table_game_id, 'table_number', v_table_number,
    'seat_number', v_seat_number, 'display_name', v_name, 'entry_no', v_entry_no,
    'starting_stack', p_starting_stack
  );
END;
$$;

-- INTERNAL ONLY: deny direct callers; the SECURITY DEFINER callers (owned by the migration role) invoke it.
REVOKE ALL ON FUNCTION public._assign_reentry_seat(uuid, uuid, uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 2. Refactor reenter_tournament_player to CALL the shared helper (no forked seat logic). Its gates,
--    auth, and cash-reg creation are UNCHANGED; only the old steps 8-14 are replaced by the helper call
--    (+ undo the just-created reg if the draw fails, so we never orphan a confirmed cash reg without a seat).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reenter_tournament_player(
  p_entry_id   UUID,
  p_buy_in     BIGINT,
  p_fee        BIGINT,
  p_draw_mode  TEXT DEFAULT 'random_balanced'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id  UUID := auth.uid();
  v_authorized     BOOLEAN;
  v_src            RECORD;
  v_tour           RECORD;
  v_player_id      UUID;
  v_entry_no       INTEGER;
  v_reg_id         UUID;
  v_ref_code       TEXT;
  v_starting_stack INTEGER;
  v_res            JSONB;
  v_attempt        INTEGER := 0;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_buy_in');
  END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_fee');
  END IF;
  IF p_draw_mode NOT IN ('random_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  SELECT * INTO v_src FROM public.tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_src.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status);
  END IF;
  v_player_id := v_src.player_id;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_src.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = v_src.tournament_id
      AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM 1 FROM public.tournament_seats
  WHERE tournament_id = v_src.tournament_id AND player_id = v_player_id AND is_active = true;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_already_active');
  END IF;

  -- P1-1 (STAGE C review): if a LIVE (pending/confirmed) re-entry reg already exists for THIS busted entry,
  -- return a clean structured error instead of letting the reg INSERT below collide on STAGE B's
  -- uniq_treg_pending_reentry_per_entry. The reg LOOP only re-rolls v_ref_code (not source_entry_id), so a
  -- source_entry_id collision would exhaust all 5 retries and RAISE a raw unique_violation to the cashier UI.
  -- Fail closed, cleanly — no double-seat, no duplicate reg either way; this just makes the error structured.
  PERFORM 1 FROM public.tournament_registrations
  WHERE source_entry_id = p_entry_id AND status IN ('pending', 'confirmed');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reentry_already_pending');
  END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  -- new confirmed cash registration (re-entry payment → revenue + audit); retry ref on collision
  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('REENTRY-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (
        tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay,
        reference_code, status, committed_at, confirmed_at, confirmed_by, source_entry_id
      ) VALUES (
        v_src.tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee,
        v_ref_code, 'confirmed', now(), now(), v_actor_user_id, p_entry_id
      ) RETURNING id INTO v_reg_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- shared draw/seat/entry/receipt/history
  v_res := public._assign_reentry_seat(
    v_src.tournament_id, v_player_id, p_entry_id, v_reg_id, v_actor_user_id, p_draw_mode, v_starting_stack);

  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    -- draw failed (no_table/no_seat/seat_occupied) → undo the reg we just created (nothing else was written)
    DELETE FROM public.tournament_registrations WHERE id = v_reg_id;
    RETURN v_res;
  END IF;

  RETURN v_res || jsonb_build_object('registration_id', v_reg_id, 'reference_code', v_ref_code);
END;
$$;

REVOKE ALL ON FUNCTION public.reenter_tournament_player(UUID, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reenter_tournament_player(UUID, BIGINT, BIGINT, TEXT) TO authenticated;

-- ============================================================================
-- 3. confirm_reentry_and_assign_seat — pay-first re-entry confirm. Mirrors confirm_registration_and_assign_seat
--    guards 2.4 (p_actor = auth.uid()) + 2.5 (owner/cashier) so the SePay system-bot impersonation in settle
--    works identically. Confirms ONLY a PENDING re-entry reg (source_entry_id NOT NULL) and RE-VALIDATES the
--    re-entry state at confirm time. Draws the seat via the shared helper BEFORE flipping the reg → confirmed,
--    so a draw failure leaves the reg pending (settle flags it, money never lost, no orphan-confirmed reg).
--    Amount/reference exactness is enforced UPSTREAM by settle's exact-match gate (same as the initial path —
--    confirm_registration_and_assign_seat does not re-check the amount either).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_reentry_and_assign_seat(
  p_registration_id uuid,
  p_actor_user_id   uuid,
  p_draw_mode       text DEFAULT 'random_balanced'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg  RECORD;
  v_tour RECORD;
  v_src  RECORD;
  v_e    RECORD;
  v_res  jsonb;
  v_lvl  int;
  v_close int;
BEGIN
  -- 1. Lock the registration.
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found'); END IF;

  -- must be a re-entry reg (source_entry_id set)
  IF v_reg.source_entry_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_a_reentry'); END IF;

  -- 2.4 actor = auth.uid()  +  2.5 owner/cashier  (identical predicates to confirm_registration_and_assign_seat)
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.tournaments t
   WHERE t.id = v_reg.tournament_id
     AND (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = t.club_id AND c.owner_id = p_actor_user_id)
          OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = t.club_id AND cc.user_id = p_actor_user_id));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;

  -- 3. Idempotency: already confirmed AND already produced an entry → return it (no double-seat).
  IF v_reg.status = 'confirmed' THEN
    SELECT te.id AS entry_id, te.seat_id, te.seat_number,
           sdr.id AS receipt_id, sdr.receipt_code, sdr.table_number, sdr.display_name
    INTO v_e
    FROM public.tournament_entries te
    LEFT JOIN public.seat_draw_receipts sdr ON sdr.entry_id = te.id AND sdr.draw_type = 'initial'
    WHERE te.registration_id = p_registration_id
    ORDER BY te.created_at ASC LIMIT 1;
    IF FOUND AND v_e.entry_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'registration_id', p_registration_id,
        'entry_id', v_e.entry_id, 'seat_id', v_e.seat_id, 'receipt_id', v_e.receipt_id,
        'receipt_code', v_e.receipt_code, 'table_number', v_e.table_number,
        'seat_number', v_e.seat_number, 'display_name', v_e.display_name);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_confirmed_no_entry');
  END IF;

  -- 4. Must be pending.
  IF v_reg.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_reg.status);
  END IF;

  -- 5. Lock tournament + must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_reg.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 6. Re-entry window still open (late-reg not closed).
  v_lvl := v_tour.current_level;
  v_close := COALESCE(v_tour.late_reg_close_level, 6);
  IF v_lvl IS NOT NULL AND v_lvl > v_close THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reentry_window_closed',
      'current_level', v_lvl, 'late_reg_close_level', v_close);
  END IF;

  -- 7. Source entry: same player + tournament, and still busted (floor-removed).
  SELECT * INTO v_src FROM public.tournament_entries WHERE id = v_reg.source_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'source_entry_not_found'); END IF;
  IF v_src.player_id IS DISTINCT FROM v_reg.player_id OR v_src.tournament_id IS DISTINCT FROM v_reg.tournament_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source_entry_mismatch');
  END IF;
  IF v_src.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status);
  END IF;

  -- 8. One active seat per player.
  PERFORM 1 FROM public.tournament_seats
   WHERE tournament_id = v_reg.tournament_id AND player_id = v_reg.player_id AND is_active = true;
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'player_already_active'); END IF;

  -- 9. Draw + seat via the SHARED helper. Only flip the reg → confirmed if the draw succeeded.
  v_res := public._assign_reentry_seat(
    v_reg.tournament_id, v_reg.player_id, v_reg.source_entry_id, p_registration_id,
    p_actor_user_id, p_draw_mode, COALESCE(v_tour.starting_stack, 0));
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN v_res;  -- no_table/no_seat/seat_occupied → reg stays pending; settle flags it (money not lost)
  END IF;

  UPDATE public.tournament_registrations
    SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_user_id
    WHERE id = p_registration_id;

  RETURN v_res || jsonb_build_object('registration_id', p_registration_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_reentry_and_assign_seat(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirm_reentry_and_assign_seat(uuid, uuid, text) TO authenticated, service_role;

-- ===== STAGE C settle (20261123000000) =====
-- PATCH 4 / STAGE C — settle_bank_transaction: dispatch re-entry confirms to confirm_reentry_and_assign_seat.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session AFTER 20261122000000 (STAGE B,
-- source_entry_id) + 20261122000001 (confirm_reentry_and_assign_seat). schema_migrations untouched.
--
-- BYTE-BASELINE = 20261118000000_sepay_settle_auto_confirm_system_actor.sql (the production-validated body).
-- TWO deliberate changes vs that baseline, NOTHING else:
--   (1) The single exact-match confirm call becomes a dispatch on v_reg.source_entry_id —
--         source_entry_id IS NULL  → confirm_registration_and_assign_seat   (INITIAL path, BYTE-UNCHANGED)
--         source_entry_id NOT NULL → confirm_reentry_and_assign_seat        (pay-first re-entry)
--   (2) P1-2 (STAGE C review) — the matched-registration SELECT (step 6) gains `FOR UPDATE` so two settlement
--       workers carrying the same reference_code (a double-pay) serialize on the reg row: the 2nd blocks, then
--       sees status='confirmed' → flagged_not_pending, instead of racing into confirm and RAISEing on the
--       per-reg auto_confirmed unique index. This is the only expansion beyond the dispatch; it hardens BOTH
--       paths and changes neither path's single-payment behaviour (confirm_* re-locks the same row anyway).
-- Everything else (lock order, idempotency, fraud gate, club resolution, exact-match gate, the 3 system-actor
-- gates, bot impersonation save/restore, outcome mapping incl. raw error → reason, the settlement INSERT) is
-- IDENTICAL. A re-entry confirm failure (entry_not_reenterable / reentry_window_closed / no_table / etc.) flows
-- through the SAME outcome handling → flagged (never silent-lost); the raw error is preserved in `reason`.
--
-- Plus a double-pay safeguard: at most ONE auto_confirmed settlement per registration.
-- Idempotent: CREATE OR REPLACE FUNCTION; CREATE UNIQUE INDEX IF NOT EXISTS.
-- Rollback: CREATE OR REPLACE settle_bank_transaction back to the 20261118000000 body (instant, no DDL);
--   DROP INDEX uniq_payment_settlements_autoconfirm_per_reg. (See docs/sepay/ runbook.)

CREATE OR REPLACE FUNCTION public.settle_bank_transaction(
  p_bank_transaction_id uuid,
  p_auto_confirm        boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bt            public.bank_transactions;
  v_club_id       uuid;
  v_ref           text;
  v_reg           public.tournament_registrations;
  v_reg_count     int := 0;
  v_club_count    int := 0;
  v_existing      text;
  v_settle_reg_id uuid := NULL;
  v_expected      bigint := NULL;
  v_confirm       jsonb;
  v_outcome       text;
  v_reason        text := NULL;
  v_conf_reg_id   uuid := NULL;
  v_actor_id      uuid := NULL;     -- the SePay system bot (read from sepay_system_settings); NULL = auto off
  v_saved         text;             -- caller's original request.jwt.claims, saved before impersonation
BEGIN
  -- 1. Lock the bank txn row FIRST (consistent lock order — see header).
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank_txn_not_found');
  END IF;

  -- 2. ONE settlement per bank txn (idempotency + anti-duplicate).
  SELECT outcome INTO v_existing
  FROM public.payment_settlements
  WHERE bank_transaction_id = p_bank_transaction_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true, 'outcome', v_existing);
  END IF;
  IF v_bt.status <> 'unmatched' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', v_bt.status);
  END IF;

  -- 3. Fraud gate + settleable shape.
  IF v_bt.api_verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_api_verified');
  END IF;
  IF v_bt.transfer_type IS DISTINCT FROM 'in' OR v_bt.amount IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_settleable_shape');
  END IF;

  -- 4. Resolve club from the MASTER account number (exactly one active club, else NULL → flag).
  SELECT count(DISTINCT pba.club_id) INTO v_club_count
  FROM public.platform_bank_accounts pba
  WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL;
  IF v_club_count = 1 THEN
    SELECT pba.club_id INTO v_club_id
    FROM public.platform_bank_accounts pba
    WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL
    LIMIT 1;
  END IF;

  -- 5. Parse the reference_code (exactly one VINReg/REENTRY token or NULL) from memo + ref.
  v_ref := public.sepay_parse_reference_code(coalesce(v_bt.content,'') || ' ' || coalesce(v_bt.txn_ref,''));

  -- 6. Match the registration (reference_code is globally UNIQUE; compare case-insensitively).
  IF v_ref IS NOT NULL THEN
    SELECT count(*) INTO v_reg_count
    FROM public.tournament_registrations tr WHERE upper(tr.reference_code) = upper(v_ref);
    IF v_reg_count = 1 THEN
      -- P1-2 (STAGE C review): lock the matched registration row HERE, before the status/pending gate below.
      -- This is the ONLY intentional behavioural change beyond the source_entry_id dispatch block. Two
      -- settlement workers carrying the SAME reference_code (a double-pay = two bank txns) now SERIALIZE on
      -- this row: the 2nd blocks until the 1st commits, then re-reads status='confirmed' → falls to
      -- flagged_not_pending at the status gate, instead of both passing the pending gate, racing into confirm,
      -- and the 2nd RAISEing on the uniq_payment_settlements_autoconfirm_per_reg belt (which would roll back
      -- and leave its bank txn unmatched for ~5 min). Deterministic result: exactly 1 auto_confirmed + 1 seat;
      -- the 2nd payment is cleanly flagged for cashier refund. Hardens BOTH paths' concurrent double-pay; the
      -- single-payment behaviour of each path is unchanged (confirm_*_and_assign_seat re-locks the same row
      -- inside its own body, so this is a no-op there).
      SELECT * INTO v_reg
      FROM public.tournament_registrations tr WHERE upper(tr.reference_code) = upper(v_ref) LIMIT 1
      FOR UPDATE;
      v_settle_reg_id := v_reg.id;
      v_expected      := v_reg.total_pay;
    END IF;
  END IF;

  -- 7. Decision tree. Exact match + all 3 gates → auto-confirm; everything else → flag (never confirm).
  IF v_ref IS NULL OR v_reg_count = 0 THEN
    v_outcome := 'flagged_no_match';
    v_reason  := format('ref=%s reg_count=%s', coalesce(v_ref, '<none>'), v_reg_count);
  ELSIF v_reg_count > 1 THEN
    v_outcome := 'flagged_duplicate';
    v_reason  := format('reg_count=%s', v_reg_count);
  ELSE
    -- exactly one reg (v_reg assigned)
    IF v_club_id IS NULL OR v_reg.club_id IS DISTINCT FROM v_club_id THEN
      v_outcome := 'flagged_no_match';
      v_reason  := 'club unresolved or club mismatch';
    ELSIF v_reg.status <> 'pending' THEN
      v_outcome := 'flagged_not_pending';
      v_reason  := format('reg.status=%s', v_reg.status);
    ELSIF v_bt.amount IS DISTINCT FROM v_reg.total_pay THEN
      v_outcome := 'flagged_amount_mismatch';
      v_reason  := format('amount=%s expected=%s', v_bt.amount, v_reg.total_pay);
    ELSE
      -- EXACT MATCH.
      -- Gate 1: edge env (via p_auto_confirm). OFF → flag-only (write nothing; cashier confirms).
      IF NOT p_auto_confirm THEN
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'registration_id', v_settle_reg_id);
      END IF;

      -- Gate 2: DB global kill-switch + provisioned system actor.
      SELECT s.system_actor_id INTO v_actor_id
      FROM public.sepay_system_settings s
      WHERE s.auto_confirm_enabled = true
      LIMIT 1;
      IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'reason', 'auto_disabled', 'registration_id', v_settle_reg_id);
      END IF;

      -- Gate 3 (EXPLICIT — NOT inferred from confirm's error string): the bot must be a cashier (or owner)
      -- of the resolved club = the club opted in. is_club_cashier uses the SAME predicate as confirm's
      -- guard 2.5 (owner OR club_cashiers). If not opted in → flag-only (semi-auto; cashier confirms).
      IF NOT public.is_club_cashier(v_actor_id, v_club_id) THEN
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'reason', 'club_not_opted_in', 'registration_id', v_settle_reg_id);
      END IF;

      -- Auto-confirm by REUSING confirm+seat, impersonating the bot ONLY around that call.
      -- SAVE the caller's original claims and RESTORE them on EVERY path (success OR raise). If settle is
      -- ever called WITH a JWT (not just the headless cron), that identity is preserved and the bot identity
      -- never leaks into the settlement INSERT / bt UPDATE below (which must run as the original caller).
      BEGIN
        v_saved := current_setting('request.jwt.claims', true);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor_id::text)::text, true);
        -- PATCH 4: dispatch on source_entry_id. INITIAL path is BYTE-UNCHANGED; re-entry uses the pay-first confirm.
        IF v_reg.source_entry_id IS NULL THEN
          v_confirm := public.confirm_registration_and_assign_seat(v_reg.id, v_actor_id, 'random_balanced');
        ELSE
          v_confirm := public.confirm_reentry_and_assign_seat(v_reg.id, v_actor_id, 'random_balanced');
        END IF;
        PERFORM set_config('request.jwt.claims', COALESCE(v_saved, ''), true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claims', COALESCE(v_saved, ''), true);
        v_confirm := jsonb_build_object('ok', false, 'error', 'confirm_exception');
      END;

      IF COALESCE((v_confirm->>'ok')::boolean, false) THEN
        v_outcome     := 'auto_confirmed';
        v_conf_reg_id := v_reg.id;
        UPDATE public.bank_transactions
          SET status = 'matched', processed_at = now(), club_id = v_club_id
          WHERE id = p_bank_transaction_id;
      ELSIF (v_confirm->>'error') IN ('no_table_available', 'no_seat_available') THEN
        v_outcome := 'flagged_seating_failed';
        v_reason  := v_confirm->>'error';
      ELSE
        -- Any other confirm failure (incl. an UNEXPECTED actor_not_allowed — gate 3 verified above) → flag.
        v_outcome := 'flagged_not_pending';
        v_reason  := coalesce(v_confirm->>'error', 'confirm_failed');
      END IF;
    END IF;
  END IF;

  -- 8. Record the settlement (every path that reaches here; the flag-only returns exited above).
  --    confirmed_by = the bot uid on auto_confirmed (honest machine identity), else NULL.
  INSERT INTO public.payment_settlements
    (bank_transaction_id, tournament_registration_id, club_id, amount, expected_amount,
     reference_code, outcome, confirmed_by, reason)
  VALUES
    (p_bank_transaction_id, v_settle_reg_id, v_club_id, v_bt.amount, v_expected,
     v_ref, v_outcome, CASE WHEN v_outcome = 'auto_confirmed' THEN v_actor_id ELSE NULL END, v_reason);

  RETURN jsonb_build_object('ok', true, 'outcome', v_outcome,
                            'registration_id', v_conf_reg_id, 'club_id', v_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_bank_transaction(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.settle_bank_transaction(uuid, boolean) TO service_role;

-- Double-pay safeguard: at most ONE auto_confirmed settlement per registration. The per-reg pending→confirmed
-- flip already blocks a 2nd auto-confirm in sequential cron processing; this is the concurrency belt.
-- (If this errors on apply, an existing duplicate auto_confirmed exists — investigate before forcing.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_settlements_autoconfirm_per_reg
  ON public.payment_settlements (tournament_registration_id)
  WHERE outcome = 'auto_confirmed';

-- ===== STRUCTURAL ASSERTS (after B + C applied in-txn) =====
INSERT INTO _dryrun_asserts(seq, check_name, result) VALUES
 (1,  'B: source_entry_id column exists',
   CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_registrations' AND column_name='source_entry_id') THEN 'PASS' ELSE 'FAIL' END),
 (2,  'B: uniq_treg_active_initial exists',
   CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_active_initial') THEN 'PASS' ELSE 'FAIL' END),
 (3,  'B: uniq_treg_pending_reentry_per_entry exists',
   CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_pending_reentry_per_entry') THEN 'PASS' ELSE 'FAIL' END),
 (4,  'B: old uniq_treg_active is GONE',
   CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_active') THEN 'PASS' ELSE 'FAIL' END),
 (5,  'C: _assign_reentry_seat exists',
   CASE WHEN to_regprocedure('public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END),
 (6,  'C: reenter_tournament_player calls helper',
   CASE WHEN to_regprocedure('public.reenter_tournament_player(uuid,bigint,bigint,text)') IS NOT NULL AND pg_get_functiondef(to_regprocedure('public.reenter_tournament_player(uuid,bigint,bigint,text)')) ~ '_assign_reentry_seat' THEN 'PASS' ELSE 'FAIL' END),
 (7,  'C: confirm_reentry_and_assign_seat exists',
   CASE WHEN to_regprocedure('public.confirm_reentry_and_assign_seat(uuid,uuid,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END),
 (8,  'C: settle dispatches to re-entry confirm',
   CASE WHEN to_regprocedure('public.settle_bank_transaction(uuid,boolean)') IS NOT NULL AND pg_get_functiondef(to_regprocedure('public.settle_bank_transaction(uuid,boolean)')) ~ 'confirm_reentry_and_assign_seat' THEN 'PASS' ELSE 'FAIL' END),
 (9,  'C: settle reg-select has FOR UPDATE',
   CASE WHEN to_regprocedure('public.settle_bank_transaction(uuid,boolean)') IS NOT NULL AND pg_get_functiondef(to_regprocedure('public.settle_bank_transaction(uuid,boolean)')) ~ 'upper\(v_ref\)\s+LIMIT 1\s+FOR UPDATE' THEN 'PASS' ELSE 'FAIL' END),
 (10, 'C: uniq_payment_settlements_autoconfirm_per_reg exists',
   CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_payment_settlements_autoconfirm_per_reg') THEN 'PASS' ELSE 'FAIL' END);

-- ===== 9-CASE HEADLESS TEST (inlined; populates _re_results) =====
DROP TABLE IF EXISTS _re_results;
CREATE TEMP TABLE _re_results (case_no int, scenario text, expected text, actual text);

DO $$
DECLARE
  v_club uuid;
  v_bot  uuid;
  v_ret  jsonb;
  v_seats int;
  v_autoconf int;
  v_st text;
  v_e1 uuid;
BEGIN
  SELECT id INTO v_club FROM public.clubs ORDER BY created_at, id LIMIT 1;
  IF v_club IS NULL THEN RAISE EXCEPTION 'RE-SBX: no club'; END IF;
  SELECT id INTO v_bot FROM auth.users
    WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role)
    ORDER BY created_at LIMIT 1;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'RE-SBX: need a non-super auth.users row as the bot'; END IF;

  -- provision the 3 gates: settings (bot + DB switch ON) + opt-in club (bot ∈ club_cashiers)
  UPDATE public.sepay_system_settings SET system_actor_id = v_bot, auto_confirm_enabled = true WHERE id = true;
  INSERT INTO public.club_cashiers (club_id, user_id) VALUES (v_club, v_bot) ON CONFLICT DO NOTHING;

  -- seatable tournament (window OPEN: current_level 1 <= late_reg_close_level 6) + a closed-window one
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time, current_level, late_reg_close_level) VALUES
    ('ae500000-0000-0000-0000-000000000001', v_club, '[RESBX] open',   'active', 10000, 100000, now()+interval '1 day', 1, 6),
    ('ae500000-0000-0000-0000-000000000009', v_club, '[RESBX] closed', 'active', 10000, 100000, now()+interval '1 day', 7, 6);
  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('ae500000-0000-0000-0000-0000000000a1', v_club, '[RESBX] gt1'),
    ('ae500000-0000-0000-0000-0000000000a9', v_club, '[RESBX] gt9');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('ae500000-0000-0000-0000-0000000000c1','ae500000-0000-0000-0000-000000000001','ae500000-0000-0000-0000-0000000000a1',1,9,'active'),
    ('ae500000-0000-0000-0000-0000000000c9','ae500000-0000-0000-0000-000000000009','ae500000-0000-0000-0000-0000000000a9',1,9,'active');
  INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, is_active, club_id) VALUES
    ('[RESBX] bank','RESBX-ACCT','[RESBX] holder','escrow', true, v_club);

  -- helper inline via explicit rows. Players re6…N. Each: a busted source entry, a PENDING re-entry reg
  -- (source_entry_id set), and an api-verified REENTRY bank txn. Tournament = open unless noted.
  -- entries (busted source) for cases 1,2(seated),3,4,6 ; case 7 uses an INITIAL pending reg (no source).
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('ae500000-0000-0000-0000-0000000000e1','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000001',1,'busted',0),
    ('ae500000-0000-0000-0000-0000000000e2','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000002',1,'seated',10000),  -- NOT busted
    ('ae500000-0000-0000-0000-0000000000e3','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000003',1,'busted',0),
    ('ae500000-0000-0000-0000-0000000000e4','ae500000-0000-0000-0000-000000000009','ae600000-0000-0000-0000-000000000004',1,'busted',0),  -- closed tour
    ('ae500000-0000-0000-0000-0000000000e6','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000006',1,'busted',0);
  -- case 3: player 3 ALSO holds an ACTIVE seat (contradiction we force to test the 8b guard)
  INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status, entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000f3','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000003',1,'ae500000-0000-0000-0000-0000000000c1',8,10000,true,'active','ae500000-0000-0000-0000-0000000000e3');

  -- pending re-entry regs (source_entry_id set) + an INITIAL pending reg for case 7
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000b1','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000001', v_club,100000,100000,'REENTRY-RE000001','pending','ae500000-0000-0000-0000-0000000000e1'),
    ('ae500000-0000-0000-0000-0000000000b2','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000002', v_club,100000,100000,'REENTRY-RE000002','pending','ae500000-0000-0000-0000-0000000000e2'),
    ('ae500000-0000-0000-0000-0000000000b3','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000003', v_club,100000,100000,'REENTRY-RE000003','pending','ae500000-0000-0000-0000-0000000000e3'),
    ('ae500000-0000-0000-0000-0000000000b4','ae500000-0000-0000-0000-000000000009','ae600000-0000-0000-0000-000000000004', v_club,100000,100000,'REENTRY-RE000004','pending','ae500000-0000-0000-0000-0000000000e4'),
    ('ae500000-0000-0000-0000-0000000000b6','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000006', v_club,100000,100000,'REENTRY-RE000006','pending','ae500000-0000-0000-0000-0000000000e6'),
    ('ae500000-0000-0000-0000-0000000000b7','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000007', v_club,100000,100000,'VINRegRE000007','pending',NULL);  -- INITIAL (regression)

  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
    ('ae100000-0000-0000-0000-000000000001','sepay','RE-01','RESBX-ACCT',100000,'in','re REENTRY-RE000001','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000002','sepay','RE-02','RESBX-ACCT',100000,'in','re REENTRY-RE000002','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000003','sepay','RE-03','RESBX-ACCT',100000,'in','re REENTRY-RE000003','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000004','sepay','RE-04','RESBX-ACCT',100000,'in','re REENTRY-RE000004','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000005','sepay','RE-05','RESBX-ACCT',555000,'in','re REENTRY-RE000001','unmatched', now()),  -- amount != total_pay; reg already used by case 1? no — see case 5 note
    ('ae100000-0000-0000-0000-0000000000d2','sepay','RE-06b','RESBX-ACCT',100000,'in','re REENTRY-RE000006','unmatched', now()),  -- double-pay bt #2 for reg r6
    ('ae100000-0000-0000-0000-000000000006','sepay','RE-06','RESBX-ACCT',100000,'in','re REENTRY-RE000006','unmatched', now()),  -- double-pay bt #1 for reg r6
    ('ae100000-0000-0000-0000-000000000007','sepay','RE-07','RESBX-ACCT',100000,'in','re VINRegRE000007','unmatched', now());

  -- ════════ HEADLESS: auth.uid() = NULL (service-role cron) ════════
  PERFORM set_config('request.jwt.claims', '', true);

  -- CASE 1 — re-entry pending + exact pay → auto_confirmed + seated + entry_no incremented + confirmed_by=bot
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000001', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000001' AND is_active=true;
  INSERT INTO _re_results VALUES (1, 're-entry exact pay → auto_confirmed + 1 active seat',
    'auto_confirmed + seats=1', format('%s + seats=%s', v_ret->>'outcome', v_seats));

  -- CASE 2 — source entry NOT busted (seated) → flag, no seat
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000002', true);
  INSERT INTO _re_results VALUES (2, 'source entry not busted → flag',
    'flagged_* (entry_not_reenterable)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-000000000002')));

  -- CASE 3 — player already holds an active seat → flag (player_already_active)
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000003', true);
  INSERT INTO _re_results VALUES (3, 'active seat exists → flag',
    'flagged_* (player_already_active)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-000000000003')));

  -- CASE 4 — late-reg window closed (current_level 7 > late_reg_close_level 6) → flag
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000004', true);
  INSERT INTO _re_results VALUES (4, 'window closed → flag',
    'flagged_* (reentry_window_closed)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-000000000004')));

  -- CASE 5 — amount mismatch (555000 != 100000) → flagged_amount_mismatch (settle gate, before confirm)
  -- NB: bt RE-05 carries REENTRY-RE000001, whose reg r1 is now 'confirmed' (case 1) → settle flags as
  -- not_pending BEFORE the amount check. To test amount-mismatch cleanly we use a fresh pending reg:
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('ae500000-0000-0000-0000-0000000000e5','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000005',1,'busted',0);
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000b5','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000005', v_club,100000,100000,'REENTRY-RE000005','pending','ae500000-0000-0000-0000-0000000000e5');
  UPDATE public.bank_transactions SET content='re REENTRY-RE000005' WHERE id='ae100000-0000-0000-0000-000000000005';
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000005', true);
  INSERT INTO _re_results VALUES (5, 'amount mismatch → flag', 'flagged_amount_mismatch', v_ret->>'outcome');

  -- CASE 6 — DOUBLE-PAY same reg (two bt, same REENTRY code): exactly 1 seat + 1 auto_confirmed; 2nd → flag.
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000006', true);  -- bt #1 → auto_confirmed
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-0000000000d2', true);  -- bt #2 → flag (reg confirmed)
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000006' AND is_active=true;
  SELECT count(*) INTO v_autoconf FROM public.payment_settlements WHERE tournament_registration_id='ae500000-0000-0000-0000-0000000000b6' AND outcome='auto_confirmed';
  SELECT outcome INTO v_st FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-0000000000d2';
  INSERT INTO _re_results VALUES (6, 'double-pay → 1 seat + 1 auto_confirmed + 2nd flagged',
    'seats=1 autoconf=1 bt2=flagged_not_pending', format('seats=%s autoconf=%s bt2=%s', v_seats, v_autoconf, v_st));

  -- CASE 7 — INITIAL path regression: source_entry_id NULL → confirm_registration_and_assign_seat (UNCHANGED)
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000007', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000007' AND is_active=true;
  INSERT INTO _re_results VALUES (7, 'INITIAL path still auto_confirms (regression)',
    'auto_confirmed + seats=1', format('%s + seats=%s', v_ret->>'outcome', v_seats));

  -- CASE 8 (P1-5) — direct confirm idempotency: re-calling confirm_reentry_and_assign_seat on the
  -- ALREADY-confirmed re-entry reg r1 (confirmed in case 1) returns idempotent:true with the SAME entry, and
  -- the active-seat count stays exactly 1 (no double-seat on a confirm re-run). Impersonate the bot because
  -- guard 2.4 requires p_actor = auth.uid(); restore the headless empty claim right after.
  SELECT id INTO v_e1 FROM public.tournament_entries
    WHERE registration_id='ae500000-0000-0000-0000-0000000000b1' ORDER BY created_at ASC LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bot::text)::text, true);
  v_ret := public.confirm_reentry_and_assign_seat('ae500000-0000-0000-0000-0000000000b1', v_bot, 'random_balanced');
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000001' AND is_active=true;
  INSERT INTO _re_results VALUES (8, 'confirm idempotency → idempotent, same entry, seats stay 1',
    'idempotent=true same_entry=t seats=1',
    format('idempotent=%s same_entry=%s seats=%s',
           coalesce(v_ret->>'idempotent','false'), ((v_ret->>'entry_id') = v_e1::text), v_seats));

  -- CASE 9 (P1-5) — table FULL at re-seat → flagged_seating_failed AND the re-entry reg STAYS pending
  -- (money recoverable, NO fake confirmed reg). Dedicated tournament re…00b: a single 1-seat table already
  -- filled by a filler player, plus a busted source entry + pending re-entry reg + api-verified bank txn for
  -- the re-entrant. The shared helper finds no table with free capacity → no_table_available → settle maps it
  -- to flagged_seating_failed; confirm_reentry returns BEFORE flipping the reg, so it remains 'pending'.
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time, current_level, late_reg_close_level) VALUES
    ('ae500000-0000-0000-0000-00000000000b', v_club, '[RESBX] full', 'active', 10000, 100000, now()+interval '1 day', 1, 6);
  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('ae500000-0000-0000-0000-0000000000ab', v_club, '[RESBX] gtb');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('ae500000-0000-0000-0000-0000000000cb','ae500000-0000-0000-0000-00000000000b','ae500000-0000-0000-0000-0000000000ab',1,1,'active');
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('ae500000-0000-0000-0000-0000000000eb','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000b',1,'seated',10000),  -- filler, occupies the only seat
    ('ae500000-0000-0000-0000-0000000000ea','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000a',1,'busted',0);     -- re-entrant's busted source
  -- filler seat: table_id = tournament_tables.id (cb) so the helper's capacity count sees it (matches the
  -- production seat-draw contract; NOT game_tables.id)
  INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status, entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000fb','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000b',1,'ae500000-0000-0000-0000-0000000000cb',1,10000,true,'active','ae500000-0000-0000-0000-0000000000eb');
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000bb','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000a', v_club,100000,100000,'REENTRY-RE00000B','pending','ae500000-0000-0000-0000-0000000000ea');
  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
    ('ae100000-0000-0000-0000-00000000000b','sepay','RE-0B','RESBX-ACCT',100000,'in','re REENTRY-RE00000B','unmatched', now());
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-00000000000b', true);
  SELECT status INTO v_st FROM public.tournament_registrations WHERE id='ae500000-0000-0000-0000-0000000000bb';
  INSERT INTO _re_results VALUES (9, 'table full → flagged_seating_failed, reg stays pending',
    'flagged_seating_failed reg=pending', format('%s reg=%s', v_ret->>'outcome', v_st));

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- ===== ONE COMBINED RESULT GRID (the Editor shows this — it is the last result before ROLLBACK) =====
SELECT '(1) ASSERT' AS section, seq, check_name AS label, result AS actual, result AS verdict
  FROM _dryrun_asserts
UNION ALL
SELECT '(2) CASE', case_no, scenario, actual,
  (CASE
    WHEN case_no IN (1,7) AND actual = 'auto_confirmed + seats=1' THEN 'PASS'
    WHEN case_no = 5 AND actual = 'flagged_amount_mismatch' THEN 'PASS'
    WHEN case_no = 6 AND actual = 'seats=1 autoconf=1 bt2=flagged_not_pending' THEN 'PASS'
    WHEN case_no = 2 AND actual LIKE 'flagged_%' AND actual LIKE '%entry_not_reenterable%' THEN 'PASS'
    WHEN case_no = 3 AND actual LIKE 'flagged_%' AND actual LIKE '%player_already_active%' THEN 'PASS'
    WHEN case_no = 4 AND actual LIKE 'flagged_%' AND actual LIKE '%reentry_window_closed%' THEN 'PASS'
    WHEN case_no = 8 AND actual = 'idempotent=true same_entry=t seats=1' THEN 'PASS'
    WHEN case_no = 9 AND actual = 'flagged_seating_failed reg=pending' THEN 'PASS'
    ELSE 'FAIL' END)
  FROM _re_results
ORDER BY 1, 2;

ROLLBACK;
