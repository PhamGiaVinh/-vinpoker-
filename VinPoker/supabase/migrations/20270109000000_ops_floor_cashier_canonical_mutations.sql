-- Ops Floor/Cashier canonical mutation contracts.
-- SOURCE-ONLY: do not apply in production from this PR.
--
-- This migration closes the gap between the Ops UI and broad legacy table/RPC
-- contracts. Every function is caller-bound to auth.uid(), locks its target,
-- and returns JSON with an explicit ok/error outcome.
--
-- ROLLBACK (owner-gated, forward-only): add a reviewed migration that revokes
-- the new RPC grants and restores the prior policy only after an incident review.

BEGIN;

-- The legacy table was created with only active/completed/cancelled in its
-- inline status check, while the live Ops contract already uses the explicit
-- lifecycle states below. Make that contract executable in a forward-only
-- migration and keep the older values valid for existing callers.
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_ops_status_check
  CHECK (status IN ('active', 'upcoming', 'registering', 'drawing', 'live', 'break', 'final_table', 'completed', 'cancelled'));

CREATE OR REPLACE FUNCTION public.validate_tournament_live_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.live_status NOT IN ('registering', 'playing', 'finished', 'live', 'break', 'final_table') THEN
    RAISE EXCEPTION 'Invalid live_status: %', NEW.live_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tournament_live_status ON public.tournaments;
CREATE TRIGGER trg_validate_tournament_live_status
  BEFORE INSERT OR UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.validate_tournament_live_status();

CREATE TABLE IF NOT EXISTS public.ops_cashier_mutation_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_cashier_mutation_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_cashier_mutation_idempotency FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ops_create_tournament(
  p_club_id UUID,
  p_name TEXT,
  p_start_time TIMESTAMPTZ,
  p_buy_in INTEGER,
  p_starting_stack INTEGER,
  p_minutes_per_level INTEGER,
  p_late_reg_close_level INTEGER DEFAULT 6,
  p_game_type TEXT DEFAULT 'nlh'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id AND owner_id = v_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_required');
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL OR p_start_time IS NULL
     OR p_buy_in IS NULL OR p_buy_in < 0
     OR p_starting_stack IS NULL OR p_starting_stack <= 0
     OR p_minutes_per_level IS NULL OR p_minutes_per_level <= 0
     OR p_late_reg_close_level IS NULL OR p_late_reg_close_level < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_tournament_input');
  END IF;

  INSERT INTO public.tournaments (
    club_id, name, start_time, buy_in, starting_stack, minutes_per_level,
    late_reg_close_level, game_type, rake_amount, service_fee_amount,
    status, live_status, current_level, players_remaining
  ) VALUES (
    p_club_id, btrim(p_name), p_start_time, p_buy_in, p_starting_stack,
    p_minutes_per_level, p_late_reg_close_level, coalesce(nullif(btrim(p_game_type), ''), 'nlh'),
    0, 0, 'upcoming', 'registering', 1, 0
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'tournament_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_update_tournament(
  p_tournament_id UUID,
  p_name TEXT,
  p_start_time TIMESTAMPTZ,
  p_buy_in INTEGER,
  p_starting_stack INTEGER,
  p_minutes_per_level INTEGER,
  p_late_reg_close_level INTEGER DEFAULT 6
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour public.tournaments;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = v_tour.club_id AND owner_id = v_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_required');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL OR p_start_time IS NULL
     OR p_buy_in IS NULL OR p_buy_in < 0
     OR p_starting_stack IS NULL OR p_starting_stack <= 0
     OR p_minutes_per_level IS NULL OR p_minutes_per_level <= 0
     OR p_late_reg_close_level IS NULL OR p_late_reg_close_level < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_tournament_input');
  END IF;

  UPDATE public.tournaments
  SET name = btrim(p_name), start_time = p_start_time, buy_in = p_buy_in,
      starting_stack = p_starting_stack, minutes_per_level = p_minutes_per_level,
      late_reg_close_level = p_late_reg_close_level, updated_at = now()
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object('ok', true, 'tournament_id', p_tournament_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_update_tournament_live(
  p_tournament_id UUID,
  p_status TEXT,
  p_players_remaining INTEGER,
  p_level INTEGER,
  p_blinds TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour public.tournaments;
  v_allowed BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('live', 'break', 'final_table')
     OR p_players_remaining IS NULL OR p_players_remaining < 0
     OR p_level IS NULL OR p_level < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_live_state');
  END IF;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_terminal', 'status', v_tour.status);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.clubs WHERE id = v_tour.club_id AND owner_id = v_actor)
      OR public.is_club_cashier(v_actor, v_tour.club_id)
      OR public.is_club_floor(v_actor, v_tour.club_id)
    INTO v_allowed;
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  UPDATE public.tournaments
  SET status = p_status,
      live_status = CASE p_status WHEN 'live' THEN 'playing' WHEN 'break' THEN 'playing' WHEN 'final_table' THEN 'playing' ELSE p_status END,
      players_remaining = p_players_remaining, current_level = p_level,
      current_blinds = p_blinds, updated_at = now()
  WHERE id = p_tournament_id;

  INSERT INTO public.tournament_state_transitions (
    tournament_id, previous_state, new_state, changed_by, reason
  ) VALUES (
    p_tournament_id, v_tour.status, p_status, v_actor,
    coalesce(nullif(btrim(p_reason), ''), 'ops_floor_live_update')
  );

  RETURN jsonb_build_object('ok', true, 'tournament_id', p_tournament_id, 'status', p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_delete_tournament_safe(
  p_tournament_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour public.tournaments;
  v_fk RECORD;
  v_has_rows BOOLEAN;
  v_evidence_table TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = v_tour.club_id AND owner_id = v_actor)
     AND NOT public.has_role(v_actor, 'super_admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_required');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_terminal');
  END IF;

  -- Explicit canonical evidence list. Optional tables are checked only when
  -- present, so this remains forward-compatible with older schemas.
  FOREACH v_evidence_table IN ARRAY ARRAY[
    'tournament_registrations', 'tournament_entries', 'tournament_seats',
    'tournament_hands', 'seat_draw_receipts', 'seat_assignment_history',
    'tournament_prize_payments', 'tournament_prize_payment_requests',
    'bank_transactions', 'sepay_transactions', 'staking_deals', 'staking_purchases'
  ] LOOP
    IF to_regclass(format('public.%I', v_evidence_table)) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = to_regclass(format('public.%I', v_evidence_table))
           AND a.attname = 'tournament_id' AND NOT a.attisdropped
       ) THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE tournament_id = $1)',
        v_evidence_table
      ) INTO v_has_rows USING p_tournament_id;
      IF v_has_rows THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tournament_has_related_evidence', 'evidence_table', v_evidence_table);
      END IF;
    END IF;
  END LOOP;

  -- Any child row is evidence that must survive; never cascade-delete it.
  FOR v_fk IN
    SELECT child_ns.nspname AS child_schema,
           child.relname AS child_table,
           child_col.attname AS child_column
    FROM pg_constraint con
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = child.oid AND child_col.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND parent_ns.nspname = 'public'
      AND parent.relname = 'tournaments'
      AND child_ns.nspname = 'public'
      AND array_length(con.conkey, 1) = 1
      AND array_length(con.confkey, 1) = 1
      AND child.relname <> 'tournaments'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_fk.child_schema, v_fk.child_table, v_fk.child_column
    ) INTO v_has_rows USING p_tournament_id;
    IF v_has_rows THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'tournament_has_related_evidence',
        'evidence_table', v_fk.child_table
      );
    END IF;
  END LOOP;

  -- Conservative fallback: evidence tables are not required to declare an FK.
  -- Any public table with a canonical tournament_id column blocks deletion.
  FOR v_fk IN
    SELECT n.nspname AS child_schema, c.relname AS child_table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tournament_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'tournaments'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE tournament_id = $1)',
      v_fk.child_schema, v_fk.child_table
    ) INTO v_has_rows USING p_tournament_id;
    IF v_has_rows THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tournament_has_related_evidence', 'evidence_table', v_fk.child_table);
    END IF;
  END LOOP;

  PERFORM set_config('ops.allow_tournament_delete', 'on', true);
  DELETE FROM public.tournaments WHERE id = p_tournament_id;
  RETURN jsonb_build_object('ok', true, 'tournament_id', p_tournament_id, 'deleted', true);
END;
$$;

-- No caller may bypass the evidence-preserving delete RPC. The RPC above sets a
-- transaction-local marker only after it has checked ownership, terminal state,
-- and every single-column tournament foreign key for related evidence.
CREATE OR REPLACE FUNCTION public.ops_require_safe_tournament_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('ops.allow_tournament_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'tournament_delete_requires_safe_path'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_require_safe_delete ON public.tournaments;
CREATE TRIGGER tournaments_require_safe_delete
  BEFORE DELETE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.ops_require_safe_tournament_delete();

CREATE OR REPLACE FUNCTION public.ops_create_offline_buyin_and_seat(
  p_tournament_id UUID,
  p_player_name TEXT,
  p_idempotency_key TEXT,
  p_phone TEXT DEFAULT NULL,
  p_draw_mode TEXT DEFAULT 'random_balanced'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour public.tournaments;
  v_allowed BOOLEAN;
  v_hash TEXT;
  v_existing public.ops_cashier_mutation_idempotency;
  v_response JSONB;
  v_buy_in BIGINT;
  v_fee BIGINT;
  v_name TEXT := NULLIF(btrim(p_player_name), '');
  v_player_id UUID := gen_random_uuid();
  v_table_tour_id UUID;
  v_table_game_id UUID;
  v_table_number INTEGER;
  v_max_seats INTEGER;
  v_seat_number INTEGER;
  v_registration_id UUID;
  v_entry_id UUID;
  v_seat_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_reference_code TEXT;
  v_attempt INTEGER := 0;
  v_member_id UUID;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  END IF;
  IF NULLIF(btrim(p_player_name), '') IS NULL OR length(btrim(p_player_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_player_name');
  END IF;
  IF coalesce(p_draw_mode, '') NOT IN ('random_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- Lock order starts with the tournament. Every Ops buy-in for this
  -- tournament therefore serializes before resolving capacity or writing data.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.clubs WHERE id = v_tour.club_id AND owner_id = v_actor)
      OR public.is_club_cashier(v_actor, v_tour.club_id)
    INTO v_allowed;
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_buy_in := coalesce(v_tour.buy_in, 0);
  v_fee := coalesce(v_tour.rake_amount, 0) + coalesce(v_tour.service_fee_amount, 0);
  v_hash := md5(concat_ws('|', p_tournament_id::text, v_name, coalesce(p_phone, ''), coalesce(p_draw_mode, ''), v_buy_in::text, v_fee::text));

  -- The idempotency row is locked before business-state validation. A second
  -- request with the same key waits here and converges on the first response.
  INSERT INTO public.ops_cashier_mutation_idempotency (idempotency_key, actor_user_id, operation, request_hash)
  VALUES (btrim(p_idempotency_key), v_actor, 'offline_buyin', v_hash)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.ops_cashier_mutation_idempotency
  WHERE idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;
  IF v_existing.actor_user_id <> v_actor OR v_existing.operation <> 'offline_buyin' OR v_existing.request_hash <> v_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_conflict');
  END IF;
  IF v_existing.response IS NOT NULL THEN
    RETURN v_existing.response || jsonb_build_object('idempotent', true);
  END IF;

  IF v_buy_in <= 0 OR v_fee < 0 THEN
    DELETE FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key = btrim(p_idempotency_key);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_tournament_pricing');
  END IF;

  IF v_tour.status IN ('completed', 'cancelled') THEN
    DELETE FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key = btrim(p_idempotency_key);
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- Preflight all capacity before the first business write. The tournament
  -- lock plus the selected tournament-table lock serializes capacity selection.
  IF coalesce(p_draw_mode, 'random_balanced') = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
      INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND (SELECT count(*) FROM public.tournament_seats ts
           WHERE ts.table_id = tt.id AND ts.is_active = true) < tt.max_seats
    ORDER BY tt.table_number ASC NULLS LAST, tt.id
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
      INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND (SELECT count(*) FROM public.tournament_seats ts
           WHERE ts.table_id = tt.id AND ts.is_active = true) < tt.max_seats
    ORDER BY (SELECT count(*) FROM public.tournament_seats ts
              WHERE ts.table_id = tt.id AND ts.is_active = true),
             tt.table_number ASC NULLS LAST, tt.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_table_tour_id IS NULL THEN
    DELETE FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key = btrim(p_idempotency_key);
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  SELECT s.n INTO v_seat_number
  FROM generate_series(1, greatest(v_max_seats, 1)) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tournament_seats ts
    WHERE ts.table_id = v_table_tour_id
      AND ts.seat_number = s.n
      AND ts.is_active = true
  )
  ORDER BY s.n
  LIMIT 1;
  IF v_seat_number IS NULL THEN
    DELETE FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key = btrim(p_idempotency_key);
    RETURN jsonb_build_object('ok', false, 'error', 'no_seat_available');
  END IF;

  -- From this point onward, unexpected errors raise and roll the complete
  -- transaction back, including registration and idempotency state.
  LOOP
    v_attempt := v_attempt + 1;
    v_reference_code := format('CASH-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (
        tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay,
        reference_code, status, committed_at, confirmed_at, confirmed_by
      ) VALUES (
        p_tournament_id, v_player_id, v_tour.club_id, v_buy_in, v_fee, v_buy_in + v_fee,
        v_reference_code, 'confirmed', now(), now(), v_actor
      ) RETURNING id INTO v_registration_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source, status,
    current_stack, table_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, v_registration_id, v_player_id, 1, 'offline', 'seated',
    coalesce(v_tour.starting_stack, 0), v_table_game_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.tournament_seats (
    tournament_id, player_id, entry_number, table_id, seat_number, chip_count,
    is_active, player_name, status, entry_id, assigned_by, assigned_at
  ) VALUES (
    p_tournament_id, v_player_id, 1, v_table_tour_id, v_seat_number,
    coalesce(v_tour.starting_stack, 0), true, v_name, 'active', v_entry_id, v_actor, now()
  ) RETURNING id INTO v_seat_id;

  UPDATE public.tournament_entries SET seat_id = v_seat_id WHERE id = v_entry_id;

  BEGIN
    IF public.normalize_phone(p_phone) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.club_settings cs
         WHERE cs.club_id = v_tour.club_id AND cs.player_history_enabled
       ) THEN
      v_member_id := NULLIF(public.find_or_create_club_member(v_tour.club_id, p_phone, v_name, NULL)->>'member_id', '')::uuid;
      IF v_member_id IS NOT NULL THEN
        UPDATE public.tournament_entries SET member_id = v_member_id WHERE id = v_entry_id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_tour.club_id, 'ops_create_offline_buyin_and_seat', left(SQLERRM, 500));
  END;

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s', coalesce(v_table_number::text, '?'), v_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name, table_id,
        table_number, seat_id, seat_number, receipt_code, qr_payload, draw_type,
        status, issued_by
      ) VALUES (
        p_tournament_id, v_registration_id, v_entry_id, v_player_id, v_name, v_table_game_id,
        v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', v_player_id,
          'table_number', v_table_number, 'seat_number', v_seat_number, 'source', 'offline'),
        'initial', 'issued', v_actor
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id, to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    p_tournament_id, v_entry_id, v_player_id, v_table_game_id, v_table_number, v_seat_number,
    'offline_buyin', 'initial', v_actor,
    jsonb_build_object('draw_mode', coalesce(p_draw_mode, 'random_balanced'),
      'registration_id', v_registration_id, 'buy_in', v_buy_in, 'fee', v_fee, 'source', 'offline')
  );

  v_response := jsonb_build_object(
    'ok', true, 'registration_id', v_registration_id, 'entry_id', v_entry_id,
    'seat_id', v_seat_id, 'receipt_id', v_receipt_id, 'receipt_code', v_receipt_code,
    'reference_code', v_reference_code, 'table_id', v_table_game_id,
    'table_number', v_table_number, 'seat_number', v_seat_number,
    'display_name', v_name, 'starting_stack', coalesce(v_tour.starting_stack, 0)
  );
  UPDATE public.ops_cashier_mutation_idempotency
  SET response = v_response, updated_at = now()
  WHERE idempotency_key = btrim(p_idempotency_key);
  RETURN v_response;
END;
$$;

-- Existing table policies permit dealer-control users to delete tournaments.
-- Tighten only DELETE; create/edit are now routed through the Ops RPCs above.
DROP POLICY IF EXISTS "tournaments_delete" ON public.tournaments;
DROP POLICY IF EXISTS "Club owners can delete tournaments" ON public.tournaments;
REVOKE DELETE ON public.tournaments FROM authenticated;
CREATE POLICY "tournaments_delete_owner_only"
  ON public.tournaments FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = tournaments.club_id AND c.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DO $$
BEGIN
  IF to_regprocedure('public.create_offline_buyin_and_seat(uuid,text,bigint,bigint,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.create_offline_buyin_and_seat(uuid,text,bigint,bigint,text,text)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.ops_create_tournament(uuid,text,timestamptz,integer,integer,integer,integer,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ops_create_tournament(uuid,text,timestamptz,integer,integer,integer,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ops_update_tournament(uuid,text,timestamptz,integer,integer,integer,integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ops_update_tournament(uuid,text,timestamptz,integer,integer,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.ops_update_tournament_live(uuid,text,integer,integer,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ops_update_tournament_live(uuid,text,integer,integer,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ops_delete_tournament_safe(uuid,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ops_delete_tournament_safe(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ops_create_offline_buyin_and_seat(uuid,text,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ops_create_offline_buyin_and_seat(uuid,text,text,text,text) TO authenticated;

COMMIT;
