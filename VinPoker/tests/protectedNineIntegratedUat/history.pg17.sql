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

SELECT 'HISTORY_QUEUE_LEASE_COMMIT_PUBLIC_INVALIDATION_PG17_PASS' AS result;
