\set ON_ERROR_STOP on

-- Reuse the reviewed Floor disposable schema and writer seams, then apply only
-- the forward Close Table definition under test. This database has no project
-- ref, application credentials, or remote connection string.
\ir disposableDb.integration.sql
\ir ../../supabase/migration-archive/superseded/replaced/20270106000003_close_table_canonical_contract.sql

CREATE TABLE public.floor_test_dealer_release_log (
  table_id uuid NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.floor_test_trackers (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE TABLE public.floor_test_chipmasters (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE OR REPLACE FUNCTION public.release_dealer_from_table(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('floor.test_failure_stage', true) = 'before_dealer_release' THEN
    RAISE EXCEPTION 'floor_injected_failure:before_dealer_release';
  END IF;

  INSERT INTO public.floor_test_dealer_release_log (table_id)
  VALUES (p_table_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_uuid(p_value integer)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    '00000000-0000-4000-8000-' || lpad(to_hex(p_value), 12, '0')
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_reset_close_case(
  p_source_status text DEFAULT 'active',
  p_destination_one_max integer DEFAULT 3,
  p_destination_two_max integer DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE TABLE
    public.hand_actions,
    public.hand_players,
    public.tournament_hands,
    public.seat_assignment_history,
    public.seat_draw_receipts,
    public.tournament_seats,
    public.tournament_chip_counts,
    public.tournament_entries,
    public.tournament_tables,
    public.game_tables,
    public.tournament_levels,
    public.audit_logs,
    public.tournament_state_transitions,
    public.tournament_eliminations,
    public.tournament_registrations,
    public.tournament_prize_payments,
    public.tournament_close_report,
    public.tournaments,
    public.club_cashiers,
    public.club_floors,
    public.floor_test_trackers,
    public.floor_test_chipmasters,
    public.floor_test_dealer_release_log,
    public.clubs;

  PERFORM set_config('floor.test_failure_stage', '', false);
  PERFORM set_config('floor.test_collision_once', '', false);
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    false
  );

  INSERT INTO public.clubs (id, owner_id)
  VALUES
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099');

  INSERT INTO public.club_cashiers (club_id, user_id)
  VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002');

  INSERT INTO public.club_floors (club_id, user_id)
  VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003');

  INSERT INTO public.floor_test_trackers (club_id, user_id)
  VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000004');

  INSERT INTO public.floor_test_chipmasters (club_id, user_id)
  VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000005');

  INSERT INTO public.tournaments (
    id, club_id, status, starting_stack, current_level, players_remaining, current_players
  ) VALUES (
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000010',
    'registration',
    100,
    1,
    4,
    4
  );

  INSERT INTO public.game_tables (
    id, club_id, table_name, table_type, status, current_blind_level
  ) VALUES
    ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000010', 'Close Source', 'tournament', 'active', 1),
    ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000010', 'Close Destination 2', 'tournament', 'active', 1),
    ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000010', 'Close Destination 3', 'tournament', 'active', 1);

  INSERT INTO public.tournament_tables (
    id, tournament_id, table_id, table_number, max_seats, status, table_name,
    floor_control_mode, floor_control_revision
  ) VALUES
    ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000201', 1, 9, p_source_status, 'Close Source', 'manual', 0),
    ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000202', 2, p_destination_one_max, 'active', 'Close Destination 2', 'manual', 0),
    ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000203', 3, p_destination_two_max, 'active', 'Close Destination 3', 'manual', 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_add_mover(
  p_number integer,
  p_chip_count integer DEFAULT 100,
  p_use_physical_table_id boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid := public.floor_test_uuid(400 + p_number);
  v_player_id uuid := public.floor_test_uuid(500 + p_number);
  v_seat_id uuid := public.floor_test_uuid(600 + p_number);
  v_receipt_id uuid := public.floor_test_uuid(700 + p_number);
  v_registration_id uuid := public.floor_test_uuid(800 + p_number);
  v_source_identity uuid := CASE
    WHEN p_use_physical_table_id THEN '00000000-0000-0000-0000-000000000201'::uuid
    ELSE '00000000-0000-0000-0000-000000000301'::uuid
  END;
BEGIN
  INSERT INTO public.tournament_entries (
    id, tournament_id, registration_id, player_id, entry_no, source, status,
    current_stack, table_id, seat_id, seat_number
  ) VALUES (
    v_entry_id,
    '00000000-0000-0000-0000-000000000100',
    v_registration_id,
    v_player_id,
    1,
    'online',
    'seated',
    p_chip_count,
    '00000000-0000-0000-0000-000000000201',
    v_seat_id,
    p_number
  );

  INSERT INTO public.tournament_seats (
    id, tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, is_active, player_name, entry_id, status
  ) VALUES (
    v_seat_id,
    '00000000-0000-0000-0000-000000000100',
    v_player_id,
    1,
    v_source_identity,
    p_number,
    p_chip_count,
    true,
    format('Mover %s', p_number),
    v_entry_id,
    'active'
  );

  INSERT INTO public.tournament_chip_counts (
    tournament_id, player_id, entry_number, chip_count
  ) VALUES (
    '00000000-0000-0000-0000-000000000100',
    v_player_id,
    1,
    p_chip_count
  );

  INSERT INTO public.seat_draw_receipts (
    id, tournament_id, registration_id, entry_id, player_id, display_name,
    table_id, table_number, seat_id, seat_number, receipt_code, qr_payload,
    draw_type, status, issued_by
  ) VALUES (
    v_receipt_id,
    '00000000-0000-0000-0000-000000000100',
    v_registration_id,
    v_entry_id,
    v_player_id,
    format('Mover %s', p_number),
    '00000000-0000-0000-0000-000000000201',
    1,
    v_seat_id,
    p_number,
    format('OLD-%s', p_number),
    '{}'::jsonb,
    'initial_draw',
    'issued',
    '00000000-0000-0000-0000-000000000001'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_add_destination_player(
  p_number integer,
  p_tournament_table_id uuid,
  p_physical_table_id uuid,
  p_seat_number integer,
  p_chip_count integer DEFAULT 50
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid := public.floor_test_uuid(1400 + p_number);
  v_player_id uuid := public.floor_test_uuid(1500 + p_number);
  v_seat_id uuid := public.floor_test_uuid(1600 + p_number);
BEGIN
  INSERT INTO public.tournament_entries (
    id, tournament_id, player_id, entry_no, source, status, current_stack,
    table_id, seat_id, seat_number
  ) VALUES (
    v_entry_id,
    '00000000-0000-0000-0000-000000000100',
    v_player_id,
    1,
    'online',
    'seated',
    p_chip_count,
    p_physical_table_id,
    v_seat_id,
    p_seat_number
  );

  INSERT INTO public.tournament_seats (
    id, tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, is_active, player_name, entry_id, status
  ) VALUES (
    v_seat_id,
    '00000000-0000-0000-0000-000000000100',
    v_player_id,
    1,
    p_tournament_table_id,
    p_seat_number,
    p_chip_count,
    true,
    format('Destination %s', p_number),
    v_entry_id,
    'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_close_state()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'tables', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.tournament_tables x
    ), '[]'::jsonb),
    'game_tables', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.game_tables x
    ), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.tournament_entries x
    ), '[]'::jsonb),
    'seats', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.tournament_seats x
    ), '[]'::jsonb),
    'receipts', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.seat_draw_receipts x
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.seat_assignment_history x
    ), '[]'::jsonb),
    'hands', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
      FROM public.tournament_hands x
    ), '[]'::jsonb),
    'dealer_release', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_id, x.released_at)
      FROM public.floor_test_dealer_release_log x
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.floor_test_call_close_as(
  p_actor uuid,
  p_draw_mode text DEFAULT 'fill_lowest_table'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, false);
  RETURN public.close_tournament_table(
    '00000000-0000-0000-0000-000000000301',
    p_draw_mode,
    'table_break'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_failure_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stage text := current_setting('floor.test_failure_stage', true);
BEGIN
  IF TG_TABLE_NAME = 'tournament_seats' THEN
    IF TG_OP = 'UPDATE'
       AND v_stage = 'after_old_seat_deactivation'
       AND OLD.is_active
       AND NOT NEW.is_active THEN
      RAISE EXCEPTION 'floor_injected_failure:after_old_seat_deactivation';
    END IF;
    IF TG_OP = 'INSERT'
       AND v_stage = 'after_new_seat_insert'
       AND NEW.entry_id = public.floor_test_uuid(401) THEN
      RAISE EXCEPTION 'floor_injected_failure:after_new_seat_insert';
    END IF;
  ELSIF TG_TABLE_NAME = 'tournament_entries' THEN
    IF TG_OP = 'UPDATE'
       AND v_stage = 'after_entry_update'
       AND NEW.id = public.floor_test_uuid(401) THEN
      RAISE EXCEPTION 'floor_injected_failure:after_entry_update';
    END IF;
  ELSIF TG_TABLE_NAME = 'seat_draw_receipts' THEN
    IF TG_OP = 'INSERT'
       AND v_stage = 'after_receipt_insert'
       AND NEW.entry_id = public.floor_test_uuid(401) THEN
      RAISE EXCEPTION 'floor_injected_failure:after_receipt_insert';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER floor_test_fail_seat
AFTER INSERT OR UPDATE ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION public.floor_test_failure_trigger();

CREATE TRIGGER floor_test_fail_entry
AFTER UPDATE ON public.tournament_entries
FOR EACH ROW EXECUTE FUNCTION public.floor_test_failure_trigger();

CREATE TRIGGER floor_test_fail_receipt
AFTER INSERT ON public.seat_draw_receipts
FOR EACH ROW EXECUTE FUNCTION public.floor_test_failure_trigger();

CREATE OR REPLACE FUNCTION public.floor_test_collision_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_sql text;
BEGIN
  IF current_setting('floor.test_collision_once', true) = 'on'
     AND OLD.id = public.floor_test_uuid(601)
     AND OLD.is_active
     AND NOT NEW.is_active
     AND NOT EXISTS (
       SELECT 1
       FROM public.tournament_seats
       WHERE id = public.floor_test_uuid(1901)
     ) THEN
    v_sql := format(
      $query$
        INSERT INTO public.tournament_seats (
          id, tournament_id, player_id, entry_number, table_id, seat_number,
          chip_count, is_active, player_name, entry_id, status
        ) VALUES (
          %L::uuid, %L::uuid, %L::uuid, 1, %L::uuid, 1,
          1, true, 'Concurrent destination claim', NULL, 'active'
        )
      $query$,
      public.floor_test_uuid(1901),
      '00000000-0000-0000-0000-000000000100',
      public.floor_test_uuid(1951),
      '00000000-0000-0000-0000-000000000302'
    );
    PERFORM dblink_exec('dbname=' || current_database(), v_sql);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER floor_test_destination_collision
AFTER UPDATE ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION public.floor_test_collision_trigger();

-- Catalog and authorization gates.
SELECT public.floor_test_assert(
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'close_tournament_table'
      AND pg_get_function_identity_arguments(p.oid) = 'p_tournament_table_id uuid, p_draw_mode text, p_reason text'
  ),
  'canonical close table has exactly one expected overload'
);
SELECT public.floor_test_assert(
  (
    SELECT r.rolname = 'postgres'
       AND p.prosecdef
       AND p.proconfig = ARRAY['search_path=public']
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname = 'close_tournament_table'
  ),
  'owner, SECURITY DEFINER, and search_path are preserved'
);
SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.close_tournament_table(uuid,text,text)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.close_tournament_table(uuid,text,text)'::regprocedure, 'EXECUTE')
  AND has_function_privilege('service_role', 'public.close_tournament_table(uuid,text,text)'::regprocedure, 'EXECUTE'),
  'runtime grants preserve authenticated and service_role while denying anon'
);

SELECT public.floor_test_reset_close_case();
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.floor_test_assert(
  (public.close_tournament_table('00000000-0000-0000-0000-000000000301')->>'error') = 'unauthorized',
  'unauthenticated actor is denied'
);
SELECT public.floor_test_assert(
  NOT has_function_privilege('anon', 'public.close_tournament_table(uuid,text,text)'::regprocedure, 'EXECUTE'),
  'anon is denied by function ACL'
);

SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_assert(
  (public.floor_test_call_close_as('00000000-0000-0000-0000-000000000099')->>'error') = 'actor_not_allowed',
  'wrong-club actor is denied'
);
SELECT public.floor_test_assert(
  (public.floor_test_call_close_as('00000000-0000-0000-0000-000000000004')->>'error') = 'actor_not_allowed',
  'Tracker-only actor is denied'
);
SELECT public.floor_test_assert(
  (public.floor_test_call_close_as('00000000-0000-0000-0000-000000000005')->>'error') = 'actor_not_allowed',
  'ChipMaster-only actor is denied'
);

SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_assert(
  (public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001')->>'ok')::boolean,
  'club owner may close an empty table'
);
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_assert(
  (public.floor_test_call_close_as('00000000-0000-0000-0000-000000000002')->>'ok')::boolean,
  'authorized cashier may close an empty table'
);
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_assert(
  (public.floor_test_call_close_as('00000000-0000-0000-0000-000000000003')->>'ok')::boolean,
  'authorized Floor actor may close an empty table'
);

-- Unlinked guard: exact response and byte-for-byte state equality.
SELECT public.floor_test_reset_close_case();
INSERT INTO public.tournament_seats (
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, player_name, entry_id, status
) VALUES (
  public.floor_test_uuid(699),
  '00000000-0000-0000-0000-000000000100',
  public.floor_test_uuid(599),
  1,
  '00000000-0000-0000-0000-000000000301',
  1,
  250000,
  true,
  'Unlinked',
  NULL,
  'active'
);
CREATE TEMP TABLE floor_test_before_state (state jsonb NOT NULL);
INSERT INTO floor_test_before_state VALUES (public.floor_test_close_state());
CREATE TEMP TABLE floor_test_result (result jsonb NOT NULL);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT result @> '{
    "ok": false,
    "error": "UNLINKED_ACTIVE_SEATS",
    "total_active_seats": 1,
    "entry_backed_active_seats": 0,
    "unlinked_active_seats": 1,
    "active_chip_total": 250000
  }'::jsonb FROM floor_test_result),
  'unlinked guard returns canonical counts and chip total'
);
SELECT public.floor_test_assert(
  (SELECT state = public.floor_test_close_state() FROM floor_test_before_state),
  'unlinked guard performs zero writes'
);
TRUNCATE floor_test_before_state, floor_test_result;

-- Five separate seat-entry mismatch variants, each with zero writes.
DO $$
DECLARE
  v_variant text;
  v_before jsonb;
  v_result jsonb;
BEGIN
  FOREACH v_variant IN ARRAY ARRAY[
    'missing_entry',
    'wrong_tournament',
    'wrong_player',
    'wrong_entry_number',
    'not_seated'
  ] LOOP
    PERFORM public.floor_test_reset_close_case();
    PERFORM public.floor_test_add_mover(1, 100, false);

    CASE v_variant
      WHEN 'missing_entry' THEN
        DELETE FROM public.tournament_entries WHERE id = public.floor_test_uuid(401);
      WHEN 'wrong_tournament' THEN
        INSERT INTO public.tournaments (
          id, club_id, status, starting_stack, current_level
        ) VALUES (
          '00000000-0000-0000-0000-000000000101',
          '00000000-0000-0000-0000-000000000010',
          'registration',
          100,
          1
        );
        UPDATE public.tournament_entries
        SET tournament_id = '00000000-0000-0000-0000-000000000101'
        WHERE id = public.floor_test_uuid(401);
      WHEN 'wrong_player' THEN
        UPDATE public.tournament_entries
        SET player_id = public.floor_test_uuid(599)
        WHERE id = public.floor_test_uuid(401);
      WHEN 'wrong_entry_number' THEN
        UPDATE public.tournament_entries
        SET entry_no = 2
        WHERE id = public.floor_test_uuid(401);
      WHEN 'not_seated' THEN
        UPDATE public.tournament_entries
        SET status = 'busted'
        WHERE id = public.floor_test_uuid(401);
    END CASE;

    v_before := public.floor_test_close_state();
    v_result := public.floor_test_call_close_as(
      '00000000-0000-0000-0000-000000000001'
    );
    PERFORM public.floor_test_assert(
      v_result->>'error' = 'seat_entry_mismatch',
      format('%s returns seat_entry_mismatch', v_variant)
    );
    PERFORM public.floor_test_assert(
      v_before = public.floor_test_close_state(),
      format('%s performs zero writes', v_variant)
    );
  END LOOP;
END;
$$;

-- Active hand guards canonical and physical identity without changing evidence.
DO $$
DECLARE
  v_identity uuid;
  v_hand_id uuid;
  v_before jsonb;
  v_result jsonb;
BEGIN
  FOREACH v_identity IN ARRAY ARRAY[
    '00000000-0000-0000-0000-000000000301'::uuid,
    '00000000-0000-0000-0000-000000000201'::uuid
  ] LOOP
    PERFORM public.floor_test_reset_close_case();
    PERFORM public.floor_test_add_mover(1, 100, false);
    v_hand_id := CASE
      WHEN v_identity = '00000000-0000-0000-0000-000000000301'::uuid
        THEN public.floor_test_uuid(901)
      ELSE public.floor_test_uuid(902)
    END;
    INSERT INTO public.tournament_hands (
      id, tournament_id, table_id, hand_number, status
    ) VALUES (
      v_hand_id,
      '00000000-0000-0000-0000-000000000100',
      v_identity,
      1,
      'in_progress'
    );
    v_before := public.floor_test_close_state();
    v_result := public.floor_test_call_close_as(
      '00000000-0000-0000-0000-000000000001'
    );
    PERFORM public.floor_test_assert(
      v_result->>'error' = 'table_has_active_hand'
      AND (v_result->>'hand_id')::uuid = v_hand_id,
      'active hand blocks close for canonical and physical table identity'
    );
    PERFORM public.floor_test_assert(
      v_before = public.floor_test_close_state(),
      'active hand guard performs zero writes and preserves hand evidence'
    );
  END LOOP;
END;
$$;

-- Already-closed is an idempotent, zero-write success.
SELECT public.floor_test_reset_close_case('closed');
INSERT INTO floor_test_before_state VALUES (public.floor_test_close_state());
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT result @> '{
    "ok": true,
    "closed": true,
    "already_closed": true,
    "moved_count": 0,
    "moved": []
  }'::jsonb FROM floor_test_result),
  'already-closed returns the canonical idempotent receipt'
);
SELECT public.floor_test_assert(
  (SELECT state = public.floor_test_close_state() FROM floor_test_before_state),
  'already-closed creates no duplicate write'
);
TRUNCATE floor_test_before_state, floor_test_result;

-- Empty table closes and releases its dealer exactly once.
SELECT public.floor_test_reset_close_case();
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT result @> '{
    "ok": true,
    "closed": true,
    "already_closed": false,
    "moved_count": 0,
    "moved": []
  }'::jsonb FROM floor_test_result)
  AND (SELECT status = 'closed' FROM public.tournament_tables WHERE id = '00000000-0000-0000-0000-000000000301')
  AND (SELECT status = 'inactive' FROM public.game_tables WHERE id = '00000000-0000-0000-0000-000000000201')
  AND (SELECT count(*) = 1 FROM public.floor_test_dealer_release_log WHERE table_id = '00000000-0000-0000-0000-000000000201'),
  'empty close returns a complete receipt and releases dealer'
);
TRUNCATE floor_test_result;

-- Capacity failure is fail-closed with no partial writes.
SELECT public.floor_test_reset_close_case('active', 1, 0);
SELECT public.floor_test_add_mover(1, 100, false);
SELECT public.floor_test_add_mover(2, 200, true);
INSERT INTO floor_test_before_state VALUES (public.floor_test_close_state());
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT result @> '{"ok":false,"error":"insufficient_capacity","need":2,"have":1}'::jsonb FROM floor_test_result),
  'insufficient capacity preserves canonical error fields'
);
SELECT public.floor_test_assert(
  (SELECT state = public.floor_test_close_state() FROM floor_test_before_state),
  'insufficient capacity performs zero writes'
);
TRUNCATE floor_test_before_state, floor_test_result;

-- One mover: fill-lowest parity, projections, receipts, history and chips.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 125, false);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as(
  '00000000-0000-0000-0000-000000000001',
  'fill_lowest_table'
);
SELECT public.floor_test_assert(
  (SELECT result->>'moved_count' = '1' AND jsonb_array_length(result->'moved') = 1 FROM floor_test_result)
  AND (SELECT NOT is_active AND status = 'moved' FROM public.tournament_seats WHERE id = public.floor_test_uuid(601))
  AND (SELECT count(*) = 1 AND bool_and(table_id = '00000000-0000-0000-0000-000000000302' AND seat_number = 1 AND chip_count = 125)
       FROM public.tournament_seats WHERE entry_id = public.floor_test_uuid(401) AND is_active)
  AND (SELECT table_id = '00000000-0000-0000-0000-000000000202' AND seat_number = 1 AND current_stack = 125
       FROM public.tournament_entries WHERE id = public.floor_test_uuid(401))
  AND (SELECT count(*) = 1 FROM public.seat_draw_receipts WHERE entry_id = public.floor_test_uuid(401) AND status = 'superseded')
  AND (SELECT count(*) = 1 FROM public.seat_draw_receipts WHERE entry_id = public.floor_test_uuid(401) AND status = 'issued')
  AND (SELECT count(*) = 1 FROM public.seat_assignment_history WHERE entry_id = public.floor_test_uuid(401))
  AND (SELECT count(*) = 1 FROM public.floor_test_dealer_release_log),
  'one-mover close preserves live move, receipt, history, projection and dealer semantics'
);
TRUNCATE floor_test_result;

-- Multiple movers: balanced mode chooses the least occupied destination and
-- preserves operation-local count, identity and chip conservation.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_destination_player(
  1,
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000202',
  1
);
SELECT public.floor_test_add_destination_player(
  2,
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000202',
  2
);
SELECT public.floor_test_add_mover(1, 125, false);
SELECT public.floor_test_add_mover(2, 275, true);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as(
  '00000000-0000-0000-0000-000000000001',
  'redraw_balanced'
);
SELECT public.floor_test_assert(
  (SELECT result->>'moved_count' = '2' AND jsonb_array_length(result->'moved') = 2 FROM floor_test_result)
  AND (SELECT count(*) = 0 FROM public.tournament_seats WHERE is_active AND table_id IN (
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000201'
  ))
  AND (SELECT count(*) = 2 AND count(DISTINCT entry_id) = 2 AND sum(chip_count) = 400
       FROM public.tournament_seats
       WHERE is_active AND entry_id IN (public.floor_test_uuid(401), public.floor_test_uuid(402)))
  AND (SELECT bool_and(table_id = '00000000-0000-0000-0000-000000000303')
       FROM public.tournament_seats
       WHERE is_active AND entry_id IN (public.floor_test_uuid(401), public.floor_test_uuid(402)))
  AND (SELECT count(*) = 2 FROM public.seat_assignment_history
       WHERE entry_id IN (public.floor_test_uuid(401), public.floor_test_uuid(402))),
  'balanced multi-move preserves local mover conservation'
);
TRUNCATE floor_test_result;

-- A concurrent destination claim after hole planning forces the existing
-- unique-violation retry and must not trip a whole-tournament invariant.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 125, false);
SELECT set_config('floor.test_collision_once', 'on', false);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as(
  '00000000-0000-0000-0000-000000000001',
  'fill_lowest_table'
);
SELECT public.floor_test_assert(
  (SELECT result->>'moved_count' = '1' FROM floor_test_result)
  AND (SELECT seat_number = 2
       FROM public.tournament_seats
       WHERE entry_id = public.floor_test_uuid(401) AND is_active)
  AND (SELECT count(*) = 1
       FROM public.tournament_seats
       WHERE id = public.floor_test_uuid(1901) AND is_active),
  'destination collision retries safely and ignores unrelated destination change'
);
TRUNCATE floor_test_result;

-- Every injected failure must roll back the complete close operation.
DO $$
DECLARE
  v_stage text;
  v_before jsonb;
  v_failed boolean;
BEGIN
  FOREACH v_stage IN ARRAY ARRAY[
    'after_old_seat_deactivation',
    'after_new_seat_insert',
    'after_entry_update',
    'after_receipt_insert',
    'before_dealer_release'
  ] LOOP
    PERFORM public.floor_test_reset_close_case();
    PERFORM public.floor_test_add_mover(1, 125, false);
    v_before := public.floor_test_close_state();
    PERFORM set_config('floor.test_failure_stage', v_stage, false);
    v_failed := false;

    BEGIN
      PERFORM public.floor_test_call_close_as(
        '00000000-0000-0000-0000-000000000001',
        'fill_lowest_table'
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'floor_injected_failure:%' THEN
        RAISE;
      END IF;
      v_failed := true;
    END;

    PERFORM set_config('floor.test_failure_stage', '', false);
    PERFORM public.floor_test_assert(
      v_failed,
      format('%s injects an exception', v_stage)
    );
    PERFORM public.floor_test_assert(
      v_before = public.floor_test_close_state(),
      format('%s rolls back every table, seat, entry, receipt, history and dealer write', v_stage)
    );
  END LOOP;
END;
$$;

-- Concurrency helpers invoke the real start/mode/bust RPCs. Disposable-only
-- AFTER triggers hold each successful writer transaction long enough for the
-- close call to contend on the production lock seam.
CREATE OR REPLACE FUNCTION public.floor_test_concurrency_hold_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_writer text := current_setting('floor.test_hold_writer', true);
BEGIN
  IF TG_TABLE_NAME = 'tournament_hands' THEN
    IF TG_OP = 'INSERT' AND v_writer = 'start' THEN
      PERFORM pg_sleep(0.35);
    END IF;
  ELSIF TG_TABLE_NAME = 'tournament_tables' THEN
    IF TG_OP = 'UPDATE'
       AND v_writer = 'mode'
       AND OLD.floor_control_mode IS DISTINCT FROM NEW.floor_control_mode THEN
      PERFORM pg_sleep(0.35);
    END IF;
  ELSIF TG_TABLE_NAME = 'tournament_seats' THEN
    IF TG_OP = 'UPDATE'
       AND v_writer = 'bust'
       AND OLD.is_active
       AND NOT NEW.is_active THEN
      PERFORM pg_sleep(0.35);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER floor_test_hold_start
AFTER INSERT ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION public.floor_test_concurrency_hold_trigger();

CREATE TRIGGER floor_test_hold_mode
AFTER UPDATE ON public.tournament_tables
FOR EACH ROW EXECUTE FUNCTION public.floor_test_concurrency_hold_trigger();

CREATE TRIGGER floor_test_hold_bust
AFTER UPDATE ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION public.floor_test_concurrency_hold_trigger();

CREATE OR REPLACE FUNCTION public.floor_test_start_and_hold(
  p_sleep_seconds numeric DEFAULT 0.35
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    false
  );
  PERFORM set_config('floor.test_hold_writer', 'start', false);
  v_result := public.start_hand(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    1,
    now(),
    NULL,
    1
  );
  IF v_result->>'status' <> 'success' THEN
    RAISE EXCEPTION 'actual start_hand failed: %', v_result;
  END IF;
  RETURN 'started';
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_mode_and_hold(
  p_sleep_seconds numeric DEFAULT 0.35
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    false
  );
  PERFORM set_config('floor.test_hold_writer', 'mode', false);
  v_result := public.floor_set_table_control_mode(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    'tracker',
    0
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'actual mode change failed: %', v_result;
  END IF;
  RETURN 'mode_changed';
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_test_bust_and_hold(
  p_sleep_seconds numeric DEFAULT 0.35
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    false
  );
  PERFORM set_config('floor.test_hold_writer', 'bust', false);
  v_result := public.floor_bust_player(
    '00000000-0000-0000-0000-000000000100',
    public.floor_test_uuid(601),
    0,
    'close_concurrency_fixture'
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'actual Floor bust failed: %', v_result;
  END IF;
  RETURN 'busted';
END;
$$;

-- Close vs start: close waits, then observes the active hand and performs no
-- move, close or dealer release.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 125, false);
UPDATE public.tournament_tables
SET floor_control_mode = 'tracker'
WHERE id = '00000000-0000-0000-0000-000000000301';
SELECT dblink_connect('close_start', 'dbname=' || current_database());
SELECT dblink_send_query('close_start', 'SELECT public.floor_test_start_and_hold()');
SELECT pg_sleep(0.05);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT result->>'error' = 'table_has_active_hand' FROM floor_test_result)
  AND (SELECT count(*) = 1 FROM public.tournament_hands WHERE status = 'in_progress')
  AND (SELECT status = 'active' FROM public.tournament_tables WHERE id = '00000000-0000-0000-0000-000000000301')
  AND (SELECT count(*) = 0 FROM public.floor_test_dealer_release_log),
  'close vs start serializes and preserves the active hand'
);
SELECT public.floor_test_assert(
  (SELECT result = 'started' FROM dblink_get_result('close_start') AS t(result text)),
  'concurrent start helper completed without deadlock'
);
SELECT dblink_disconnect('close_start');
TRUNCATE floor_test_result;

-- Close vs mode: close waits for the same key, then closes without reverting
-- the completed mode write.
SELECT public.floor_test_reset_close_case();
SELECT dblink_connect('close_mode', 'dbname=' || current_database());
SELECT dblink_send_query('close_mode', 'SELECT public.floor_test_mode_and_hold()');
SELECT pg_sleep(0.05);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT (result->>'ok')::boolean FROM floor_test_result)
  AND (SELECT floor_control_mode = 'tracker' AND status = 'closed'
       FROM public.tournament_tables WHERE id = '00000000-0000-0000-0000-000000000301'),
  'close vs mode serializes without lost update'
);
SELECT public.floor_test_assert(
  (SELECT result = 'mode_changed' FROM dblink_get_result('close_mode') AS t(result text)),
  'concurrent mode helper completed without deadlock'
);
SELECT dblink_disconnect('close_mode');
TRUNCATE floor_test_result;

-- Close vs bust: the close observes the committed bust and takes the empty
-- close path; no duplicate move/history/receipt is created.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 0, false);
SELECT dblink_connect('close_bust', 'dbname=' || current_database());
SELECT dblink_send_query('close_bust', 'SELECT public.floor_test_bust_and_hold()');
SELECT pg_sleep(0.05);
INSERT INTO floor_test_result
SELECT public.floor_test_call_close_as('00000000-0000-0000-0000-000000000001');
SELECT public.floor_test_assert(
  (SELECT result->>'moved_count' = '0' FROM floor_test_result)
  AND (SELECT count(*) = 0 FROM public.seat_assignment_history)
  AND (SELECT count(*) = 1 FROM public.seat_draw_receipts)
  AND (SELECT count(*) = 1 FROM public.floor_test_dealer_release_log),
  'close vs bust serializes with no duplicate move artifacts'
);
SELECT public.floor_test_assert(
  (SELECT result = 'busted' FROM dblink_get_result('close_bust') AS t(result text)),
  'concurrent bust helper completed without deadlock'
);
SELECT dblink_disconnect('close_bust');
TRUNCATE floor_test_result;

-- Two concurrent closes: exactly one performs the move, the retry is the
-- canonical already-closed success, and all receipts remain singular.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 125, false);
SELECT dblink_connect('close_a', 'dbname=' || current_database());
SELECT dblink_connect('close_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'close_a',
  $$SELECT public.floor_test_call_close_as(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'fill_lowest_table'
  )$$
);
SELECT dblink_send_query(
  'close_b',
  $$SELECT public.floor_test_call_close_as(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'fill_lowest_table'
  )$$
);
CREATE TEMP TABLE floor_test_concurrent_close_results (result jsonb NOT NULL);
INSERT INTO floor_test_concurrent_close_results
SELECT result FROM dblink_get_result('close_a') AS t(result jsonb);
INSERT INTO floor_test_concurrent_close_results
SELECT result FROM dblink_get_result('close_b') AS t(result jsonb);
SELECT public.floor_test_assert(
  (SELECT count(*) = 2 FROM floor_test_concurrent_close_results WHERE (result->>'ok')::boolean)
  AND (SELECT count(*) = 1 FROM floor_test_concurrent_close_results WHERE result->>'moved_count' = '1')
  AND (SELECT count(*) = 1 FROM floor_test_concurrent_close_results WHERE (result->>'already_closed')::boolean)
  AND (SELECT count(*) = 1 FROM public.seat_assignment_history WHERE entry_id = public.floor_test_uuid(401))
  AND (SELECT count(*) = 1 FROM public.seat_draw_receipts WHERE entry_id = public.floor_test_uuid(401) AND status = 'issued')
  AND (SELECT count(*) = 1 FROM public.floor_test_dealer_release_log),
  'concurrent closes serialize into one move and one idempotent retry'
);
SELECT dblink_disconnect('close_a');
SELECT dblink_disconnect('close_b');

SELECT 'close table canonical disposable DB integration passed' AS result;
