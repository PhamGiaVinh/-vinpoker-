-- Tracker history completion: frozen blind evidence, durable verifier queue,
-- and service-only worker leasing. Source-only; production apply is owner-gated.
-- Rollback: stop the worker and revoke its RPC grants. Keep immutable audit rows;
-- forward migration may disable enqueue triggers without deleting queue history.

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS tracker_blind_evidence jsonb;

ALTER TABLE public.tournament_settlement_outcomes
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'owner_admin';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_settlement_outcomes_actor_kind_check'
      AND conrelid = 'public.tournament_settlement_outcomes'::regclass) THEN
    ALTER TABLE public.tournament_settlement_outcomes
      ADD CONSTRAINT tournament_settlement_outcomes_actor_kind_check
      CHECK (actor_kind IN ('owner_admin', 'system_worker'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tracker_historical_display_queue (
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','needs_attention','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  PRIMARY KEY (hand_id, source_revision)
);
CREATE INDEX IF NOT EXISTS idx_tracker_history_queue_ready
  ON public.tracker_historical_display_queue(next_attempt_at, enqueued_at)
  WHERE status IN ('pending','processing');
ALTER TABLE public.tracker_historical_display_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tracker_historical_display_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tracker_historical_display_queue TO service_role;

CREATE OR REPLACE FUNCTION public.tracker_enqueue_historical_display(p_hand_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hand record;
BEGIN
  SELECT id, status, is_voided, source_revision INTO v_hand
  FROM public.tournament_hands WHERE id = p_hand_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_hand.status = 'completed' AND NOT COALESCE(v_hand.is_voided, false) THEN
    UPDATE public.tracker_historical_display_queue SET status = 'cancelled', lease_token = NULL,
      lease_until = NULL, updated_at = now()
    WHERE hand_id = p_hand_id AND source_revision <> v_hand.source_revision
      AND status IN ('pending','processing');
    INSERT INTO public.tracker_historical_display_queue(hand_id, source_revision, status, attempts,
      next_attempt_at, lease_token, lease_until, last_error_code, enqueued_at, updated_at, completed_at)
    VALUES (v_hand.id, v_hand.source_revision, 'pending', 0, now(), NULL, NULL, NULL, now(), now(), NULL)
    ON CONFLICT (hand_id, source_revision) DO UPDATE SET
      status = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN 'pending' ELSE tracker_historical_display_queue.status END,
      attempts = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN 0 ELSE tracker_historical_display_queue.attempts END,
      next_attempt_at = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN now() ELSE tracker_historical_display_queue.next_attempt_at END,
      lease_token = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN NULL ELSE tracker_historical_display_queue.lease_token END,
      lease_until = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN NULL ELSE tracker_historical_display_queue.lease_until END,
      last_error_code = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN NULL ELSE tracker_historical_display_queue.last_error_code END,
      enqueued_at = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN now() ELSE tracker_historical_display_queue.enqueued_at END,
      updated_at = now(), completed_at = CASE WHEN tracker_historical_display_queue.status IN ('cancelled','completed','needs_attention')
        THEN NULL ELSE tracker_historical_display_queue.completed_at END;
  ELSE
    UPDATE public.tracker_historical_display_queue SET status = 'cancelled', lease_token = NULL,
      lease_until = NULL, last_error_code = NULL, updated_at = now()
    WHERE hand_id = p_hand_id AND status IN ('pending','processing');
  END IF;
END $$;
ALTER FUNCTION public.tracker_enqueue_historical_display(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tracker_enqueue_historical_display(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tracker_enqueue_historical_display_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.tracker_enqueue_historical_display(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END $$;
ALTER FUNCTION public.tracker_enqueue_historical_display_trigger() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tracker_enqueue_historical_display_trigger() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_tracker_enqueue_historical_display ON public.tournament_hands;
CREATE TRIGGER trg_tracker_enqueue_historical_display
AFTER INSERT OR UPDATE ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION public.tracker_enqueue_historical_display_trigger();

-- Include all frozen blind fields in revision ownership. No mutable level/stack
-- lookup is used to fill missing historical evidence.
CREATE OR REPLACE FUNCTION public.tracker_bump_hand_source_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'tournament_hands' THEN
    PERFORM public.tracker_mark_prior_settlements_stale(OLD.id);
    NEW.source_revision := COALESCE(OLD.source_revision, 1) + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  UPDATE public.tournament_hands SET source_revision = source_revision + 1, updated_at = now()
  WHERE id = COALESCE(NEW.hand_id, OLD.hand_id);
  PERFORM public.tracker_mark_prior_settlements_stale(COALESCE(NEW.hand_id, OLD.hand_id));
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_tracker_hand_source_revision ON public.tournament_hands;
CREATE TRIGGER trg_tracker_hand_source_revision
BEFORE UPDATE OF button_seat, community_cards, pot_size, side_pots, status, is_voided,
  tracker_level_id, tracker_level_number, tracker_small_blind, tracker_big_blind, tracker_bba,
  tracker_is_break, tracker_blind_evidence ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();

CREATE OR REPLACE FUNCTION floor_private.guard_tracker_blind_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user <> 'postgres' AND (
    (TG_OP = 'INSERT' AND (NEW.tracker_level_id IS NOT NULL OR NEW.tracker_level_number IS NOT NULL
      OR NEW.tracker_small_blind IS NOT NULL OR NEW.tracker_big_blind IS NOT NULL
      OR NEW.tracker_bba IS NOT NULL OR NEW.tracker_is_break IS NOT NULL
      OR NEW.tracker_blind_evidence IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (
      NEW.tracker_level_id IS DISTINCT FROM OLD.tracker_level_id
      OR NEW.tracker_level_number IS DISTINCT FROM OLD.tracker_level_number
      OR NEW.tracker_small_blind IS DISTINCT FROM OLD.tracker_small_blind
      OR NEW.tracker_big_blind IS DISTINCT FROM OLD.tracker_big_blind
      OR NEW.tracker_bba IS DISTINCT FROM OLD.tracker_bba
      OR NEW.tracker_is_break IS DISTINCT FROM OLD.tracker_is_break
      OR NEW.tracker_blind_evidence IS DISTINCT FROM OLD.tracker_blind_evidence))
  ) THEN
    RAISE EXCEPTION 'tracker_blind_snapshot_server_owned';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
ALTER FUNCTION floor_private.guard_tracker_blind_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.guard_tracker_blind_snapshot() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_tracker_blind_snapshot_insert ON public.tournament_hands;
CREATE TRIGGER trg_guard_tracker_blind_snapshot_insert BEFORE INSERT ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_blind_snapshot();
DROP TRIGGER IF EXISTS trg_guard_tracker_blind_snapshot_update ON public.tournament_hands;
CREATE TRIGGER trg_guard_tracker_blind_snapshot_update
BEFORE UPDATE OF tracker_level_id, tracker_level_number, tracker_small_blind, tracker_big_blind,
  tracker_bba, tracker_is_break, tracker_blind_evidence ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_blind_snapshot();

CREATE OR REPLACE FUNCTION public.get_tournament_historical_display_source_hash(p_hand_id uuid)
RETURNS TABLE(source_revision bigint, source_chain_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT h.source_revision, encode(extensions.digest(convert_to(jsonb_build_object(
    'hand_id', h.id, 'tournament_id', h.tournament_id, 'hand_number', h.hand_number,
    'source_revision', h.source_revision, 'button_seat', h.button_seat,
    'community_cards', h.community_cards, 'pot_size', h.pot_size, 'side_pots', h.side_pots,
    'status', h.status, 'is_voided', h.is_voided,
    'tracker_level_id', h.tracker_level_id, 'tracker_level_number', h.tracker_level_number,
    'tracker_small_blind', h.tracker_small_blind, 'tracker_big_blind', h.tracker_big_blind,
    'tracker_bba', h.tracker_bba, 'tracker_is_break', h.tracker_is_break,
    'tracker_blind_evidence', h.tracker_blind_evidence,
    'players', COALESCE((SELECT jsonb_agg(to_jsonb(hp) ORDER BY hp.seat_number, hp.player_id, hp.entry_number)
      FROM public.hand_players hp WHERE hp.hand_id = h.id), '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(to_jsonb(ha) ORDER BY ha.action_order, ha.id)
      FROM public.hand_actions ha WHERE ha.hand_id = h.id), '[]'::jsonb)
  )::text, 'utf8'), 'sha256'), 'hex')
  FROM public.tournament_hands h WHERE h.id = p_hand_id;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_historical_display_source_hash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_historical_display_source_hash(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_tracker_historical_display_jobs(p_limit integer DEFAULT 20)
RETURNS TABLE(hand_id uuid, source_revision bigint, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid_batch_limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT q.hand_id, q.source_revision FROM public.tracker_historical_display_queue q
    JOIN public.tournament_hands h ON h.id = q.hand_id AND h.source_revision = q.source_revision
    WHERE ((q.status = 'pending' AND q.next_attempt_at <= now())
      OR (q.status = 'processing' AND q.lease_until < now()))
      AND h.status = 'completed' AND NOT COALESCE(h.is_voided, false)
    ORDER BY q.next_attempt_at, q.enqueued_at, q.hand_id, q.source_revision
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.tracker_historical_display_queue q SET status = 'processing',
      attempts = q.attempts + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    FROM candidates c WHERE q.hand_id = c.hand_id AND q.source_revision = c.source_revision
    RETURNING q.hand_id, q.source_revision, q.lease_token
  ) SELECT * FROM claimed;
END $$;
ALTER FUNCTION public.claim_tracker_historical_display_jobs(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_tracker_historical_display_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tracker_historical_display_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_tracker_historical_display_job(
  p_hand_id uuid, p_source_revision bigint, p_lease_token uuid,
  p_status text, p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('completed','pending','needs_attention') THEN
    RAISE EXCEPTION 'invalid_queue_status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tracker_historical_display_queue q SET status = p_status,
    next_attempt_at = CASE WHEN p_status = 'pending' THEN now() +
      make_interval(secs => LEAST(3600, (2 ^ LEAST(q.attempts, 10))::integer)) ELSE q.next_attempt_at END,
    last_error_code = p_error_code, lease_token = NULL, lease_until = NULL,
    updated_at = now(), completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END
  WHERE q.hand_id = p_hand_id AND q.source_revision = p_source_revision
    AND q.status = 'processing' AND q.lease_token = p_lease_token AND q.lease_until > now();
  RETURN FOUND;
END $$;
ALTER FUNCTION public.finish_tracker_historical_display_job(uuid,bigint,uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_tracker_historical_display_job(uuid,bigint,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_tracker_historical_display_job(uuid,bigint,uuid,text,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.tracker_hand_blind_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  expected_source_revision bigint NOT NULL,
  resulting_source_revision bigint NOT NULL,
  actor_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hand_id, idempotency_key)
);
ALTER TABLE public.tracker_hand_blind_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tracker_hand_blind_correction_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tracker_hand_blind_correction_audit TO service_role;

CREATE OR REPLACE FUNCTION public.correct_tracker_historical_hand_blinds(
  p_hand_id uuid, p_actor_user_id uuid, p_expected_source_revision bigint,
  p_level_id uuid, p_reason text, p_idempotency_key text, p_evidence jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hand public.tournament_hands%ROWTYPE;
  v_level record;
  v_club_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_existing public.tracker_hand_blind_correction_audit%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 8 OR length(trim(COALESCE(p_idempotency_key, ''))) < 12
    OR COALESCE(jsonb_typeof(p_evidence) <> 'object' OR p_evidence = '{}'::jsonb, true) THEN
    RAISE EXCEPTION 'invalid_blind_correction_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_existing FROM public.tracker_hand_blind_correction_audit
   WHERE hand_id = p_hand_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.actor_user_id <> p_actor_user_id OR v_existing.expected_source_revision <> p_expected_source_revision
      OR v_existing.reason <> trim(p_reason) OR v_existing.evidence <> p_evidence THEN
      RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'source_revision', v_existing.resulting_source_revision);
  END IF;
  IF v_hand.source_revision <> p_expected_source_revision THEN
    RAISE EXCEPTION 'stale_source_revision' USING ERRCODE = '40001';
  END IF;
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = v_hand.tournament_id;
  IF NOT FOUND OR NOT (public.is_club_owner(p_actor_user_id, v_club_id)
    OR public.is_club_admin(p_actor_user_id, v_club_id)) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Preserve any valid stored snapshot. Never infer from current level,
  -- hand number, post amount, current chips or stacks.
  IF v_hand.tracker_small_blind > 0 AND v_hand.tracker_big_blind > v_hand.tracker_small_blind
    AND COALESCE(v_hand.tracker_bba, -1) >= 0 AND v_hand.tracker_level_id IS NOT NULL
    AND COALESCE(v_hand.tracker_level_number, 0) > 0 AND NOT COALESCE(v_hand.tracker_is_break, true) THEN
    RAISE EXCEPTION 'blind_snapshot_already_present' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, level_number, small_blind, big_blind, ante, is_break INTO v_level
  FROM public.tournament_levels WHERE id = p_level_id AND tournament_id = v_hand.tournament_id
  FOR SHARE;
  IF NOT FOUND OR COALESCE(v_level.is_break, true) OR v_level.small_blind <= 0
    OR v_level.big_blind <= v_level.small_blind OR v_level.ante < 0 THEN
    RAISE EXCEPTION 'invalid_tournament_level_snapshot' USING ERRCODE = '22023';
  END IF;
  v_before := jsonb_build_object('levelId', v_hand.tracker_level_id, 'levelNumber', v_hand.tracker_level_number,
    'smallBlind', v_hand.tracker_small_blind, 'bigBlind', v_hand.tracker_big_blind,
    'ante', v_hand.tracker_bba, 'isBreak', v_hand.tracker_is_break,
    'blindEvidence', v_hand.tracker_blind_evidence);
  UPDATE public.tournament_hands SET tracker_level_id = v_level.id,
    tracker_level_number = v_level.level_number, tracker_small_blind = v_level.small_blind,
    tracker_big_blind = v_level.big_blind, tracker_bba = v_level.ante, tracker_is_break = false,
    tracker_blind_evidence = jsonb_build_object('kind', 'owner_admin_correction',
      'evidence', p_evidence, 'reason', p_reason, 'actorUserId', p_actor_user_id)
  WHERE id = p_hand_id RETURNING * INTO v_hand;
  v_after := jsonb_build_object('levelId', v_hand.tracker_level_id, 'levelNumber', v_hand.tracker_level_number,
    'smallBlind', v_hand.tracker_small_blind, 'bigBlind', v_hand.tracker_big_blind,
    'ante', v_hand.tracker_bba, 'isBreak', v_hand.tracker_is_break,
    'blindEvidence', v_hand.tracker_blind_evidence);
  INSERT INTO public.tracker_hand_blind_correction_audit(hand_id, expected_source_revision,
    resulting_source_revision, actor_user_id, idempotency_key, reason, evidence, before_snapshot, after_snapshot)
  VALUES (p_hand_id, p_expected_source_revision, v_hand.source_revision, p_actor_user_id,
    p_idempotency_key, trim(p_reason), p_evidence, v_before, v_after);
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'source_revision', v_hand.source_revision);
END $$;
ALTER FUNCTION public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_tracker_historical_display_queue_status(p_tournament_id uuid)
RETURNS TABLE(hand_id uuid, hand_number integer, source_revision bigint, queue_status text,
  last_error_code text, enqueued_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR NOT (public.is_club_owner(auth.uid(), v_club_id)
    OR public.is_club_admin(auth.uid(), v_club_id)) THEN
    RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT h.id, h.hand_number, h.source_revision,
    CASE WHEN h.tracker_small_blind IS NULL OR h.tracker_small_blind <= 0
        OR h.tracker_big_blind IS NULL OR h.tracker_big_blind <= h.tracker_small_blind
        OR h.tracker_bba IS NULL OR h.tracker_bba < 0 OR h.tracker_level_id IS NULL
      THEN 'missing_blind'
      WHEN q.status = 'needs_attention'
        OR (q.status IN ('pending','processing') AND now() - q.enqueued_at > interval '10 seconds')
      THEN 'needs_attention'
      WHEN q.status IN ('pending','processing') THEN 'pending'
      WHEN EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes stale
        WHERE stale.hand_id = h.id AND stale.verification_scope = 'historical_display' AND stale.status = 'stale')
      THEN 'stale'
      ELSE 'missing_outcome' END, q.last_error_code,
    q.enqueued_at, q.updated_at
  FROM public.tournament_hands h LEFT JOIN public.tracker_historical_display_queue q
    ON q.hand_id = h.id AND q.source_revision = h.source_revision
  WHERE h.tournament_id = p_tournament_id AND h.status = 'completed' AND NOT COALESCE(h.is_voided, false)
    AND (h.tracker_small_blind IS NULL OR h.tracker_small_blind <= 0
      OR h.tracker_big_blind IS NULL OR h.tracker_big_blind <= h.tracker_small_blind
      OR h.tracker_bba IS NULL OR h.tracker_bba < 0 OR h.tracker_level_id IS NULL
      OR q.status IN ('needs_attention','pending','processing')
      OR NOT EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id = h.id
        AND o.status = 'verified' AND o.verification_scope = 'historical_display'
        AND o.source_revision = h.source_revision));
END $$;
ALTER FUNCTION public.get_tracker_historical_display_queue_status(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tracker_historical_display_queue_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tracker_historical_display_queue_status(uuid) TO authenticated, service_role;

-- Single CAS writer for both the retained owner/admin preview path and the
-- system worker. The worker identity is a fixed audit UUID; its queue lease is
-- checked and consumed in the same transaction as the immutable outcome row.
CREATE OR REPLACE FUNCTION public.commit_tracker_historical_display_outcome_v2(
  p_hand_id uuid, p_actor_user_id uuid, p_actor_kind text,
  p_expected_source_revision bigint, p_expected_source_chain_hash text,
  p_outcome_hash text, p_request_hash text, p_idempotency_key text,
  p_public_outcome jsonb, p_lease_token uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_hand public.tournament_hands%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_source record;
  v_existing public.tournament_settlement_outcomes%ROWTYPE;
  v_item jsonb;
  v_player_id uuid;
  v_starting numeric;
  v_committed numeric;
  v_award numeric;
  v_refund numeric;
  v_credited numeric;
  v_delta numeric;
  v_external numeric;
  v_ending numeric;
  v_player_count integer;
  v_next_revision bigint;
BEGIN
  IF COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_actor_kind NOT IN ('owner_admin','system_worker') OR p_idempotency_key IS NULL
    OR length(trim(p_idempotency_key)) < 12 OR p_request_hash !~ '^[0-9a-f]{64}$'
    OR p_outcome_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_historical_commit' USING ERRCODE = '22023';
  END IF;
  IF p_actor_kind = 'system_worker' AND p_actor_user_id <> '00000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'invalid_system_actor' USING ERRCODE = '42501';
  END IF;
  IF p_actor_kind = 'system_worker' AND p_lease_token IS NULL THEN
    RAISE EXCEPTION 'queue_lease_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false) THEN
    RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_hand.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE = 'P0001'; END IF;

  IF p_actor_kind = 'system_worker' THEN
    PERFORM 1 FROM public.tracker_historical_display_queue q
      WHERE q.hand_id = p_hand_id AND q.source_revision = p_expected_source_revision
        AND q.status = 'processing' AND q.lease_token = p_lease_token AND q.lease_until > now()
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_lease_lost' USING ERRCODE = '40001'; END IF;
  ELSE
    IF NOT (public.is_club_owner(p_actor_user_id, v_tournament.club_id)
      OR public.is_club_admin(p_actor_user_id, v_tournament.club_id)) THEN
      RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT o.* INTO v_existing FROM public.tournament_settlement_outcomes o
    WHERE o.tournament_id = v_hand.tournament_id AND o.idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.hand_id <> p_hand_id OR v_existing.request_hash <> p_request_hash
      OR v_existing.actor_user_id <> p_actor_user_id OR v_existing.actor_kind <> p_actor_kind
      OR v_existing.source_revision <> p_expected_source_revision OR v_existing.outcome_hash <> p_outcome_hash THEN
      RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE = '22023';
    END IF;
    IF p_actor_kind = 'system_worker' THEN
      UPDATE public.tracker_historical_display_queue SET status = 'completed', lease_token = NULL,
        lease_until = NULL, last_error_code = NULL, completed_at = now(), updated_at = now()
      WHERE hand_id = p_hand_id AND source_revision = p_expected_source_revision
        AND status = 'processing' AND lease_token = p_lease_token AND lease_until > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'queue_lease_lost' USING ERRCODE = '40001'; END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'settlement_revision', v_existing.settlement_revision, 'outcome_hash', v_existing.outcome_hash);
  END IF;

  PERFORM hp.id FROM public.hand_players hp WHERE hp.hand_id = p_hand_id
    ORDER BY hp.seat_number, hp.player_id, hp.entry_number FOR UPDATE;
  PERFORM ha.id FROM public.hand_actions ha WHERE ha.hand_id = p_hand_id
    ORDER BY ha.action_order, ha.id FOR UPDATE;
  SELECT * INTO v_source FROM public.get_tournament_historical_display_source_hash(p_hand_id);
  IF NOT FOUND OR v_hand.source_revision <> p_expected_source_revision
    OR v_source.source_revision <> p_expected_source_revision
    OR v_source.source_chain_hash <> p_expected_source_chain_hash THEN
    RAISE EXCEPTION 'stale_source_revision' USING ERRCODE = '40001';
  END IF;
  SELECT COALESCE(max(o.settlement_revision), 0) + 1 INTO v_next_revision
    FROM public.tournament_settlement_outcomes o WHERE o.hand_id = p_hand_id;

  IF p_public_outcome->>'schemaVersion' <> 'settlement-outcome-v1'
    OR p_public_outcome->>'status' <> 'verified'
    OR p_public_outcome->>'sourceRevision' <> p_expected_source_revision::text
    OR p_public_outcome->>'sourceChainHash' <> p_expected_source_chain_hash
    OR p_public_outcome->>'settlementRevision' <> v_next_revision::text
    OR p_public_outcome->>'outcomeHash' <> p_outcome_hash
    OR p_public_outcome->>'ruleVersion' <> 'clockwise-first-eligible-winner-left-of-button/v1'
    OR jsonb_typeof(p_public_outcome->'players') <> 'array'
    OR jsonb_typeof(p_public_outcome->'pots') <> 'array'
    OR jsonb_typeof(p_public_outcome->'refunds') <> 'array'
    OR jsonb_typeof(p_public_outcome->'handRanks') <> 'array'
    OR jsonb_typeof(p_public_outcome->'totals') <> 'object' THEN
    RAISE EXCEPTION 'malformed_public_outcome' USING ERRCODE = '22023';
  END IF;
  IF jsonb_path_exists(p_public_outcome, '$.**.privateEvidence')
    OR jsonb_path_exists(p_public_outcome, '$.**.holeCards')
    OR jsonb_path_exists(p_public_outcome, '$.**.holeCardsByPlayer')
    OR jsonb_path_exists(p_public_outcome, '$.**.muckedHoleCardsByPlayer')
    OR jsonb_path_exists(p_public_outcome, '$.**.externalAdjustments')
    OR jsonb_path_exists(p_public_outcome, '$.**.evaluatorInput')
    OR jsonb_path_exists(p_public_outcome, '$.**.correctionNotes')
    OR jsonb_path_exists(p_public_outcome, '$.**.staffIdentity')
    OR jsonb_path_exists(p_public_outcome, '$.**.actor') THEN
    RAISE EXCEPTION 'private_field_in_public_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_player_count FROM public.hand_players WHERE hand_id = p_hand_id;
  IF jsonb_array_length(p_public_outcome->'players') <> v_player_count
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_public_outcome->'players') p(value)
      GROUP BY p.value->>'playerId' HAVING count(*) <> 1) THEN
    RAISE EXCEPTION 'historical_player_projection_mismatch' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_public_outcome->'players') LOOP
    BEGIN
      v_player_id := (v_item->>'playerId')::uuid;
      v_starting := (v_item->>'startingStack')::numeric;
      v_committed := (v_item->>'committedTotal')::numeric;
      v_award := (v_item->>'potAward')::numeric;
      v_refund := (v_item->>'refund')::numeric;
      v_credited := (v_item->>'creditedTotal')::numeric;
      v_delta := (v_item->>'netDelta')::numeric;
      v_external := (v_item->>'externalDelta')::numeric;
      v_ending := (v_item->>'endingStack')::numeric;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'malformed_historical_player_projection' USING ERRCODE = '22023';
    END;
    IF v_starting < 0 OR v_committed < 0 OR v_award < 0 OR v_refund < 0 OR v_credited < 0 OR v_ending < 0
      OR v_starting <> trunc(v_starting) OR v_committed <> trunc(v_committed)
      OR v_award <> trunc(v_award) OR v_refund <> trunc(v_refund) OR v_credited <> trunc(v_credited)
      OR v_delta <> trunc(v_delta) OR v_external <> trunc(v_external) OR v_ending <> trunc(v_ending)
      OR v_credited <> v_award + v_refund OR v_delta <> v_credited - v_committed
      OR v_ending <> v_starting + v_delta OR v_external <> 0
      OR NOT EXISTS (SELECT 1 FROM public.hand_players hp WHERE hp.hand_id = p_hand_id
        AND hp.player_id = v_player_id AND hp.starting_stack = v_starting
        AND hp.ending_stack = v_ending AND hp.is_eliminated = (v_ending = 0)) THEN
      RAISE EXCEPTION 'historical_player_projection_mismatch' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = p_hand_id AND o.settlement_revision = v_next_revision) THEN
    RAISE EXCEPTION 'settlement_revision_conflict' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.tournament_settlement_outcomes(tournament_id, hand_id, source_revision,
    source_chain_hash, settlement_revision, outcome_hash, rule_version, status, public_outcome,
    request_hash, idempotency_key, actor_user_id, verification_scope, actor_kind)
  VALUES (v_hand.tournament_id, p_hand_id, p_expected_source_revision, p_expected_source_chain_hash,
    v_next_revision, p_outcome_hash, p_public_outcome->>'ruleVersion', 'verified', p_public_outcome,
    p_request_hash, p_idempotency_key, p_actor_user_id, 'historical_display', p_actor_kind);
  IF p_actor_kind = 'system_worker' THEN
    UPDATE public.tracker_historical_display_queue SET status = 'completed', lease_token = NULL,
      lease_until = NULL, last_error_code = NULL, completed_at = now(), updated_at = now()
    WHERE hand_id = p_hand_id AND source_revision = p_expected_source_revision
      AND status = 'processing' AND lease_token = p_lease_token AND lease_until > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'queue_lease_lost' USING ERRCODE = '40001'; END IF;
  ELSE
    UPDATE public.tracker_historical_display_queue SET status = 'completed', lease_token = NULL,
      lease_until = NULL, last_error_code = NULL, completed_at = now(), updated_at = now()
    WHERE hand_id = p_hand_id AND source_revision = p_expected_source_revision
      AND status IN ('pending','processing');
  END IF;
  RETURN jsonb_build_object('ok', true, 'idempotent', false,
    'settlement_revision', v_next_revision, 'outcome_hash', p_outcome_hash);
END $$;
ALTER FUNCTION public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid) TO service_role;

-- Preserve the established RPC signature for any already-released caller while
-- routing it through monotonic revision checks.
CREATE OR REPLACE FUNCTION public.commit_historical_tournament_settlement_display_outcome(
  p_hand_id uuid, p_actor_user_id uuid, p_expected_source_revision bigint,
  p_expected_source_chain_hash text, p_outcome_hash text, p_request_hash text,
  p_idempotency_key text, p_public_outcome jsonb
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.commit_tracker_historical_display_outcome_v2(
    p_hand_id, p_actor_user_id, 'owner_admin', p_expected_source_revision,
    p_expected_source_chain_hash, p_outcome_hash, p_request_hash,
    p_idempotency_key, p_public_outcome, NULL
  );
$$;
ALTER FUNCTION public.commit_historical_tournament_settlement_display_outcome(uuid,uuid,bigint,text,text,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_historical_tournament_settlement_display_outcome(uuid,uuid,bigint,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_historical_tournament_settlement_display_outcome(uuid,uuid,bigint,text,text,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_tournament_table_history_v2(
  p_tournament_id uuid, p_tournament_table_id uuid, p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH scope AS (
  SELECT tt.id FROM public.tournament_tables tt JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE tt.id = p_tournament_table_id AND tt.tournament_id = p_tournament_id AND t.deleted_at IS NULL
), rows AS (
  SELECT h.id, h.table_session_id, h.hand_number, h.created_at, h.community_cards, h.pot_size,
    h.button_seat, h.source_revision, h.tracker_small_blind, h.tracker_big_blind,
    h.tracker_level_number, h.tracker_bba
  FROM public.tournament_hands h JOIN scope s ON s.id = h.tournament_table_id
  WHERE h.tournament_id = p_tournament_id AND h.status = 'completed'
    AND NOT COALESCE(h.is_voided, false)
    AND (p_before_created_at IS NULL OR (h.created_at, h.id) < (p_before_created_at, p_before_id))
  ORDER BY h.created_at DESC, h.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
), page AS (
  SELECT * FROM rows ORDER BY created_at DESC, id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50)
), tail AS (
  SELECT created_at, id FROM rows ORDER BY created_at DESC, id DESC
  OFFSET LEAST(GREATEST(p_limit, 1), 50) LIMIT 1
), page_results AS (
  SELECT p.*, outcome.public_outcome,
    CASE WHEN p.tracker_small_blind > 0 AND p.tracker_big_blind > p.tracker_small_blind
      AND p.tracker_bba >= 0 AND outcome.public_outcome IS NOT NULL AND recipient.items IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(outcome.public_outcome->'pots') checked_pot
        JOIN LATERAL jsonb_array_elements(checked_pot.value->'allocations') checked_allocation ON true
        WHERE (checked_allocation.value->>'amount')::bigint > 0
          AND (SELECT count(*) FROM public.hand_players checked_player WHERE checked_player.hand_id = p.id
            AND checked_player.player_id::text = checked_allocation.value->>'winnerId') <> 1
      ) THEN jsonb_build_object('status','verified','recipients',recipient.items)
      ELSE jsonb_build_object('status','pending') END AS result
  FROM page p
  LEFT JOIN LATERAL (
    SELECT o.public_outcome FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = p.id AND o.status = 'verified' AND o.verification_scope = 'historical_display'
      AND o.source_revision = p.source_revision
    ORDER BY o.settlement_revision DESC LIMIT 1
  ) outcome ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
      'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
      'holeCards',COALESCE(hp.hole_cards,'[]'::jsonb),
      'potAward',(player.value->>'potAward')::bigint,'netDelta',(player.value->>'netDelta')::bigint,
      'potKinds',(SELECT COALESCE(jsonb_agg(DISTINCT pot.value->>'kind'),'[]'::jsonb)
        FROM jsonb_array_elements(outcome.public_outcome->'pots') pot
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(pot.value->'allocations') allocation
          WHERE allocation.value->>'winnerId' = hp.player_id::text AND (allocation.value->>'amount')::bigint > 0))
    ) ORDER BY hp.seat_number,hp.player_id) AS items
    FROM jsonb_array_elements(outcome.public_outcome->'players') player
    JOIN public.hand_players hp ON hp.hand_id = p.id AND hp.player_id::text = player.value->>'playerId'
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(outcome.public_outcome->'pots') pot
      JOIN LATERAL jsonb_array_elements(pot.value->'allocations') allocation ON true
      WHERE allocation.value->>'winnerId' = hp.player_id::text AND (allocation.value->>'amount')::bigint > 0)
  ) recipient ON true
)
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50
    OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN jsonb_build_object('error','invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access','revoked','items','[]'::jsonb)
  WHEN NOT EXISTS (SELECT 1 FROM scope) THEN jsonb_build_object('error','table_out_of_scope')
  ELSE jsonb_build_object('access','public',
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'handId',p.id,'tableSessionId',p.table_session_id,'handNumber',p.hand_number,'createdAt',p.created_at,
      'board',COALESCE(p.community_cards,'[]'::jsonb),'pot',p.pot_size,'buttonSeat',p.button_seat,
      'smallBlind',p.tracker_small_blind,'bigBlind',p.tracker_big_blind,'levelNumber',p.tracker_level_number,
      'ante',p.tracker_bba,'result',p.result) ORDER BY p.created_at DESC,p.id DESC) FROM page_results p),'[]'::jsonb),
    'nextCursor',CASE WHEN EXISTS (SELECT 1 FROM tail) THEN
      (SELECT jsonb_build_object('createdAt',p.created_at,'id',p.id) FROM page p ORDER BY p.created_at ASC,p.id ASC LIMIT 1)
      ELSE NULL END)
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid) TO anon, authenticated, service_role;

-- Re-enqueue every currently eligible hand whose public proof is absent or stale.
INSERT INTO public.tracker_historical_display_queue(hand_id, source_revision)
SELECT h.id, h.source_revision
FROM public.tournament_hands h
JOIN public.tournament_tables tt ON tt.id = h.tournament_table_id
JOIN public.tournaments t ON t.id = h.tournament_id AND t.deleted_at IS NULL
WHERE h.status = 'completed' AND NOT COALESCE(h.is_voided, false)
  AND NOT EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = h.id AND o.status = 'verified'
      AND o.verification_scope = 'historical_display' AND o.source_revision = h.source_revision)
ON CONFLICT (hand_id, source_revision) DO NOTHING;
