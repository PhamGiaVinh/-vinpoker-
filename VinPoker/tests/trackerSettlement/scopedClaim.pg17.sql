RESET ROLE;
INSERT INTO public.tournament_tables(id,tournament_id,table_id,game_table_id,table_session_id,table_number,status)
VALUES('e2500000-0000-4000-8000-000000000060','e2500000-0000-4000-8000-000000000003','e2500000-0000-4000-8000-000000000013','e2500000-0000-4000-8000-000000000013','e2500000-0000-4000-8000-000000000023',3,'active');
INSERT INTO public.tournament_hands(id,tournament_id,table_id,tournament_table_id,table_session_id,hand_number,status,
tracker_small_blind,tracker_big_blind,tracker_bba,tracker_level_number,tracker_is_break)
VALUES
('e2500000-0000-4000-8000-000000000071','e2500000-0000-4000-8000-000000000003','e2500000-0000-4000-8000-000000000060','e2500000-0000-4000-8000-000000000060','e2500000-0000-4000-8000-000000000023',1,'completed',100,200,0,1,false),
('e2500000-0000-4000-8000-000000000072','e2500000-0000-4000-8000-000000000003','e2500000-0000-4000-8000-000000000060','e2500000-0000-4000-8000-000000000060','e2500000-0000-4000-8000-000000000023',2,'completed',100,200,0,1,false);
INSERT INTO public.tracker_historical_display_queue(hand_id,source_revision,status)
SELECT id,source_revision,'pending' FROM public.tournament_hands WHERE id IN ('e2500000-0000-4000-8000-000000000071','e2500000-0000-4000-8000-000000000072')
ON CONFLICT(hand_id,source_revision) DO UPDATE SET status='pending',next_attempt_at=now(),lease_token=NULL,lease_until=NULL;
-- Deliberately make the out-of-scope row older, so accidental global claiming is detectable.
UPDATE public.tracker_historical_display_queue SET next_attempt_at=now()-interval '1 day' WHERE hand_id='e2500000-0000-4000-8000-000000000072';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY['e2500000-0000-4000-8000-000000000071'::uuid],1);
 PERFORM pg_temp.assert_true(n=1,'only the selected hand is claimed');
 SELECT count(*) INTO n FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY['e2500000-0000-4000-8000-000000000071'::uuid],1);
 PERFORM pg_temp.assert_true(n=0,'live lease cannot be double-claimed');
 BEGIN
  PERFORM * FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY[]::uuid[],1);
  RAISE EXCEPTION 'test: empty scope accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM * FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY['e2500000-0000-4000-8000-000000000072'::uuid,'e2500000-0000-4000-8000-000000000072'::uuid],1);
  RAISE EXCEPTION 'test: duplicate scope accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.tracker_historical_display_queue WHERE hand_id='e2500000-0000-4000-8000-000000000072'),'older unrelated history untouched');
SELECT pg_temp.assert_true((SELECT status='processing' AND attempts=1 AND lease_token IS NOT NULL FROM public.tracker_historical_display_queue WHERE hand_id='e2500000-0000-4000-8000-000000000071'),'only scoped hand receives one live lease');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.claim_tracker_historical_display_jobs_scoped_v1(uuid[],integer)','EXECUTE'),'anonymous scoped claim forbidden');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.claim_tracker_historical_display_jobs_scoped_v1(uuid[],integer)','EXECUTE'),'browser scoped claim forbidden');
