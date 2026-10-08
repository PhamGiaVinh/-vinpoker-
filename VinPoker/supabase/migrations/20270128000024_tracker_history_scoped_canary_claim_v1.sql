-- SOURCE ONLY. Claim a bounded, explicit hand TEST cohort; no scheduler/backfill activation.
-- Rollback: restore previous worker/dispatcher artifacts, disable worker flag, then drop only this
-- scoped RPC if no caller remains. Preserve queue, outcome and audit history.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_tracker_historical_display_jobs_scoped_v1(p_hand_ids uuid[],p_limit integer DEFAULT 20)
RETURNS TABLE(hand_id uuid,source_revision bigint,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF COALESCE(current_setting('request.jwt.claims',true)::jsonb->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>20 OR p_hand_ids IS NULL
  OR cardinality(p_hand_ids)<1 OR cardinality(p_hand_ids)>20 OR array_position(p_hand_ids,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT id) FROM unnest(p_hand_ids) id)<>cardinality(p_hand_ids) THEN
  RAISE EXCEPTION 'invalid_hand_scope' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH candidates AS (
  SELECT q.hand_id,q.source_revision FROM public.tracker_historical_display_queue q
  JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision
  WHERE q.hand_id=ANY(p_hand_ids)
   AND ((q.status='pending' AND q.next_attempt_at<=now()) OR (q.status='processing' AND q.lease_until<now()))
   AND h.status='completed' AND NOT COALESCE(h.is_voided,false)
  ORDER BY q.next_attempt_at,q.enqueued_at,q.hand_id,q.source_revision
  LIMIT p_limit FOR UPDATE OF q SKIP LOCKED
 ), claimed AS (
  UPDATE public.tracker_historical_display_queue q SET status='processing',attempts=q.attempts+1,
   lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now()
  FROM candidates c WHERE q.hand_id=c.hand_id AND q.source_revision=c.source_revision
  RETURNING q.hand_id,q.source_revision,q.lease_token
 ) SELECT * FROM claimed;
END;
$$;
ALTER FUNCTION public.claim_tracker_historical_display_jobs_scoped_v1(uuid[],integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_tracker_historical_display_jobs_scoped_v1(uuid[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tracker_historical_display_jobs_scoped_v1(uuid[],integer) TO service_role;
COMMIT;
