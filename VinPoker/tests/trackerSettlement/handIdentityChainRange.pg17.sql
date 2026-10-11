\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_card56_overlap_20261011' THEN
  RAISE EXCEPTION 'identity_chain_wrong_database';
 END IF;
END $$;
UPDATE public.tournament_hands SET status='completed'
 WHERE id='86000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_hands SELECT (jsonb_populate_record(NULL::public.tournament_hands,
 to_jsonb(h)||jsonb_build_object('id','86800000-0000-4000-8000-000000000058',
 'hand_number',h.hand_number+50,'locked_by_user_id',NULL,'locked_at',NULL))).*
 FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,
 source_revision,source_chain_hash,settlement_revision,outcome_hash,public_outcome,
 request_hash,idempotency_key,actor_user_id,verification_scope)
SELECT h.tournament_id,h.id,s.source_revision,s.source_chain_hash,1,repeat('a',64),
 '{}'::jsonb,repeat('b',64),'identity58-new-range-chain',
 '81100000-0000-4000-8000-000000000001','chain'
FROM public.tournament_hands h CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(h.id) s
WHERE h.id='86800000-0000-4000-8000-000000000058';
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET hand_number=hand_number+100
 WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ BEGIN
 IF NOT (SELECT o.source_chain_hash IS DISTINCT FROM s.source_chain_hash
   FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL
   public.get_tournament_settlement_source_hash(o.hand_id) s
   WHERE o.idempotency_key='identity58-new-range-chain') THEN
  RAISE EXCEPTION 'identity_chain_range_fixture_hash_not_changed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes
   WHERE idempotency_key='identity58-new-range-chain' AND status='stale') THEN
  RAISE EXCEPTION 'identity_chain_new_range_proof_not_stale';
 END IF;
END $$;
-- Synthetic proof is an invalidation oracle, not a successful verifier receipt.
UPDATE public.tournament_settlement_outcomes SET status='verified'
 WHERE idempotency_key='identity58-new-range-chain';
CREATE TEMP TABLE mixed_revision_before AS SELECT id,source_revision
 FROM public.tournament_hands WHERE id IN
 ('86000000-0000-4000-8000-000000000001','86800000-0000-4000-8000-000000000058');
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET
 hand_number=hand_number+CASE WHEN id='86800000-0000-4000-8000-000000000058' THEN 1 ELSE 0 END,
 pot_size=COALESCE(pot_size,0)+CASE WHEN id='86000000-0000-4000-8000-000000000001' THEN 1 ELSE 0 END
 WHERE id IN ('86000000-0000-4000-8000-000000000001','86800000-0000-4000-8000-000000000058');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM mixed_revision_before b JOIN public.tournament_hands h USING(id)
   WHERE h.source_revision=b.source_revision+1)<>2 THEN
   RAISE EXCEPTION 'identity_mixed_statement_revision_not_exactly_once';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes
   WHERE idempotency_key='identity58-new-range-chain' AND status='stale') THEN
   RAISE EXCEPTION 'identity_mixed_statement_proof_not_stale';
 END IF;
END $$;
ROLLBACK;
\echo HAND_IDENTITY58_NEW_CHAIN_RANGE_INVALIDATION_PASS
