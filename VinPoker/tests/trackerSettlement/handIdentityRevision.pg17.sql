\set ON_ERROR_STOP on
-- Run only on the owned current-schema card fixture, never on production.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_card56_overlap_20261011' THEN
    RAISE EXCEPTION 'identity_revision_test_wrong_database';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
  'sub','81100000-0000-4000-8000-000000000001')::text,true);
UPDATE public.tournament_hands SET status='completed'
WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE identity_before AS
SELECT h.*, s.source_chain_hash FROM public.tournament_hands h
CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s
WHERE h.id='86000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF (SELECT count(*) FROM identity_before) <> 1 THEN
    RAISE EXCEPTION 'identity_revision_fixture_missing';
  END IF;
END $$;
-- Model an already consumed generation, without fabricating verified proof.
-- Synthetic proof row tests invalidation only, not verifier correctness/public UI.
INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,
  source_revision,source_chain_hash,settlement_revision,outcome_hash,
  public_outcome,request_hash,idempotency_key,actor_user_id,verification_scope)
SELECT tournament_id,id,source_revision,source_chain_hash,987654,repeat('a',64),
  '{}'::jsonb,repeat('b',64),'identity58-synthetic-invalidation',
  '81100000-0000-4000-8000-000000000001','historical_display' FROM identity_before;
UPDATE public.tracker_historical_display_queue SET status='completed',
  lease_token=NULL,lease_until=NULL
WHERE hand_id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET hand_number=hand_number+100
WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ DECLARE before_row record; after_row record; BEGIN
  SELECT * INTO STRICT before_row FROM identity_before;
  SELECT h.*,s.source_chain_hash INTO STRICT after_row
  FROM public.tournament_hands h
  CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s
  WHERE h.id=before_row.id;
  IF after_row.hand_number <> before_row.hand_number+100 THEN
    RAISE EXCEPTION 'identity_revision_owner_update_not_executed';
  END IF;
  IF after_row.source_revision <> before_row.source_revision+1 THEN
    RAISE EXCEPTION 'identity_revision_not_incremented';
  END IF;
  IF after_row.source_chain_hash IS NOT DISTINCT FROM before_row.source_chain_hash THEN
    RAISE EXCEPTION 'identity_revision_hash_not_changed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue
    WHERE hand_id=after_row.id AND source_revision=after_row.source_revision
      AND status='pending') THEN
    RAISE EXCEPTION 'identity_revision_new_queue_generation_missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes
    WHERE hand_id=after_row.id AND idempotency_key='identity58-synthetic-invalidation'
      AND status='stale') THEN
    RAISE EXCEPTION 'identity_revision_prior_proof_not_stale';
  END IF;
END $$;
CREATE TEMP TABLE identity_after AS SELECT * FROM public.tournament_hands
WHERE id='86000000-0000-4000-8000-000000000001';
-- Existing bookkeeping must not create another outcome generation.
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET updated_at=clock_timestamp()
WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ BEGIN
  IF (SELECT h.source_revision<>b.source_revision FROM public.tournament_hands h
    JOIN identity_after b USING(id)) THEN
    RAISE EXCEPTION 'identity_revision_bookkeeping_bumped';
  END IF;
END $$;
-- A mixed identity/outcome UPDATE executes the shared trigger only once.
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET hand_number=hand_number+1,button_seat=button_seat
WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ BEGIN
  IF NOT (SELECT h.source_revision=b.source_revision+1 FROM public.tournament_hands h
    JOIN identity_after b USING(id)) THEN
    RAISE EXCEPTION 'identity_revision_mixed_update_not_exactly_once';
  END IF;
END $$;
CREATE TEMP TABLE identity_before_denial AS SELECT to_jsonb(h) AS snapshot
FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
  'sub','81600000-0000-4000-8000-000000000001')::text,true);
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET hand_number=hand_number+1000
WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ BEGIN
  IF (SELECT to_jsonb(h) IS DISTINCT FROM b.snapshot FROM public.tournament_hands h
    CROSS JOIN identity_before_denial b WHERE h.id='86000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'identity_revision_foreign_actor_mutated_hand';
  END IF;
END $$;
-- Claim through the actual service-only RPC, not a fabricated lease token.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tracker_historical_display_queue
      WHERE status IN ('pending','processing')) <> 1 THEN
    RAISE EXCEPTION 'identity_revision_claim_fixture_not_isolated';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
CREATE TEMP TABLE identity_old_claim AS
SELECT * FROM public.claim_tracker_historical_display_jobs(1);
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM identity_old_claim WHERE
      hand_id='86000000-0000-4000-8000-000000000001' AND lease_token IS NOT NULL)<>1 THEN
    RAISE EXCEPTION 'identity_revision_claim_did_not_acquire_fixture';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
  'sub','81100000-0000-4000-8000-000000000001')::text,true);
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET hand_number=hand_number+1
WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
-- Lease validation must reject the stale worker before payload validation/write.
DO $$ DECLARE c record; BEGIN
  SELECT * INTO STRICT c FROM identity_old_claim;
  BEGIN
    PERFORM public.commit_tracker_historical_display_outcome_v2(c.hand_id,
      '00000000-0000-4000-8000-000000000001','system_worker',c.source_revision,
      repeat('c',64),repeat('d',64),repeat('e',64),'identity58-stale-worker-commit',
      '{}'::jsonb,c.lease_token);
    RAISE EXCEPTION 'identity_revision_old_lease_published';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'queue_lease_lost' THEN RAISE; END IF;
  END;
END $$;
CREATE TEMP TABLE identity_stale_finish AS SELECT
  public.finish_tracker_historical_display_job(hand_id,source_revision,lease_token,
    'completed',NULL) AS accepted FROM identity_old_claim;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes
      WHERE idempotency_key='identity58-stale-worker-commit') THEN
    RAISE EXCEPTION 'identity_revision_stale_worker_outcome_inserted';
  END IF;
  IF (SELECT accepted FROM identity_stale_finish) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'identity_revision_old_lease_finished';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q
      JOIN identity_old_claim c USING(hand_id,source_revision)
      WHERE q.status='cancelled' AND q.lease_token IS NULL) THEN
    RAISE EXCEPTION 'identity_revision_old_claim_not_cancelled';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q
      JOIN identity_old_claim c USING(hand_id)
      WHERE q.source_revision=c.source_revision+1 AND q.status='pending') THEN
    RAISE EXCEPTION 'identity_revision_replacement_not_pending';
  END IF;
END $$;
ROLLBACK;
\echo HAND_IDENTITY_REVISION_PENDING_GENERATION_PASS
