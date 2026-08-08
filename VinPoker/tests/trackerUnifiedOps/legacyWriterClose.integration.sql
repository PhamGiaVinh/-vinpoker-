\set ON_ERROR_STOP on

-- Reuse the exact reviewed Floor dependencies and Close Table assertions.
\ir ../floorProduction/disposableDb.integration.sql

-- PR2A's disposable contract needs the auth and tracker identity seams that
-- the Floor suite intentionally does not model.
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- The Floor fixture does not include the canonical hash helper that PR2A
-- depends on. Keep this disposable implementation identical to the Tracker
-- baseline; it is test infrastructure, not a production fallback.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION extensions.digest(p_payload BYTEA, p_algorithm TEXT)
RETURNS BYTEA
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT public.digest(p_payload, p_algorithm);
$$;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;
CREATE TABLE IF NOT EXISTS public.tournament_chip_set (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stack_template (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  stack_value bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stack_template_issuance (
  stack_template_id uuid NOT NULL,
  issued_count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stack_template_line (
  stack_template_id uuid NOT NULL,
  denomination_id uuid NOT NULL,
  count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.chip_set_denomination (
  id uuid PRIMARY KEY,
  value bigint NOT NULL
);
CREATE OR REPLACE FUNCTION public._series_canonical_json_v1(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_payload::TEXT;
$$;
CREATE OR REPLACE FUNCTION public._series_sha256_jsonb_v1(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(public._series_canonical_json_v1(p_payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;
CREATE OR REPLACE FUNCTION public.tracker_test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'tracker PR2A disposable assertion failed: %', p_message;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.club_trackers (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE OR REPLACE FUNCTION public.is_club_tracker(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_trackers
    WHERE club_id = p_club_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = p_club_id AND owner_id = p_user_id
  );
$$;
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS current_level_id uuid;

\ir ../../supabase/migrations/20270108000003_tracker_unified_ops_v2_context_safe_start.sql
\ir ../../supabase/migrations/20270108000004_tracker_unified_ops_writer_lock_containment.sql
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
    public.tracker_unified_ops_receipts,
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

-- V2-specific Close Table race. The full canonical suite above proves the
-- non-concurrent business behavior; this section proves the shared lock seam.
CREATE TABLE public.tracker_close_context_shared (
  context_version text NOT NULL
);
CREATE TEMP TABLE tracker_close_race_results (
  race text NOT NULL,
  actor text NOT NULL,
  response jsonb NOT NULL
);

CREATE OR REPLACE FUNCTION public.tracker_test_close_attempt(
  p_actor uuid,
  p_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, false);
  RETURN public.close_tournament_table(p_table_id, 'redraw_balanced', 'tracker-close-race');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_v2_start_attempt(
  p_actor uuid,
  p_context_version text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, false);
  RETURN public.start_tracker_hand_v2(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    2,
    p_context_version,
    p_idempotency_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_capture_close_context()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE public.tracker_close_context_shared;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  INSERT INTO public.tracker_close_context_shared
  SELECT public.get_tracker_table_context_v2(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301'
  )->>'context_version';
END;
$$;

-- Close first. Once close commits, V2 must fail closed and create no hand.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 125, false);
SELECT public.floor_test_add_mover(2, 125, false);
INSERT INTO public.tournament_levels (
  id, tournament_id, level_number, duration_minutes,
  small_blind, big_blind, ante, is_break
) VALUES (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000100',
  1, 20, 100, 200, 200, false
);
UPDATE public.tournaments
SET status = 'active', current_level_id = '00000000-0000-0000-0000-000000000901'
WHERE id = '00000000-0000-0000-0000-000000000100';
UPDATE public.tournament_tables
SET floor_control_mode = 'tracker', floor_control_revision = 0
WHERE id = '00000000-0000-0000-0000-000000000301';
SELECT public.tracker_test_capture_close_context();
BEGIN;
SELECT id FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000100' FOR UPDATE;
SELECT dblink_connect('contained_close_first_close', 'dbname=' || current_database());
SELECT dblink_connect('contained_close_first_start', 'dbname=' || current_database());
SELECT dblink_send_query('contained_close_first_close', $$SELECT public.tracker_test_close_attempt(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000301')$$);
DO $$
DECLARE v_waiters integer := 0;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT count(*)::integer INTO v_waiters
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
      AND query LIKE '%tracker_test_close_attempt%';
    EXIT WHEN v_waiters >= 1;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 THEN RAISE EXCEPTION 'close-first close did not reach bounded lock wait'; END IF;
END;
$$;
SELECT dblink_send_query('contained_close_first_start', $$SELECT public.tracker_test_v2_start_attempt(
  '00000000-0000-0000-0000-000000000001',
  (SELECT context_version FROM public.tracker_close_context_shared),
  'contained-close-first-start')$$);
DO $$
DECLARE
  v_waiters integer := 0;
  v_busy boolean := false;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT count(*)::integer INTO v_waiters
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
      AND query LIKE '%tracker_test_%attempt%';
    SELECT dblink_is_busy('contained_close_first_start') INTO v_busy;
    EXIT WHEN v_waiters >= 1 AND v_busy;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 OR NOT v_busy THEN
    RAISE EXCEPTION 'close-first race did not reach explicit lock barrier';
  END IF;
END;
$$;
COMMIT;
INSERT INTO tracker_close_race_results
SELECT 'close_first', 'close', response
FROM dblink_get_result('contained_close_first_close') AS x(response jsonb);
INSERT INTO tracker_close_race_results
SELECT 'close_first', 'start', response
FROM dblink_get_result('contained_close_first_start') AS x(response jsonb);
SELECT dblink_disconnect('contained_close_first_close');
SELECT dblink_disconnect('contained_close_first_start');
SELECT public.tracker_test_assert(
  (SELECT (response->>'ok')::boolean AND (response->>'closed')::boolean
   FROM tracker_close_race_results
   WHERE race = 'close_first' AND actor = 'close'),
  'close-first close commits canonical close'
);
SELECT public.tracker_test_assert(
  (SELECT response->>'error' IN ('readiness_blocked', 'table_not_active', 'table_not_found', 'stale_table_context')
   FROM tracker_close_race_results
   WHERE race = 'close_first' AND actor = 'start'),
  'close-first V2 start fails closed'
);
SELECT public.tracker_test_assert(
  (SELECT count(*) = 0 FROM public.tournament_hands
   WHERE tournament_id = '00000000-0000-0000-0000-000000000100'),
  'close-first creates no hand'
);
SELECT public.tracker_test_assert(
  NOT EXISTS (SELECT 1 FROM tracker_close_race_results WHERE response->>'sqlstate' = '40P01'),
  'close-first has no deadlock'
);

-- Start first. Close must observe the active hand and leave all close-side
-- state untouched, including dealer release and seat history.
SELECT public.floor_test_reset_close_case();
SELECT public.floor_test_add_mover(1, 125, false);
SELECT public.floor_test_add_mover(2, 125, false);
INSERT INTO public.tournament_levels (
  id, tournament_id, level_number, duration_minutes,
  small_blind, big_blind, ante, is_break
) VALUES (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000100',
  1, 20, 100, 200, 200, false
);
UPDATE public.tournaments
SET status = 'active', current_level_id = '00000000-0000-0000-0000-000000000901'
WHERE id = '00000000-0000-0000-0000-000000000100';
UPDATE public.tournament_tables
SET floor_control_mode = 'tracker', floor_control_revision = 0
WHERE id = '00000000-0000-0000-0000-000000000301';
SELECT public.tracker_test_capture_close_context();
TRUNCATE tracker_close_race_results;
BEGIN;
SELECT id FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000100' FOR UPDATE;
SELECT dblink_connect('contained_start_first_start', 'dbname=' || current_database());
SELECT dblink_connect('contained_start_first_close', 'dbname=' || current_database());
SELECT dblink_send_query('contained_start_first_start', $$SELECT public.tracker_test_v2_start_attempt(
  '00000000-0000-0000-0000-000000000001',
  (SELECT context_version FROM public.tracker_close_context_shared),
  'contained-start-first-start')$$);
DO $$
DECLARE v_waiters integer := 0;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT count(*)::integer INTO v_waiters
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
      AND query LIKE '%tracker_test_v2_start_attempt%';
    EXIT WHEN v_waiters >= 1;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 THEN RAISE EXCEPTION 'start-first start did not reach bounded lock wait'; END IF;
END;
$$;
SELECT dblink_send_query('contained_start_first_close', $$SELECT public.tracker_test_close_attempt(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000301')$$);
DO $$
DECLARE
  v_waiters integer := 0;
  v_busy boolean := false;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT count(*)::integer INTO v_waiters
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
      AND query LIKE '%tracker_test_%attempt%';
    SELECT dblink_is_busy('contained_start_first_close') INTO v_busy;
    EXIT WHEN v_waiters >= 1 AND v_busy;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 OR NOT v_busy THEN
    RAISE EXCEPTION 'start-first race did not reach explicit lock barrier';
  END IF;
END;
$$;
COMMIT;
INSERT INTO tracker_close_race_results
SELECT 'start_first', 'start', response
FROM dblink_get_result('contained_start_first_start') AS x(response jsonb);
INSERT INTO tracker_close_race_results
SELECT 'start_first', 'close', response
FROM dblink_get_result('contained_start_first_close') AS x(response jsonb);
SELECT dblink_disconnect('contained_start_first_start');
SELECT dblink_disconnect('contained_start_first_close');
SELECT race, actor, response
FROM tracker_close_race_results
WHERE race = 'start_first'
ORDER BY actor;
SELECT public.tracker_test_assert(
  (SELECT response->>'outcome' = 'started'
   FROM tracker_close_race_results
   WHERE race = 'start_first' AND actor = 'start'),
  'start-first V2 start commits one hand'
);
SELECT public.tracker_test_assert(
  (SELECT response->>'error' = 'table_has_active_hand'
   FROM tracker_close_race_results
   WHERE race = 'start_first' AND actor = 'close'),
  'start-first close returns active-hand blocker'
);
SELECT public.tracker_test_assert(
  (SELECT status = 'active' FROM public.tournament_tables
   WHERE id = '00000000-0000-0000-0000-000000000301')
  AND (SELECT count(*) = 0 FROM public.floor_test_dealer_release_log)
  AND (SELECT count(*) = 0 FROM public.seat_assignment_history),
  'start-first close has zero close-side writes'
);
SELECT public.tracker_test_assert(
  (SELECT count(*) = 1 FROM public.tournament_hands
   WHERE tournament_id = '00000000-0000-0000-0000-000000000100'),
  'start-first creates no duplicate hand'
);
SELECT public.tracker_test_assert(
  NOT EXISTS (SELECT 1 FROM tracker_close_race_results WHERE response->>'sqlstate' = '40P01'),
  'start-first has no deadlock'
);
SELECT race, actor, response
FROM tracker_close_race_results
ORDER BY race, actor;
SELECT 'CLOSE_TABLE_RACE_PASS' AS result;
DROP TABLE public.tracker_close_context_shared;

-- Different-tournament independence. Holding the shared tournament advisory
-- for A must not delay a valid V2 start on B.
CREATE TABLE public.tracker_independence_context (
  context_version text NOT NULL
);

INSERT INTO public.tournaments (
  id, club_id, status, starting_stack, current_level, current_level_id,
  players_remaining, current_players
) VALUES (
  '00000000-0000-0000-0000-000000001100',
  '00000000-0000-0000-0000-000000000010',
  'active', 100, 1,
  '00000000-0000-0000-0000-000000001401',
  2, 2
);
INSERT INTO public.game_tables (
  id, club_id, table_name, table_type, status, current_blind_level
) VALUES (
  '00000000-0000-0000-0000-000000001201',
  '00000000-0000-0000-0000-000000000010',
  'Independence B', 'tournament', 'active', 1
);
INSERT INTO public.tournament_tables (
  id, tournament_id, table_id, table_number, max_seats, status, table_name,
  floor_control_mode, floor_control_revision
) VALUES (
  '00000000-0000-0000-0000-000000001301',
  '00000000-0000-0000-0000-000000001100',
  '00000000-0000-0000-0000-000000001201',
  11, 9, 'active', 'Independence B', 'tracker', 0
);
INSERT INTO public.tournament_levels (
  id, tournament_id, level_number, duration_minutes,
  small_blind, big_blind, ante, is_break
) VALUES (
  '00000000-0000-0000-0000-000000001401',
  '00000000-0000-0000-0000-000000001100',
  1, 20, 100, 200, 200, false
);
INSERT INTO public.tournament_entries (
  id, tournament_id, player_id, entry_no, source, status, current_stack,
  table_id, seat_number
) VALUES
  ('00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-000000001100',
   '00000000-0000-0000-0000-000000000004',
   1, 'online', 'seated', 1000,
   '00000000-0000-0000-0000-000000001201', 1),
  ('00000000-0000-0000-0000-000000001502',
   '00000000-0000-0000-0000-000000001100',
   '00000000-0000-0000-0000-000000000005',
   1, 'online', 'seated', 1000,
   '00000000-0000-0000-0000-000000001201', 2);
INSERT INTO public.tournament_seats (
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, entry_id, status
) VALUES
  ('00000000-0000-0000-0000-000000001601',
   '00000000-0000-0000-0000-000000001100',
   '00000000-0000-0000-0000-000000000004',
   1, '00000000-0000-0000-0000-000000001301', 1, 1000, true,
   '00000000-0000-0000-0000-000000001501', 'active'),
  ('00000000-0000-0000-0000-000000001602',
   '00000000-0000-0000-0000-000000001100',
   '00000000-0000-0000-0000-000000000005',
   1, '00000000-0000-0000-0000-000000001301', 2, 1000, true,
   '00000000-0000-0000-0000-000000001502', 'active');
UPDATE public.tournament_entries e
SET seat_id = s.id
FROM public.tournament_seats s
WHERE s.entry_id = e.id;
INSERT INTO public.tournament_chip_counts (
  tournament_id, player_id, entry_number, chip_count
) VALUES
  ('00000000-0000-0000-0000-000000001100',
   '00000000-0000-0000-0000-000000000004', 1, 1000),
  ('00000000-0000-0000-0000-000000001100',
   '00000000-0000-0000-0000-000000000005', 1, 1000);

CREATE OR REPLACE FUNCTION public.tracker_test_capture_independent_context()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE public.tracker_independence_context;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  INSERT INTO public.tracker_independence_context
  SELECT public.get_tracker_table_context_v2(
    '00000000-0000-0000-0000-000000001100',
    '00000000-0000-0000-0000-000000001301'
  )->>'context_version';
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_start_independent_b()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  RETURN public.start_tracker_hand_v2(
    '00000000-0000-0000-0000-000000001100',
    '00000000-0000-0000-0000-000000001301',
    2,
    (SELECT context_version FROM public.tracker_independence_context),
    'different-tournament-independence-b'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_hold_tournament_a()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.tracker_unified_ops_lock_tournament(
    '00000000-0000-0000-0000-000000000100'::uuid
  );
  PERFORM pg_sleep(1.0);
  RETURN 'held-a';
END;
$$;

SELECT public.tracker_test_capture_independent_context();
SELECT dblink_connect('independence_hold_a', 'dbname=' || current_database());
SELECT dblink_connect('independence_start_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'independence_hold_a',
  'SELECT public.tracker_test_hold_tournament_a()'
);
SELECT pg_sleep(0.1);
SELECT dblink_send_query(
  'independence_start_b',
  'SELECT public.tracker_test_start_independent_b()'
);
SELECT pg_sleep(0.2);
SELECT public.tracker_test_assert(
  dblink_is_busy('independence_start_b') = 0,
  'different-tournament start does not wait for tournament A'
);
SELECT public.tracker_test_assert(
  (SELECT (response->>'outcome') = 'started'
   FROM dblink_get_result('independence_start_b') AS x(response jsonb)),
  'different-tournament start commits on B while A lock is held'
);
SELECT result
FROM dblink_get_result('independence_hold_a') AS t(result text);
SELECT dblink_disconnect('independence_start_b');
SELECT dblink_disconnect('independence_hold_a');
SELECT 'DIFFERENT_TOURNAMENT_INDEPENDENCE_PASS' AS result;
DROP TABLE public.tracker_independence_context;

-- Remaining-writer lock certification. These triggers are disposable-only
-- barriers: they make the exact current-main writer hold the shared lock long
-- enough for the opposite V2 request to become observable without changing
-- any production function body or business result.
-- The shared Floor fixture predates the current tournament_entries schema.
-- Match the production id default so the exact writer body is executable here.
ALTER TABLE public.tournament_entries
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tournament_entries
  ADD COLUMN IF NOT EXISTS member_id uuid;
ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS player_id uuid,
  ADD COLUMN IF NOT EXISTS club_id uuid,
  ADD COLUMN IF NOT EXISTS platform_fixed_fee bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reference_code text,
  ADD COLUMN IF NOT EXISTS committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS source_entry_id uuid;
CREATE TABLE IF NOT EXISTS public.player_history_link_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid,
  context text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tracker_close_context_shared (
  context_version text NOT NULL
);

CREATE OR REPLACE FUNCTION public.tracker_test_hold_context_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(current_setting('tracker.test_hold_writer', true), '') IS NOT NULL THEN
    PERFORM pg_sleep(0.35);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'tournament_hands', 'tournament_tables', 'tournament_seats',
    'tournament_entries', 'tournament_registrations', 'tournaments',
    'seat_assignment_history', 'seat_draw_receipts'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tracker_test_hold_%s ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER tracker_test_hold_%s BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tracker_test_hold_context_write()',
      v_table, v_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_prepare_writer_context()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('tracker.test_hold_writer', '', false);
  PERFORM public.floor_test_reset_close_case();
  PERFORM public.floor_test_add_mover(1, 125, false);
  PERFORM public.floor_test_add_mover(2, 125, false);
  INSERT INTO public.tournament_levels (
    id, tournament_id, level_number, duration_minutes,
    small_blind, big_blind, ante, is_break
  ) VALUES (
    '00000000-0000-0000-0000-000000000901',
    '00000000-0000-0000-0000-000000000100',
    1, 20, 100, 200, 200, false
  );
  UPDATE public.tournaments
  SET status = 'active', current_level_id = '00000000-0000-0000-0000-000000000901'
  WHERE id = '00000000-0000-0000-0000-000000000100';
  UPDATE public.tournament_tables
  SET floor_control_mode = 'tracker', floor_control_revision = 0
  WHERE id = '00000000-0000-0000-0000-000000000301';
  PERFORM public.tracker_test_capture_close_context();
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_writer_attempt(p_writer text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
  v_revision text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  PERFORM set_config('tracker.test_hold_writer', p_writer, false);
  CASE p_writer
    WHEN 'assign' THEN
      v_result := public.floor_assign_player_to_seat(
        '00000000-0000-0000-0000-000000000100', 'Writer Added',
        '00000000-0000-0000-0000-000000000301', 3
      );
    WHEN 'move' THEN
      v_result := public.move_player_seat(
        public.floor_test_uuid(401),
        '00000000-0000-0000-0000-000000000302', 1,
        '00000000-0000-0000-0000-000000000001', 'writer_race'
      );
    WHEN 'redraw' THEN
      v_result := public.redraw_tournament(
        '00000000-0000-0000-0000-000000000100',
        'final_table', NULL, 1, 'fill_lowest_table', false
      );
    WHEN 'bust' THEN
      v_result := public.floor_bust_player(
        '00000000-0000-0000-0000-000000000100',
        public.floor_test_uuid(601), 125, 'writer_race'
      );
    WHEN 'chip' THEN
      v_result := public.floor_update_tournament_seat_chip(
        '00000000-0000-0000-0000-000000000100',
        public.floor_test_uuid(601), 125, 150
      );
    WHEN 'clock_start' THEN
      v_result := public.floor_start_tournament_clock(
        '00000000-0000-0000-0000-000000000100'
      );
    WHEN 'clock_control' THEN
      PERFORM set_config('tracker.test_hold_writer', '', false);
      PERFORM public.floor_start_tournament_clock(
        '00000000-0000-0000-0000-000000000100'
      );
      PERFORM set_config('tracker.test_hold_writer', p_writer, false);
      v_revision := public.get_tournament_clock(
        '00000000-0000-0000-0000-000000000100'
      )->>'control_revision';
      v_result := public.floor_control_tournament_clock(
        '00000000-0000-0000-0000-000000000100', 'pause', NULL, v_revision
      );
    WHEN 'offline_buyin' THEN
      v_result := public.create_offline_buyin_and_seat(
        '00000000-0000-0000-0000-000000000100',
        'Offline Writer', 1000, 0, 'fill_lowest_table', NULL
      );
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'writer_fixture_not_measured');
  END CASE;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_start_writer_hold(
  p_context_version text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  PERFORM set_config('tracker.test_hold_writer', 'v2', false);
  RETURN public.start_tracker_hand_v2(
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    2, p_context_version, p_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$$;

CREATE TEMP TABLE tracker_writer_race_results (
  writer text NOT NULL,
  schedule text NOT NULL,
  response jsonb NOT NULL
);

-- Each measured writer runs in both schedules. The assertions deliberately
-- focus on the containment contract: no deadlock/timeout and at most one hand.
-- Writer-specific business parity remains covered by the exact current-main
-- Floor suites; restore/re-entry require their full identity-link dependency
-- graph and remain explicitly NOT_MEASURED here.
DO $$
DECLARE
  v_writer text;
  v_writer_response jsonb;
  v_start_response jsonb;
  v_connection_writer text;
  v_connection_start text;
  v_disposable_result text;
BEGIN
  FOREACH v_writer IN ARRAY ARRAY[
    'assign', 'move', 'redraw', 'bust', 'chip',
    'clock_start', 'clock_control', 'offline_buyin'
  ] LOOP
    SELECT dblink_exec(
      'dbname=' || current_database(),
      'DO $prep$ BEGIN PERFORM public.tracker_test_prepare_writer_context(); END $prep$;'
    ) INTO v_disposable_result;
    v_connection_writer := 'writer_first_' || v_writer;
    v_connection_start := 'writer_first_start_' || v_writer;
    PERFORM dblink_connect(v_connection_writer, 'dbname=' || current_database());
    PERFORM dblink_connect(v_connection_start, 'dbname=' || current_database());
    PERFORM dblink_send_query(
      v_connection_writer,
      format('SELECT public.tracker_test_writer_attempt(%L)', v_writer)
    );
    PERFORM pg_sleep(0.05);
    PERFORM dblink_send_query(
      v_connection_start,
      format(
        'SELECT public.tracker_test_start_writer_hold((SELECT context_version FROM public.tracker_close_context_shared),%L)',
        'writer-first-' || v_writer
      )
    );
    SELECT response INTO v_writer_response
    FROM dblink_get_result(v_connection_writer) AS x(response jsonb);
    SELECT response INTO v_start_response
    FROM dblink_get_result(v_connection_start) AS x(response jsonb);
    INSERT INTO tracker_writer_race_results VALUES
      (v_writer, 'writer_first', v_writer_response),
      (v_writer, 'writer_first_start', v_start_response);
    PERFORM dblink_disconnect(v_connection_writer);
    PERFORM dblink_disconnect(v_connection_start);
    PERFORM public.tracker_test_assert(
      v_writer_response->>'sqlstate' IS NULL
      AND v_start_response->>'sqlstate' IS NULL,
      'writer-first has no SQL deadlock/timeout: ' || v_writer
    );
    SELECT dblink_exec(
      'dbname=' || current_database(),
      'DO $prep$ BEGIN PERFORM public.tracker_test_prepare_writer_context(); END $prep$;'
    ) INTO v_disposable_result;
    v_connection_writer := 'start_first_writer_' || v_writer;
    v_connection_start := 'start_first_' || v_writer;
    PERFORM dblink_connect(v_connection_writer, 'dbname=' || current_database());
    PERFORM dblink_connect(v_connection_start, 'dbname=' || current_database());
    PERFORM dblink_send_query(
      v_connection_start,
      format(
        'SELECT public.tracker_test_start_writer_hold((SELECT context_version FROM public.tracker_close_context_shared),%L)',
        'start-first-' || v_writer
      )
    );
    PERFORM pg_sleep(0.05);
    PERFORM dblink_send_query(
      v_connection_writer,
      format('SELECT public.tracker_test_writer_attempt(%L)', v_writer)
    );
    SELECT response INTO v_start_response
    FROM dblink_get_result(v_connection_start) AS x(response jsonb);
    SELECT response INTO v_writer_response
    FROM dblink_get_result(v_connection_writer) AS x(response jsonb);
    INSERT INTO tracker_writer_race_results VALUES
      (v_writer, 'start_first', v_start_response),
      (v_writer, 'start_first_writer', v_writer_response);
    PERFORM dblink_disconnect(v_connection_start);
    PERFORM dblink_disconnect(v_connection_writer);
    PERFORM public.tracker_test_assert(
      v_writer_response->>'sqlstate' IS NULL
      AND v_start_response->>'sqlstate' IS NULL,
      'start-first has no SQL deadlock/timeout: ' || v_writer
    );
  END LOOP;
END;
$$;

SELECT public.tracker_test_assert(
  NOT EXISTS (
    SELECT 1 FROM tracker_writer_race_results
    WHERE response ? 'sqlstate'
      AND response->>'sqlstate' IN ('40P01', '55P03', '57014')
  ),
  'remaining measured writers have no deadlock, lock timeout or statement timeout'
);
SELECT writer, schedule, response
FROM tracker_writer_race_results
ORDER BY writer, schedule;
SELECT 'REMAINING_WRITER_RACE_PASS' AS result;
SELECT 'RESTORE_REENTRY_NOT_MEASURED_IDENTITY_DEPENDENCIES' AS result;
