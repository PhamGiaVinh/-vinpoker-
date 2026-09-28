\set ON_ERROR_STOP on
\set SKIP_CRITICAL_CONSISTENCY_MIGRATION 1

CREATE OR REPLACE FUNCTION public.floor_table_v3_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Floor integrated UAT assertion failed: %', p_message;
  END IF;
END;
$$;

INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Floor runtime TEST','TEST');
INSERT INTO public.club_floors(club_id,user_id,granted_by) VALUES
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
  ('00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000010','Floor consistency TEST','active','live',1);

\ir ../floorTableControlV3/criticalConsistency.disposable.sql

UPDATE public.table_session_seat_locks
SET unlocked_at=now(), unlocked_by='00000000-0000-0000-0000-000000000001',
    unlock_reason='integrated UAT unlock'
WHERE table_session_id='00000000-0000-0000-0000-000000000660' AND seat_number=5;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT seat_locks::text AS locks
FROM public.get_floor_tournament_table_roster_v5('00000000-0000-0000-0000-000000000131')
WHERE tournament_table_id='00000000-0000-0000-0000-000000000760' \gset unlocked_
RESET ROLE;
SELECT public.floor_table_v3_assert(
  :'unlocked_locks'::jsonb='[]'::jsonb,
  'an unlocked seat lock disappears from the live roster projection');

UPDATE public.tournament_tables
SET status='closed'
WHERE tournament_id='00000000-0000-0000-0000-000000000131'
  AND status='active';
UPDATE public.table_sessions
SET closed_at=now(), closed_by='00000000-0000-0000-0000-000000000001',
    close_reason='integrated UAT fixture isolation'
WHERE tournament_id='00000000-0000-0000-0000-000000000131'
  AND closed_at IS NULL;

INSERT INTO public.game_tables(id,club_id,table_name,table_number,operational_status) VALUES
  ('00000000-0000-0000-0000-000000000564','00000000-0000-0000-0000-000000000010','TEST Deferred Source 64',64,'available'),
  ('00000000-0000-0000-0000-000000000565','00000000-0000-0000-0000-000000000010','TEST Active Tracker 65',65,'available');
INSERT INTO public.table_sessions(
  id,club_id,game_table_id,session_type,tournament_id,control_mode,revision,opened_by
) VALUES
  ('00000000-0000-0000-0000-000000000664','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000564','tournament','00000000-0000-0000-0000-000000000131','manual',1,'00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000665','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000565','tournament','00000000-0000-0000-0000-000000000131','tracker',1,'00000000-0000-0000-0000-000000000001');
INSERT INTO public.tournament_tables(
  id,tournament_id,table_name,table_number,max_seats,status,game_table_id,table_session_id
) VALUES
  ('00000000-0000-0000-0000-000000000764','00000000-0000-0000-0000-000000000131','TEST Deferred Source 64',64,9,'active','00000000-0000-0000-0000-000000000564','00000000-0000-0000-0000-000000000664'),
  ('00000000-0000-0000-0000-000000000765','00000000-0000-0000-0000-000000000131','TEST Active Tracker 65',65,9,'active','00000000-0000-0000-0000-000000000565','00000000-0000-0000-0000-000000000665');
INSERT INTO public.tournament_entries(
  id,tournament_id,player_id,entry_no,current_stack,status,table_id,seat_number,seated_at
) VALUES (
  '00000000-0000-0000-0000-000000000864','00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000964',64,18000,'seated','00000000-0000-0000-0000-000000000564',1,now()
);
INSERT INTO public.tournament_seats(
  id,tournament_id,player_id,entry_number,tournament_table_id,table_session_id,
  seat_number,chip_count,is_active,entry_id,player_name,status
) VALUES (
  '00000000-0000-0000-0000-000000000864','00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000964',64,'00000000-0000-0000-0000-000000000764','00000000-0000-0000-0000-000000000664',1,18000,true,'00000000-0000-0000-0000-000000000864','TEST Deferred Player','active'
);
INSERT INTO public.tournament_hands(
  id,tournament_id,table_id,tournament_table_id,table_session_id,hand_number,status,button_seat
) VALUES (
  '00000000-0000-0000-0000-000000000865','00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000765','00000000-0000-0000-0000-000000000765','00000000-0000-0000-0000-000000000665',65,'in_progress',1
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.floor_plan_break_table_v1(
  '00000000-0000-0000-0000-000000000764',1,'fill_lowest_table'
)::text AS payload \gset deferred_plan_
SELECT public.floor_break_table_v5(
  '00000000-0000-0000-0000-000000000764',1,
  '00000000-0000-0000-0000-000000001509','fill_lowest_table',
  :'deferred_plan_payload'::jsonb->>'plan_hash'
)::text AS payload \gset deferred_break_
SELECT public.floor_break_table_v5(
  '00000000-0000-0000-0000-000000000764',1,
  '00000000-0000-0000-0000-000000001509','fill_lowest_table',
  :'deferred_plan_payload'::jsonb->>'plan_hash'
)::text AS payload \gset deferred_retry_
RESET ROLE;
SELECT public.floor_table_v3_assert(
  (:'deferred_plan_payload'::jsonb->>'complete')::boolean
  AND :'deferred_plan_payload'::jsonb->'moves'->0->>'transfer_mode'='after_current_hand'
  AND (:'deferred_break_payload'::jsonb->>'break_pending')::boolean
  AND NOT (:'deferred_break_payload'::jsonb->>'closed')::boolean
  AND :'deferred_retry_payload'::jsonb=:'deferred_break_payload'::jsonb
  AND EXISTS (SELECT 1 FROM public.floor_pending_tracker_moves
    WHERE source_table_session_id='00000000-0000-0000-0000-000000000664' AND status='pending')
  AND EXISTS (SELECT 1 FROM public.tournament_seats
    WHERE id='00000000-0000-0000-0000-000000000864' AND is_active),
  'active-hand destination defers the move and response-loss retry is idempotent');

UPDATE public.tournament_hands SET status='completed'
WHERE id='00000000-0000-0000-0000-000000000865';
SELECT public.floor_table_v3_assert(
  (SELECT count(*)=1 FROM public.floor_pending_tracker_moves
   WHERE source_table_session_id='00000000-0000-0000-0000-000000000664' AND status='applied')
  AND (SELECT count(*)=1 FROM public.tournament_seats
   WHERE entry_id='00000000-0000-0000-0000-000000000864' AND is_active
     AND table_session_id='00000000-0000-0000-0000-000000000665')
  AND NOT EXISTS (SELECT 1 FROM public.tournament_seats
   WHERE id='00000000-0000-0000-0000-000000000864' AND is_active)
  AND EXISTS (SELECT 1 FROM public.table_sessions
   WHERE id='00000000-0000-0000-0000-000000000664' AND closed_at IS NOT NULL)
  AND EXISTS (SELECT 1 FROM public.tournament_tables
   WHERE id='00000000-0000-0000-0000-000000000764' AND status='closed'),
  'terminal hand consumes the queued move exactly once and closes the empty source');

DROP FUNCTION public.floor_table_v3_assert(boolean,text);
SELECT 'FLOOR_FULL_RUNTIME_PG17_PASS' AS result;
