-- PostgreSQL 17 runtime proof for 20270109000000_ops_floor_cashier_canonical_mutations.sql.
-- The workflow runs fixture -> exact migration -> this assertion file.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.test_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_condition THEN RAISE EXCEPTION 'OPS_TEST_ASSERT: %', p_message; END IF;
END;
$$;

-- Owner create and status lifecycle.
SET ROLE authenticated;
SET test.actor = '00000000-0000-0000-0000-000000000001';
SELECT public.test_assert((public.ops_create_tournament(
  '10000000-0000-0000-0000-000000000001', 'Atomic test', now(), 100000, 30000, 20
)->>'ok')::boolean, 'owner create');

RESET ROLE;
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['active','upcoming','registering','drawing','live','break','final_table','completed','cancelled'] LOOP
    UPDATE public.tournaments SET status = s WHERE name = 'Atomic test';
  END LOOP;
  UPDATE public.tournaments SET status = 'active' WHERE name = 'Atomic test';
END $$;
SET ROLE authenticated;
SET test.actor = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.tournaments WHERE name = 'Atomic test';
  PERFORM public.test_assert((public.ops_update_tournament_live(v_id, 'live', 9, 1, '100/200', 'runtime')->>'ok')::boolean, 'owner live');
END $$;

-- Cashier and Floor may update live state, wrong-club/anonymous may not.
DO $$
DECLARE v_id uuid; v jsonb;
BEGIN
  SELECT id INTO v_id FROM public.tournaments WHERE name = 'Atomic test';
  SET LOCAL test.actor = '00000000-0000-0000-0000-000000000002';
  v := public.ops_update_tournament_live(v_id, 'break', 8, 2, '200/400', 'cashier');
  PERFORM public.test_assert((v->>'ok')::boolean, 'cashier live');
  SET LOCAL test.actor = '00000000-0000-0000-0000-000000000003';
  v := public.ops_update_tournament_live(v_id, 'final_table', 6, 3, '300/600', 'floor');
  PERFORM public.test_assert((v->>'ok')::boolean, 'floor live');
  SET LOCAL test.actor = '00000000-0000-0000-0000-000000000004';
  v := public.ops_update_tournament_live(v_id, 'live', 5, 4, NULL, 'wrong');
  PERFORM public.test_assert(v->>'error' = 'actor_not_allowed', 'wrong club live denied');
END $$;

-- No table is a zero-write failure.
DO $$
DECLARE v_id uuid; v jsonb; n integer;
BEGIN
  SELECT id INTO v_id FROM public.tournaments WHERE name = 'Atomic test';
  v := public.ops_create_offline_buyin_and_seat(v_id, 'No Table', 'atomic-no-table');
  PERFORM public.test_assert(v->>'error' = 'no_table_available', 'no table error');
  SELECT count(*) INTO n FROM public.tournament_registrations WHERE tournament_id = v_id;
  PERFORM public.test_assert(n = 0, 'no table registration zero');
  SELECT count(*) INTO n FROM public.tournament_entries WHERE tournament_id = v_id;
  PERFORM public.test_assert(n = 0, 'no table entry zero');
  SELECT count(*) INTO n FROM public.tournament_seats WHERE tournament_id = v_id;
  PERFORM public.test_assert(n = 0, 'no table seat zero');
  SELECT count(*) INTO n FROM public.seat_draw_receipts WHERE tournament_id = v_id;
  PERFORM public.test_assert(n = 0, 'no table receipt zero');
  SELECT count(*) INTO n FROM public.seat_assignment_history WHERE tournament_id = v_id;
  PERFORM public.test_assert(n = 0, 'no table history zero');
END $$;

-- Add capacity and prove server-derived money + idempotent retry/conflict.
DO $$
DECLARE v_id uuid; v_game uuid; first jsonb; retry jsonb; conflict jsonb; n integer;
BEGIN
  SELECT id INTO v_id FROM public.tournaments WHERE name = 'Atomic test';
  INSERT INTO public.game_tables(club_id, table_name, status) VALUES ('10000000-0000-0000-0000-000000000001', 'Table 1', 'active') RETURNING id INTO v_game;
  INSERT INTO public.tournament_tables(tournament_id, table_id, table_number, max_seats, status) VALUES (v_id, v_game, 1, 9, 'active');
  first := public.ops_create_offline_buyin_and_seat(v_id, 'Atomic Player', 'atomic-success');
  PERFORM public.test_assert((first->>'ok')::boolean, 'buyin success');
  SELECT count(*) INTO n FROM public.tournament_registrations WHERE tournament_id = v_id AND buy_in = 100000 AND platform_fixed_fee = 0;
  PERFORM public.test_assert(n = 1, 'server-derived money');
  retry := public.ops_create_offline_buyin_and_seat(v_id, 'Atomic Player', 'atomic-success');
  PERFORM public.test_assert(retry->>'registration_id' = first->>'registration_id', 'same-key exact result');
  conflict := public.ops_create_offline_buyin_and_seat(v_id, 'Different Payload', 'atomic-success');
  PERFORM public.test_assert(conflict->>'error' = 'idempotency_key_conflict', 'same-key conflict');
  SELECT count(*) INTO n FROM public.tournament_registrations WHERE tournament_id = v_id;
  PERFORM public.test_assert(n = 1, 'no duplicate registration');
END $$;

-- Delete evidence and non-FK evidence both fail closed; empty tournament deletes.
DO $$
DECLARE empty_id uuid; evidence_id uuid; v jsonb; n integer;
BEGIN
  INSERT INTO public.tournaments(club_id, name, start_time, buy_in, starting_stack, minutes_per_level, status)
  VALUES ('10000000-0000-0000-0000-000000000001', 'Empty delete', now(), 1, 1, 1, 'upcoming') RETURNING id INTO empty_id;
  v := public.ops_delete_tournament_safe(empty_id, 'test');
  PERFORM public.test_assert((v->>'ok')::boolean, 'empty delete');
  PERFORM public.test_assert(NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = empty_id), 'empty deleted');

  INSERT INTO public.tournaments(club_id, name, start_time, buy_in, starting_stack, minutes_per_level, status)
  VALUES ('10000000-0000-0000-0000-000000000001', 'Non FK evidence delete', now(), 1, 1, 1, 'upcoming') RETURNING id INTO evidence_id;
  INSERT INTO public.non_fk_tournament_evidence(tournament_id, note) VALUES (evidence_id, 'audit');
  v := public.ops_delete_tournament_safe(evidence_id, 'test');
  PERFORM public.test_assert(v->>'error' = 'tournament_has_related_evidence', 'non-fk evidence blocked');
  PERFORM public.test_assert(EXISTS (SELECT 1 FROM public.tournaments WHERE id = evidence_id), 'evidence tournament retained');
  DELETE FROM public.non_fk_tournament_evidence WHERE tournament_id = evidence_id;
  v := public.ops_delete_tournament_safe(evidence_id, 'test-after-cleanup');
  PERFORM public.test_assert((v->>'ok')::boolean, 'non-fk evidence cleanup delete');
END $$;

-- Same-key two-session race: both callers may run at once, but the tournament
-- lock and idempotency row must converge them onto one committed business result.

-- Direct authenticated DELETE is denied by ACL; legacy RPC is not executable.
SELECT public.test_assert(NOT has_table_privilege('authenticated', 'public.tournaments', 'DELETE'), 'direct delete ACL denied');
SELECT public.test_assert(NOT has_function_privilege('authenticated', 'public.create_offline_buyin_and_seat(uuid,text,bigint,bigint,text,text)', 'EXECUTE'), 'legacy RPC revoked');
SELECT public.test_assert(has_function_privilege('authenticated', 'public.ops_create_offline_buyin_and_seat(uuid,text,text,text,text)', 'EXECUTE'), 'canonical RPC granted');
SELECT public.test_assert(NOT has_function_privilege('service_role', 'public.ops_create_offline_buyin_and_seat(uuid,text,text,text,text)', 'EXECUTE'), 'service role explicit deny');
SELECT public.test_assert(NOT has_table_privilege('authenticated', 'public.ops_cashier_mutation_idempotency', 'SELECT'), 'idempotency table denied');

RESET ROLE;
SELECT 'OPS_FLOOR_CASHIER_PG17_PASS' AS result;
