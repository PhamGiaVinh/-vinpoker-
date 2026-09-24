\set ON_ERROR_STOP on
-- Exact TEST IDs, disposable PostgreSQL only. Red/green repro for the live
-- trigger/check conflicts and for an unrelated active destination hand.
BEGIN;

ALTER TABLE public.tournament_seats ADD CONSTRAINT tournament_seats_status_check
  CHECK (status IN ('active', 'moved', 'busted', 'cancelled'));
ALTER TABLE public.seat_draw_receipts
  ADD COLUMN status text NOT NULL DEFAULT 'issued',
  ADD COLUMN cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION public.floor_bust_sync_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tournament_entries SET status = 'busted', busted_at = now()
  WHERE id = NEW.entry_id AND status = 'seated';
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_floor_bust_sync_entry
AFTER UPDATE OF is_active ON public.tournament_seats
FOR EACH ROW WHEN (OLD.is_active AND NOT NEW.is_active AND NEW.status = 'busted')
EXECUTE FUNCTION public.floor_bust_sync_entry();

INSERT INTO public.tournaments (id, club_id, status) VALUES
  ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000010', 'active');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000010', 'Bàn 31', 31, 'available'),
  ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000010', 'Bàn 32', 32, 'available'),
  ('00000000-0000-0000-0000-000000000533', '00000000-0000-0000-0000-000000000010', 'Bàn 33', 33, 'available');
INSERT INTO public.tournament_entries
  (id, tournament_id, registration_id, player_id, entry_no, current_stack, status)
VALUES
  ('00000000-0000-0000-0000-000000000831', '00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000a31', '00000000-0000-0000-0000-000000000931', 1, 30000, 'registered'),
  ('00000000-0000-0000-0000-000000000832', '00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000a32', '00000000-0000-0000-0000-000000000932', 1, 40000, 'registered'),
  ('00000000-0000-0000-0000-000000000833', '00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000a33', '00000000-0000-0000-0000-000000000933', 1, 50000, 'registered');

DO $$
DECLARE
  v_open jsonb;
  v_result jsonb;
  v_table uuid;
  v_revision bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  v_open := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000531',
    'manual', '00000000-0000-0000-0000-000000001131');
  PERFORM public.floor_table_v3_assert((v_open->>'ok')::boolean, 'repair fixture source table opens');
  v_table := (v_open->>'tournament_table_id')::uuid;
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000831', v_table, 1, 1,
    '00000000-0000-0000-0000-000000001132');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'repair fixture bust entry seats');
  v_revision := (v_result->>'revision')::bigint;
  BEGIN
    PERFORM public.floor_bust_player_v3(
      '00000000-0000-0000-0000-000000000831', v_revision, 1, 30000,
      '00000000-0000-0000-0000-000000001133', 'pre_repair_bust');
    RAISE EXCEPTION 'expected pre-repair entry_state_changed';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'entry_state_changed' THEN RAISE; END IF;
  END;
  PERFORM public.floor_table_v3_assert(
    (SELECT status = 'seated' FROM public.tournament_entries WHERE id = '00000000-0000-0000-0000-000000000831'),
    'failed pre-repair bust rolls back entry state');
END;
$$;

\ir ../../supabase/pending-migrations/20270115000004_floor_free_sit_v1.sql
\ir ../../supabase/pending-migrations/20270115000005_floor_roster_actions_repair.sql
\ir ../../supabase/pending-migrations/20270115000006_floor_break_eligible_destinations.sql

SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated', 'public.floor_break_table_v3(uuid,bigint,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.floor_break_table_v3(uuid,bigint,uuid,text)', 'EXECUTE'),
  'break writer stays caller-bound');
SELECT public.floor_table_v3_assert(
  (SELECT pg_get_constraintdef(oid) LIKE '%free_sit%'
   FROM pg_constraint WHERE conrelid = 'public.tournament_seats'::regclass
     AND conname = 'tournament_seats_status_check'),
  'Free Sit status is accepted by the active seat check');

DO $$
DECLARE
  v_source uuid;
  v_revision bigint;
  v_result jsonb;
  v_busy_open jsonb;
  v_ready_open jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SELECT tt.id, session_row.revision INTO v_source, v_revision
  FROM public.tournament_tables tt JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
  WHERE tt.game_table_id = '00000000-0000-0000-0000-000000000531' AND tt.status = 'active';
  v_result := public.floor_bust_player_v3(
    '00000000-0000-0000-0000-000000000831', v_revision, 1, 30000,
    '00000000-0000-0000-0000-000000001134', 'post_repair_bust');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'V3 bust survives the legacy trigger');
  PERFORM public.floor_table_v3_assert(
    (SELECT status = 'busted' AND current_stack = 0 FROM public.tournament_entries WHERE id = '00000000-0000-0000-0000-000000000831'),
    'V3 writer owns the final busted entry state');
  v_revision := (v_result->>'revision')::bigint;
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000832', v_source, 1, v_revision,
    '00000000-0000-0000-0000-000000001135');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'Free Sit fixture entry seats');
  v_revision := (v_result->>'revision')::bigint;
  v_result := public.floor_free_sit_player_v1(
    '00000000-0000-0000-0000-000000000832', v_revision, 1, 40000,
    '00000000-0000-0000-0000-000000001136', 'repair_free_sit');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'Free Sit accepts its inactive status');
  PERFORM public.floor_table_v3_assert(
    (SELECT status = 'registered' AND current_stack = 40000 FROM public.tournament_entries WHERE id = '00000000-0000-0000-0000-000000000832')
    AND NOT EXISTS (SELECT 1 FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000832' AND is_active),
    'Free Sit preserves stack and releases only the seat');
  v_revision := (v_result->>'revision')::bigint;
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000833', v_source, 1, v_revision,
    '00000000-0000-0000-0000-000000001137');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'break fixture source entry seats');
  v_revision := (v_result->>'revision')::bigint;
  v_busy_open := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000532',
    'tracker', '00000000-0000-0000-0000-000000001138');
  v_ready_open := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000533',
    'manual', '00000000-0000-0000-0000-000000001139');
  PERFORM public.floor_table_v3_assert((v_busy_open->>'ok')::boolean AND (v_ready_open->>'ok')::boolean, 'break destinations open');
  INSERT INTO public.tournament_hands (tournament_id, table_id, tournament_table_id, table_session_id, status)
  VALUES ('00000000-0000-0000-0000-000000000131', (v_busy_open->>'tournament_table_id')::uuid,
    (v_busy_open->>'tournament_table_id')::uuid, (v_busy_open->>'table_session_id')::uuid, 'in_progress');
  v_result := public.floor_break_table_v3(v_source, v_revision,
    '00000000-0000-0000-0000-000000001140', 'fill_lowest_table');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean AND (v_result->>'moved_count')::integer = 1,
    'unrelated active Tracker hand no longer blocks break: ' || v_result::text);
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000833'
      AND tournament_table_id = (v_ready_open->>'tournament_table_id')::uuid AND is_active)
    AND NOT EXISTS (SELECT 1 FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000833'
      AND tournament_table_id = (v_busy_open->>'tournament_table_id')::uuid AND is_active),
    'break never inserts a player into an in-progress hand');
END;
$$;

ROLLBACK;
SELECT 'FLOOR_ROSTER_ACTIONS_REPAIR_DISPOSABLE_PASS' AS result;
