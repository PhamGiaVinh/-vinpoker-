\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'multi_day_guard_failed: %', message; END IF;
END
$$;

INSERT INTO auth.users(id) VALUES ('a1100000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id, owner_id, name, region)
VALUES ('a1200000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','Multi-day Guard TEST','TEST');
INSERT INTO public.tournament_events(id,club_id,name,status)
VALUES ('a1300000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','Guard Event TEST','active');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,event_id)
VALUES
  ('a1400000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','Closed Flight TEST','active','live','flight','a1300000-0000-4000-8000-000000000001'),
  ('a1400000-0000-4000-8000-000000000002','a1200000-0000-4000-8000-000000000001','Open Flight TEST','active','live','flight','a1300000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_hands(id,tournament_id,hand_number,status,button_seat)
VALUES
  ('a1500000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001',1,'completed',1),
  ('a1500000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000002',1,'completed',1);
INSERT INTO public.hand_actions(id,hand_id,player_id,entry_number,action_type,action_amount,action_order)
VALUES
  ('a1600000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','a1700000-0000-4000-8000-000000000001',1,'check',0,1),
  ('a1600000-0000-4000-8000-000000000002','a1500000-0000-4000-8000-000000000002','a1700000-0000-4000-8000-000000000002',1,'check',0,1);

UPDATE public.hand_actions SET trace_id='open-update'
WHERE id='a1600000-0000-4000-8000-000000000002';

INSERT INTO public.multi_day_flight_ends_v1(
  flight_tournament_id,event_id,club_id,day_number,status,end_request_id,
  ended_by,roster_count,roster_hash,locked_at
) VALUES (
  'a1400000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',1,'locked','a1800000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000001',1,'0123456789abcdef0123456789abcdef',now()
);

DO $$
DECLARE
  v_blocked integer := 0;
BEGIN
  BEGIN
    UPDATE public.hand_actions SET trace_id='closed-update'
    WHERE id='a1600000-0000-4000-8000-000000000001';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='multi_day_end_play_source_frozen' THEN v_blocked:=v_blocked+1; ELSE RAISE; END IF;
  END;
  BEGIN
    UPDATE public.hand_actions SET hand_id='a1500000-0000-4000-8000-000000000001'
    WHERE id='a1600000-0000-4000-8000-000000000002';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='multi_day_end_play_source_frozen' THEN v_blocked:=v_blocked+1; ELSE RAISE; END IF;
  END;
  BEGIN
    UPDATE public.hand_actions SET hand_id='a1500000-0000-4000-8000-000000000002'
    WHERE id='a1600000-0000-4000-8000-000000000001';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='multi_day_end_play_source_frozen' THEN v_blocked:=v_blocked+1; ELSE RAISE; END IF;
  END;
  PERFORM pg_temp.assert_true(v_blocked=3, 'closed update and both reparent directions must be blocked');
END
$$;

SELECT pg_temp.assert_true(
  (SELECT trace_id='open-update' FROM public.hand_actions WHERE id='a1600000-0000-4000-8000-000000000002')
  AND (SELECT hand_id='a1500000-0000-4000-8000-000000000001'::uuid FROM public.hand_actions WHERE id='a1600000-0000-4000-8000-000000000001'),
  'blocked writes must leave both child rows unchanged'
);

SELECT 'MULTI_DAY_GUARD_CHILD_BINDING_PG17_PASS' AS result;
