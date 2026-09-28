\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'history_uat_failed: %', message; END IF;
END $$;

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
CREATE TEMP TABLE history_first_claim AS
SELECT * FROM public.claim_tracker_historical_display_jobs(1);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 AND bool_and(lease_token IS NOT NULL) FROM history_first_claim),
  'worker claims one eligible queued revision with a lease token');
RESET ROLE;
UPDATE public.tracker_historical_display_queue q
SET lease_until = now() - interval '1 second'
FROM history_first_claim c
WHERE q.hand_id = c.hand_id AND q.source_revision = c.source_revision;
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
CREATE TEMP TABLE history_second_claim AS
SELECT * FROM public.claim_tracker_historical_display_jobs(1);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM history_second_claim)
  AND (SELECT a.hand_id = b.hand_id AND a.source_revision = b.source_revision
         AND a.lease_token <> b.lease_token
       FROM history_first_claim a CROSS JOIN history_second_claim b),
  'expired processing lease is reclaimed with a fresh token');
SELECT pg_temp.assert_true(
  (SELECT public.finish_tracker_historical_display_job(
    hand_id, source_revision, lease_token, 'completed', NULL)
   FROM history_second_claim),
  'current lease token completes exactly one queued revision');
DO $$ BEGIN
  BEGIN
    PERFORM public.claim_tracker_historical_display_jobs(0);
    RAISE EXCEPTION 'invalid limit unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%invalid_batch_limit%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT pg_temp.assert_true(
  position('lease_until < now()' in pg_get_functiondef('public.claim_tracker_historical_display_jobs(integer)'::regprocedure)) > 0
  AND position('FOR UPDATE OF q SKIP LOCKED' in pg_get_functiondef('public.claim_tracker_historical_display_jobs(integer)'::regprocedure)) > 0,
  'claim supports expired-lease reclaim without duplicate workers');
SELECT pg_temp.assert_true(
  position('lease_token' in pg_get_functiondef('public.finish_tracker_historical_display_job(uuid,bigint,uuid,text,text)'::regprocedure)) > 0
  AND position('lease_token' in pg_get_functiondef('public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'finish and commit are lease-token fenced');
SELECT pg_temp.assert_true(
  position('verification_scope = ''historical_display''' in pg_get_functiondef(
    'public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure)) > 0,
  'public history exposes only verified historical display outcomes');
SELECT pg_temp.assert_true(
  position('tracker_mark_prior_settlements_stale' in
    pg_get_functiondef('public.tracker_bump_hand_source_revision()'::regprocedure)) > 0,
  'reparent/source mutation invalidates published outcomes');

-- Dedicated end-to-end worker fixture. Isolate it from earlier disposable
-- queue rows while preserving them as evidence.
UPDATE public.tracker_historical_display_queue
SET status='cancelled', lease_token=NULL, lease_until=NULL
WHERE status IN ('pending','processing');
INSERT INTO auth.users(id) VALUES ('d3000000-0000-4000-8000-000000000010') ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
  ('d3000000-0000-4000-8000-000000000011','d3000000-0000-4000-8000-000000000010','History runtime TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
  ('d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000011','History runtime TEST','active','live',1);
INSERT INTO public.tournament_levels(
  tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break
) VALUES (
  'd3000000-0000-4000-8000-000000000012',1,100,200,200,20,false
);
INSERT INTO public.game_tables(id,club_id,table_name,table_type,status) VALUES
  ('d3000000-0000-4000-8000-000000000013','d3000000-0000-4000-8000-000000000011','History table TEST','tournament','active');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode) VALUES
  ('d3000000-0000-4000-8000-000000000014','d3000000-0000-4000-8000-000000000011','d3000000-0000-4000-8000-000000000013','tournament','d3000000-0000-4000-8000-000000000012','tracker');
INSERT INTO public.tournament_tables(
  id,tournament_id,table_id,game_table_id,table_session_id,table_number,table_name,status,floor_control_mode
) VALUES (
  'd3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000013','d3000000-0000-4000-8000-000000000013','d3000000-0000-4000-8000-000000000014',1,'History table TEST','active','tracker'
);
INSERT INTO public.tournament_seats(
  id,tournament_id,player_id,table_id,tournament_table_id,table_session_id,
  seat_number,chip_count,player_name
) VALUES
  ('d3000000-0000-4000-8000-000000000016','d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000032','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000014',1,1100,'History winner TEST'),
  ('d3000000-0000-4000-8000-000000000017','d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000033','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000014',2,900,'History opponent TEST');
INSERT INTO public.tournament_hands(
  id,tournament_id,table_id,tournament_table_id,table_session_id,hand_number,status,
  pot_size,button_seat,tracker_level_number,tracker_small_blind,tracker_big_blind,tracker_bba,tracker_is_break
) VALUES
  ('d3000000-0000-4000-8000-000000000021','d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000014',1,'in_progress',100,1,1,100,200,200,false),
  ('d3000000-0000-4000-8000-000000000022','d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000015','d3000000-0000-4000-8000-000000000014',2,'in_progress',0,1,1,100,200,200,false);
INSERT INTO public.hand_players(
  id,hand_id,tournament_id,player_id,entry_number,seat_number,starting_stack,ending_stack,is_eliminated,player_name
) VALUES (
  'd3000000-0000-4000-8000-000000000031','d3000000-0000-4000-8000-000000000021','d3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000032',1,1,1000,1100,false,'History winner TEST'
);
INSERT INTO public.hand_actions(id,hand_id,player_id,entry_number,action_type,action_amount,action_order)
VALUES ('d3000000-0000-4000-8000-000000000041','d3000000-0000-4000-8000-000000000021','d3000000-0000-4000-8000-000000000032',1,'bet',0,1);
UPDATE public.tournament_hands SET status='completed'
WHERE id IN ('d3000000-0000-4000-8000-000000000021','d3000000-0000-4000-8000-000000000022');
UPDATE public.tracker_historical_display_queue SET status='cancelled'
WHERE hand_id='d3000000-0000-4000-8000-000000000022';

CREATE TEMP TABLE history_runtime_source AS
SELECT * FROM public.get_tournament_historical_display_source_hash(
  'd3000000-0000-4000-8000-000000000021');
CREATE TEMP TABLE history_runtime_outcome AS
SELECT jsonb_build_object(
  'schemaVersion','settlement-outcome-v1','status','verified',
  'sourceRevision',source_revision,'sourceChainHash',source_chain_hash,
  'settlementRevision',1,'outcomeHash',repeat('a',64),
  'ruleVersion','clockwise-first-eligible-winner-left-of-button/v1',
  'players',jsonb_build_array(jsonb_build_object(
    'playerId','d3000000-0000-4000-8000-000000000032',
    'startingStack',1000,'committedTotal',0,'potAward',100,'refund',0,
    'creditedTotal',100,'netDelta',100,'externalDelta',0,'endingStack',1100)),
  'pots',jsonb_build_array(jsonb_build_object('kind','main','allocations',jsonb_build_array(
    jsonb_build_object('winnerId','d3000000-0000-4000-8000-000000000032','amount',100)))),
  'refunds','[]'::jsonb,'handRanks','[]'::jsonb,'totals','{}'::jsonb
) AS payload FROM history_runtime_source;
GRANT SELECT ON history_runtime_source, history_runtime_outcome TO service_role;

SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
CREATE TEMP TABLE history_runtime_claim1 AS
SELECT * FROM public.claim_tracker_historical_display_jobs(1);
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT hand_id='d3000000-0000-4000-8000-000000000021'::uuid FROM history_runtime_claim1),
  'dedicated history job is claimed');
UPDATE public.tracker_historical_display_queue q SET lease_until=now()-interval '1 second'
FROM history_runtime_claim1 c WHERE q.hand_id=c.hand_id AND q.source_revision=c.source_revision;
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
CREATE TEMP TABLE history_runtime_claim2 AS
SELECT * FROM public.claim_tracker_historical_display_jobs(1);
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT a.lease_token<>b.lease_token FROM history_runtime_claim1 a CROSS JOIN history_runtime_claim2 b),
  'crash-before-commit lease is reclaimed with a new fencing token');

DO $$
DECLARE s record; old_claim record; o jsonb;
BEGIN
  SELECT * INTO s FROM history_runtime_source;
  SELECT * INTO old_claim FROM history_runtime_claim1;
  SELECT payload INTO o FROM history_runtime_outcome;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  BEGIN
    PERFORM public.commit_tracker_historical_display_outcome_v2(
      old_claim.hand_id,'00000000-0000-4000-8000-000000000001','system_worker',
      s.source_revision,s.source_chain_hash,repeat('a',64),repeat('b',64),
      'history-runtime-idempotency-0001',o,old_claim.lease_token);
    RAISE EXCEPTION 'stale lease unexpectedly committed';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM NOT LIKE '%queue_lease_lost%' THEN RAISE; END IF;
  END;
END $$;

SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT public.commit_tracker_historical_display_outcome_v2(
  c.hand_id,'00000000-0000-4000-8000-000000000001','system_worker',
  s.source_revision,s.source_chain_hash,repeat('a',64),repeat('b',64),
  'history-runtime-idempotency-0001',o.payload,c.lease_token
)::text AS payload
FROM history_runtime_claim2 c CROSS JOIN history_runtime_source s CROSS JOIN history_runtime_outcome o
\gset committed_
SELECT public.finish_tracker_historical_display_job(
  c.hand_id,c.source_revision,c.lease_token,'completed',NULL
) AS finished
FROM history_runtime_claim2 c \gset late_finish_
SELECT public.get_tracker_historical_display_commit_receipt(
  c.hand_id,'d3000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001',
  'history-runtime-idempotency-0001',s.source_revision,s.source_chain_hash,repeat('b',64)
)::text AS payload
FROM history_runtime_claim2 c CROSS JOIN history_runtime_source s \gset receipt_
RESET ROLE;
SELECT pg_temp.assert_true(
  (:'committed_payload'::jsonb->>'ok')::boolean
  AND NOT (:'committed_payload'::jsonb->>'idempotent')::boolean
  AND NOT :'late_finish_finished'::boolean
  AND (:'receipt_payload'::jsonb->>'idempotent')::boolean
  AND (SELECT status='completed' AND lease_token IS NULL
       FROM public.tracker_historical_display_queue
       WHERE hand_id='d3000000-0000-4000-8000-000000000021'
         AND source_revision=(SELECT source_revision FROM history_runtime_source)),
  'commit consumes the current lease atomically and a later finish cannot double-complete');

SELECT public.get_public_tournament_table_history_v2(
  'd3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000015',20,NULL,NULL
)::text AS payload \gset public_before_
SELECT pg_temp.assert_true(
  :'public_before_payload'::jsonb->'items'->0->'result'->>'status'='verified'
  AND :'public_before_payload'::jsonb->'items'->0->'result'->'recipients'->0->>'playerId'='d3000000-0000-4000-8000-000000000032',
  'public projection exposes only the verified historical result and recipient');

SELECT source_revision AS old_revision FROM public.tournament_hands
WHERE id='d3000000-0000-4000-8000-000000000021' \gset history_old_
UPDATE public.hand_actions SET hand_id='d3000000-0000-4000-8000-000000000022'
WHERE id='d3000000-0000-4000-8000-000000000041';
SELECT public.get_public_tournament_table_history_v2(
  'd3000000-0000-4000-8000-000000000012','d3000000-0000-4000-8000-000000000015',20,NULL,NULL
)::text AS payload \gset public_after_
SELECT pg_temp.assert_true(
  (SELECT source_revision>:history_old_old_revision::bigint FROM public.tournament_hands
   WHERE id='d3000000-0000-4000-8000-000000000021')
  AND (SELECT status='stale' FROM public.tournament_settlement_outcomes
       WHERE hand_id='d3000000-0000-4000-8000-000000000021' AND verification_scope='historical_display')
  AND :'public_after_payload'::jsonb->'items'->1->'result'->>'status'='pending'
  AND EXISTS (SELECT 1 FROM public.tracker_historical_display_queue q
    JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
    WHERE q.hand_id IN ('d3000000-0000-4000-8000-000000000021','d3000000-0000-4000-8000-000000000022')
      AND q.status='pending'),
  'reparent invalidates the old proof, requeues both hands, and removes verified public output');

SELECT 'HISTORY_QUEUE_LEASE_COMMIT_PUBLIC_INVALIDATION_PG17_PASS' AS result;
