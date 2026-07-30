-- ============================================================================
-- Floor dual-control prize payout requests.
--
-- SOURCE ONLY. This migration must be applied only by the owner-gated
-- production runbook after disposable PostgreSQL and Preview UAT pass. It does
-- not call a payment provider and does not move money. A Floor actor can only
-- request that an owner/cashier record an externally completed prize hand-off.
--
-- Security invariants:
--   * actor identity always comes from auth.uid();
--   * Floor access requires a literal club_floors row AND an explicit grant;
--   * client code never supplies recipient or prize amount;
--   * request/ledger mutations are callable only through SECURITY DEFINER RPCs;
--   * direct owner/cashier recording and approved requests share one private
--     ledger writer;
--   * one lock order: tournament -> request -> club capability -> Floor grant
--     -> prize -> entry -> ledger;
--   * no SePay, bank, staking, Edge, or external payment call exists here.
--
-- ROLLBACK (controlled maintenance window only):
--   1. restore record_tournament_prize_payment(uuid,integer,text,text,text)
--      from migration 20261216000000;
--   2. drop these eight new public RPCs: set/list grant, fixture cleanup,
--      requestable places, create/cancel/list/review request. Do not drop the
--      direct record RPC restored in step 1;
--   3. drop the three request tables (events, requests, grants);
--   4. drop the private helper functions and drop schema vinpoker_private only
--      if no other reviewed migration uses it.
-- Never edit schema_migrations manually.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vinpoker_private;
REVOKE ALL ON SCHEMA vinpoker_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.club_floor_payout_request_grants (
  club_id       uuid        NOT NULL,
  floor_user_id uuid        NOT NULL,
  granted_by    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_floor_payout_request_grants_pkey
    PRIMARY KEY (club_id, floor_user_id),
  CONSTRAINT club_floor_payout_request_grants_floor_membership_fkey
    FOREIGN KEY (club_id, floor_user_id)
    REFERENCES public.club_floors(club_id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.tournament_prize_payment_requests (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                  uuid        NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  tournament_id            uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  finished_place           integer     NOT NULL CHECK (finished_place > 0),
  requested_by             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  method                   text        CHECK (method IN ('cash', 'bank', 'app', 'other')),
  notes                    text,
  -- Snapshot identifiers deliberately have no FK. Official payout editors
  -- replace prize rows with DELETE+INSERT; the request must become stale, not
  -- block that server-authoritative edit.
  snapshot_entry_id        uuid        NOT NULL,
  snapshot_recipient_ref   uuid,
  snapshot_recipient_name  text,
  snapshot_prize_id        uuid        NOT NULL,
  snapshot_prize_amount    numeric(12,2) NOT NULL CHECK (snapshot_prize_amount >= 0),
  snapshot_fingerprint     text        NOT NULL,
  status                   text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'stale', 'superseded')),
  reviewed_by              uuid        REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at              timestamptz,
  decision_reason          text,
  payment_id               uuid        REFERENCES public.tournament_prize_payments(id) ON DELETE RESTRICT,
  idempotency_key          text        NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_prize_payment_requests_idempotency_key_not_blank
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT tournament_prize_payment_requests_notes_length
    CHECK (notes IS NULL OR length(notes) <= 1000),
  CONSTRAINT tournament_prize_payment_requests_decision_length
    CHECK (decision_reason IS NULL OR length(decision_reason) <= 1000),
  CONSTRAINT tournament_prize_payment_requests_requester_key
    UNIQUE (requested_by, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_prize_payment_requests_pending_place
  ON public.tournament_prize_payment_requests(tournament_id, finished_place)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_prize_payment_requests_payment
  ON public.tournament_prize_payment_requests(payment_id)
  WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_prize_payment_requests_club_status
  ON public.tournament_prize_payment_requests(club_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tournament_prize_payment_requests_requester
  ON public.tournament_prize_payment_requests(requested_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tournament_prize_payment_request_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid        REFERENCES public.tournament_prize_payment_requests(id) ON DELETE RESTRICT,
  club_id        uuid        NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  floor_user_id  uuid        REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type     text        NOT NULL CHECK (
    event_type IN (
      'created', 'approved', 'rejected', 'cancelled', 'stale', 'superseded',
      'grant_added', 'grant_removed'
    )
  ),
  actor_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  detail         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tournament_prize_payment_request_events_request
  ON public.tournament_prize_payment_request_events(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tournament_prize_payment_request_events_club
  ON public.tournament_prize_payment_request_events(club_id, created_at DESC);

ALTER TABLE public.club_floor_payout_request_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_prize_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_prize_payment_request_events ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'club_floor_payout_request_grants'
      AND policyname = 'floor_payout_grants_read_self_owner'
  ) THEN
    CREATE POLICY floor_payout_grants_read_self_owner
      ON public.club_floor_payout_request_grants
      FOR SELECT TO authenticated
      USING (
        floor_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.clubs c
          WHERE c.id = club_floor_payout_request_grants.club_id
            AND c.owner_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tournament_prize_payment_requests'
      AND policyname = 'floor_payout_requests_read_scoped'
  ) THEN
    CREATE POLICY floor_payout_requests_read_scoped
      ON public.tournament_prize_payment_requests
      FOR SELECT TO authenticated
      USING (
        requested_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.clubs c
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = c.id AND cc.user_id = auth.uid()
          WHERE c.id = tournament_prize_payment_requests.club_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tournament_prize_payment_request_events'
      AND policyname = 'floor_payout_request_events_read_scoped'
  ) THEN
    CREATE POLICY floor_payout_request_events_read_scoped
      ON public.tournament_prize_payment_request_events
      FOR SELECT TO authenticated
      USING (
        floor_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.tournament_prize_payment_requests r
          WHERE r.id = tournament_prize_payment_request_events.request_id
            AND r.requested_by = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clubs c
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = c.id AND cc.user_id = auth.uid()
          WHERE c.id = tournament_prize_payment_request_events.club_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;
END;
$policies$;

REVOKE ALL ON TABLE
  public.club_floor_payout_request_grants,
  public.tournament_prize_payment_requests,
  public.tournament_prize_payment_request_events
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.club_floor_payout_request_grants,
  public.tournament_prize_payment_requests,
  public.tournament_prize_payment_request_events
TO authenticated;

CREATE OR REPLACE FUNCTION vinpoker_private.read_prize_snapshot(
  p_tournament_id uuid,
  p_finished_place integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_prize_count integer;
  v_entry_count integer;
  v_prize_id uuid;
  v_amount numeric;
  v_entry_id uuid;
  v_member_id uuid;
  v_player_id uuid;
  v_recipient_ref uuid;
  v_recipient_name text;
  v_fingerprint text;
BEGIN
  SELECT count(*) INTO v_prize_count
  FROM public.tournament_prizes
  WHERE tournament_id = p_tournament_id
    AND position = p_finished_place;
  IF v_prize_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'place_not_in_money');
  ELSIF v_prize_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_prize_place');
  END IF;

  SELECT id, amount
  INTO v_prize_id, v_amount
  FROM public.tournament_prizes
  WHERE tournament_id = p_tournament_id
    AND position = p_finished_place;

  SELECT count(*) INTO v_entry_count
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place;
  IF v_entry_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'place_not_finalized');
  ELSIF v_entry_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_finished_place');
  END IF;

  SELECT id, member_id, player_id
  INTO v_entry_id, v_member_id, v_player_id
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place;

  v_recipient_ref := COALESCE(v_member_id, v_player_id);
  SELECT cm.full_name
  INTO v_recipient_name
  FROM public.club_members cm
  WHERE cm.id = v_member_id;
  v_recipient_name := COALESCE(v_recipient_name, 'Khách');

  v_fingerprint := md5(concat_ws(
    '|',
    v_entry_id::text,
    COALESCE(v_recipient_ref::text, ''),
    COALESCE(v_recipient_name, ''),
    v_prize_id::text,
    v_amount::text,
    p_finished_place::text
  ));

  RETURN jsonb_build_object(
    'ok', true,
    'entryId', v_entry_id,
    'recipientRef', v_recipient_ref,
    'recipientName', v_recipient_name,
    'prizeId', v_prize_id,
    'prizeAmount', v_amount,
    'fingerprint', v_fingerprint
  );
END;
$function$;

CREATE OR REPLACE FUNCTION vinpoker_private.resolve_prize_snapshot_locked(
  p_tournament_id uuid,
  p_finished_place integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- Lock order after tournament/request: prize -> entry.
  PERFORM id
  FROM public.tournament_prizes
  WHERE tournament_id = p_tournament_id
    AND position = p_finished_place
  ORDER BY id
  FOR UPDATE;

  PERFORM id
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place
  ORDER BY id
  FOR UPDATE;

  RETURN vinpoker_private.read_prize_snapshot(p_tournament_id, p_finished_place);
END;
$function$;

CREATE OR REPLACE FUNCTION vinpoker_private.append_payout_request_event(
  p_request_id uuid,
  p_club_id uuid,
  p_floor_user_id uuid,
  p_event_type text,
  p_actor_id uuid,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  INSERT INTO public.tournament_prize_payment_request_events (
    request_id, club_id, floor_user_id, event_type, actor_id, detail
  )
  VALUES (
    p_request_id, p_club_id, p_floor_user_id, p_event_type, p_actor_id,
    COALESCE(p_detail, '{}'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION vinpoker_private.guard_payout_request_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('vinpoker.fixture_cleanup', true) = 'confirmed' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payout_request_history_is_immutable';
  END IF;

  IF OLD.club_id IS DISTINCT FROM NEW.club_id
    OR OLD.tournament_id IS DISTINCT FROM NEW.tournament_id
    OR OLD.finished_place IS DISTINCT FROM NEW.finished_place
    OR OLD.requested_by IS DISTINCT FROM NEW.requested_by
    OR OLD.method IS DISTINCT FROM NEW.method
    OR OLD.notes IS DISTINCT FROM NEW.notes
    OR OLD.snapshot_entry_id IS DISTINCT FROM NEW.snapshot_entry_id
    OR OLD.snapshot_recipient_ref IS DISTINCT FROM NEW.snapshot_recipient_ref
    OR OLD.snapshot_recipient_name IS DISTINCT FROM NEW.snapshot_recipient_name
    OR OLD.snapshot_prize_id IS DISTINCT FROM NEW.snapshot_prize_id
    OR OLD.snapshot_prize_amount IS DISTINCT FROM NEW.snapshot_prize_amount
    OR OLD.snapshot_fingerprint IS DISTINCT FROM NEW.snapshot_fingerprint
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'payout_request_snapshot_is_immutable';
  END IF;

  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal_payout_request_is_immutable';
  END IF;

  IF OLD.status = 'pending' AND NEW.status NOT IN (
    'pending', 'approved', 'rejected', 'cancelled', 'stale', 'superseded'
  ) THEN
    RAISE EXCEPTION 'invalid_payout_request_transition';
  END IF;

  IF NEW.status = 'pending' AND (
    NEW.reviewed_by IS NOT NULL
    OR NEW.reviewed_at IS NOT NULL
    OR NEW.decision_reason IS NOT NULL
    OR NEW.payment_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pending_payout_request_has_terminal_fields';
  END IF;

  IF NEW.status <> 'pending' AND (
    NEW.reviewed_by IS NULL
    OR NEW.reviewed_at IS NULL
    OR NEW.decision_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'terminal_payout_request_missing_review';
  END IF;

  IF NEW.status IN ('approved', 'superseded') AND NEW.payment_id IS NULL THEN
    RAISE EXCEPTION 'paid_payout_request_missing_payment';
  END IF;

  IF NEW.status IN ('rejected', 'cancelled', 'stale') AND NEW.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'unpaid_payout_request_has_payment';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_payout_request_history
  ON public.tournament_prize_payment_requests;
CREATE TRIGGER guard_payout_request_history
  BEFORE UPDATE OR DELETE ON public.tournament_prize_payment_requests
  FOR EACH ROW EXECUTE FUNCTION vinpoker_private.guard_payout_request_history();

CREATE OR REPLACE FUNCTION vinpoker_private.reject_payout_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('vinpoker.fixture_cleanup', true) = 'confirmed'
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'payout_request_events_are_append_only';
END;
$function$;

DROP TRIGGER IF EXISTS reject_payout_event_mutation
  ON public.tournament_prize_payment_request_events;
CREATE TRIGGER reject_payout_event_mutation
  BEFORE UPDATE OR DELETE ON public.tournament_prize_payment_request_events
  FOR EACH ROW EXECUTE FUNCTION vinpoker_private.reject_payout_event_mutation();

CREATE OR REPLACE FUNCTION vinpoker_private.audit_payout_grant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  -- Exact TEST cleanup must not create fresh audit rows while deleting them.
  IF current_setting('vinpoker.fixture_cleanup', true) = 'confirmed' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_actor := COALESCE(
    auth.uid(),
    CASE WHEN TG_OP = 'DELETE' THEN OLD.granted_by ELSE NEW.granted_by END
  );
  PERFORM vinpoker_private.append_payout_request_event(
    NULL,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.club_id ELSE NEW.club_id END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.floor_user_id ELSE NEW.floor_user_id END,
    CASE WHEN TG_OP = 'DELETE' THEN 'grant_removed' ELSE 'grant_added' END,
    v_actor,
    jsonb_build_object(
      'source',
      CASE WHEN TG_OP = 'DELETE' THEN 'grant_delete' ELSE 'grant_insert' END
    )
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS audit_payout_grant_change
  ON public.club_floor_payout_request_grants;
CREATE TRIGGER audit_payout_grant_change
  AFTER INSERT OR DELETE ON public.club_floor_payout_request_grants
  FOR EACH ROW EXECUTE FUNCTION vinpoker_private.audit_payout_grant_change();

CREATE OR REPLACE FUNCTION vinpoker_private.request_jwt_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_role text := NULLIF(current_setting('request.jwt.claim.role', true), '');
  v_claims text;
BEGIN
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;
  v_claims := NULLIF(current_setting('request.jwt.claims', true), '');
  IF v_claims IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v_claims::jsonb ->> 'role';
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION vinpoker_private.record_prize_payment_internal(
  p_tournament_id uuid,
  p_finished_place integer,
  p_actor uuid,
  p_method text,
  p_proof_url text,
  p_notes text,
  p_request_id uuid DEFAULT NULL,
  p_expected_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tournament record;
  v_pending public.tournament_prize_payment_requests;
  v_snapshot jsonb;
  v_existing public.tournament_prize_payments;
  v_payment public.tournament_prize_payments;
  v_error text;
BEGIN
  IF p_method IS NOT NULL AND p_method NOT IN ('cash', 'bank', 'app', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  END IF;

  -- Unified lock order: tournament -> request -> prize -> entry -> ledger.
  SELECT id, club_id
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT *
  INTO v_pending
  FROM public.tournament_prize_payment_requests
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place
    AND status = 'pending'
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF p_request_id IS NOT NULL
    AND (v_pending.id IS NULL OR v_pending.id IS DISTINCT FROM p_request_id)
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_pending');
  END IF;

  v_snapshot := vinpoker_private.resolve_prize_snapshot_locked(
    p_tournament_id,
    p_finished_place
  );
  IF COALESCE((v_snapshot ->> 'ok')::boolean, false) IS NOT TRUE THEN
    v_error := COALESCE(v_snapshot ->> 'error', 'snapshot_unavailable');
    IF p_request_id IS NOT NULL AND v_pending.id = p_request_id THEN
      UPDATE public.tournament_prize_payment_requests
      SET status = 'stale',
          reviewed_by = p_actor,
          reviewed_at = now(),
          decision_reason = v_error
      WHERE id = p_request_id;
      PERFORM vinpoker_private.append_payout_request_event(
        p_request_id, v_pending.club_id, v_pending.requested_by,
        'stale', p_actor, jsonb_build_object('reason', v_error)
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', v_error, 'outcome', 'stale');
  END IF;

  IF p_expected_fingerprint IS NOT NULL
    AND (v_snapshot ->> 'fingerprint') IS DISTINCT FROM p_expected_fingerprint
  THEN
    UPDATE public.tournament_prize_payment_requests
    SET status = 'stale',
        reviewed_by = p_actor,
        reviewed_at = now(),
        decision_reason = 'snapshot_changed'
    WHERE id = p_request_id
      AND status = 'pending';
    PERFORM vinpoker_private.append_payout_request_event(
      p_request_id, v_pending.club_id, v_pending.requested_by,
      'stale', p_actor, jsonb_build_object('reason', 'snapshot_changed')
    );
    RETURN jsonb_build_object('ok', false, 'error', 'snapshot_changed', 'outcome', 'stale');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.tournament_prize_payments
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place
    AND status = 'paid'
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_pending.id IS NOT NULL THEN
      UPDATE public.tournament_prize_payment_requests
      SET status = 'superseded',
          reviewed_by = p_actor,
          reviewed_at = now(),
          decision_reason = 'already_paid',
          payment_id = v_existing.id
      WHERE id = v_pending.id
        AND status = 'pending';
      PERFORM vinpoker_private.append_payout_request_event(
        v_pending.id, v_pending.club_id, v_pending.requested_by,
        'superseded', p_actor,
        jsonb_build_object('reason', 'already_paid', 'paymentId', v_existing.id)
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'already_paid',
      'request_status', CASE WHEN v_pending.id IS NULL THEN NULL ELSE 'superseded' END,
      'payment_id', v_existing.id,
      'prize_amount', v_existing.prize_amount,
      'paid_at', v_existing.paid_at
    );
  END IF;

  INSERT INTO public.tournament_prize_payments (
    tournament_id, club_id, finished_place, prize_amount,
    recipient_ref, recipient_name, status, paid_by,
    method, proof_url, notes
  )
  VALUES (
    p_tournament_id,
    v_tournament.club_id,
    p_finished_place,
    (v_snapshot ->> 'prizeAmount')::numeric,
    NULLIF(v_snapshot ->> 'recipientRef', '')::uuid,
    NULLIF(v_snapshot ->> 'recipientName', ''),
    'paid',
    p_actor,
    p_method,
    p_proof_url,
    p_notes
  )
  RETURNING * INTO v_payment;

  IF p_request_id IS NOT NULL THEN
    UPDATE public.tournament_prize_payment_requests
    SET status = 'approved',
        reviewed_by = p_actor,
        reviewed_at = now(),
        decision_reason = COALESCE(NULLIF(btrim(p_notes), ''), 'approved'),
        payment_id = v_payment.id
    WHERE id = p_request_id
      AND status = 'pending';
    PERFORM vinpoker_private.append_payout_request_event(
      p_request_id, v_pending.club_id, v_pending.requested_by,
      'approved', p_actor, jsonb_build_object('paymentId', v_payment.id)
    );
  ELSIF v_pending.id IS NOT NULL THEN
    UPDATE public.tournament_prize_payment_requests
    SET status = 'superseded',
        reviewed_by = p_actor,
        reviewed_at = now(),
        decision_reason = 'direct_payment_won',
        payment_id = v_payment.id
    WHERE id = v_pending.id
      AND status = 'pending';
    PERFORM vinpoker_private.append_payout_request_event(
      v_pending.id, v_pending.club_id, v_pending.requested_by,
      'superseded', p_actor,
      jsonb_build_object('reason', 'direct_payment_won', 'paymentId', v_payment.id)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'recorded',
    'request_status', CASE
      WHEN p_request_id IS NOT NULL THEN 'approved'
      WHEN v_pending.id IS NOT NULL THEN 'superseded'
      ELSE NULL
    END,
    'payment_id', v_payment.id,
    'prize_amount', v_payment.prize_amount,
    'paid_at', v_payment.paid_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION vinpoker_private.read_prize_snapshot(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.resolve_prize_snapshot_locked(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.append_payout_request_event(uuid, uuid, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.guard_payout_request_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.reject_payout_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.audit_payout_grant_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.request_jwt_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vinpoker_private.record_prize_payment_internal(
  uuid, integer, uuid, text, text, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_floor_payout_request_grant(
  p_club_id uuid,
  p_floor_user_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_changed boolean := false;
  v_row_count bigint := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_enabled');
  END IF;

  SELECT owner_id
  INTO v_owner
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'club_not_found');
  END IF;
  IF v_owner IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF p_enabled THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.club_floors
      WHERE club_id = p_club_id AND user_id = p_floor_user_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'floor_membership_required');
    END IF;

    INSERT INTO public.club_floor_payout_request_grants (
      club_id, floor_user_id, granted_by
    )
    VALUES (p_club_id, p_floor_user_id, v_actor)
    ON CONFLICT (club_id, floor_user_id) DO NOTHING;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_changed := v_row_count > 0;
  ELSE
    DELETE FROM public.club_floor_payout_request_grants
    WHERE club_id = p_club_id
      AND floor_user_id = p_floor_user_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_changed := v_row_count > 0;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', p_enabled,
    'changed', v_changed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_floor_payout_request_grants(
  p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_rows jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT owner_id INTO v_owner FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'club_not_found');
  END IF;
  IF v_owner IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'floorUserId', cf.user_id,
    'displayName', COALESCE(p.display_name, 'Floor ' || left(cf.user_id::text, 8)),
    'enabled', g.floor_user_id IS NOT NULL,
    'grantedAt', g.created_at
  ) ORDER BY COALESCE(p.display_name, cf.user_id::text)), '[]'::jsonb)
  INTO v_rows
  FROM public.club_floors cf
  LEFT JOIN public.club_floor_payout_request_grants g
    ON g.club_id = cf.club_id AND g.floor_user_id = cf.user_id
  LEFT JOIN public.profiles p ON p.user_id = cf.user_id
  WHERE cf.club_id = p_club_id;

  RETURN jsonb_build_object('ok', true, 'clubId', p_club_id, 'floors', v_rows);
END;
$function$;

-- Server-only exact cleanup for isolated Preview/canary actors. It is not
-- executable by browser roles and cannot target an ordinary tournament/user.
-- The harness must pass exact request/payment/grant-event IDs and exact TEST
-- actor IDs it owns. Reusing an actor with older grant history fails closed.
CREATE OR REPLACE FUNCTION public.cleanup_floor_payout_request_fixture(
  p_tournament_id uuid,
  p_request_ids uuid[],
  p_payment_ids uuid[],
  p_fixture_user_ids uuid[],
  p_grant_floor_user_ids uuid[],
  p_grant_event_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tournament record;
  v_request_ids uuid[] := COALESCE(p_request_ids, '{}'::uuid[]);
  v_payment_ids uuid[] := COALESCE(p_payment_ids, '{}'::uuid[]);
  v_user_ids uuid[] := COALESCE(p_fixture_user_ids, '{}'::uuid[]);
  v_grant_user_ids uuid[] := COALESCE(p_grant_floor_user_ids, '{}'::uuid[]);
  v_grant_event_ids uuid[] := COALESCE(p_grant_event_ids, '{}'::uuid[]);
  v_event_count bigint := 0;
  v_request_count bigint := 0;
  v_payment_count bigint := 0;
  v_grant_count bigint := 0;
  v_expected_grant_count bigint := 0;
BEGIN
  IF vinpoker_private.request_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_role_required');
  END IF;
  IF cardinality(v_request_ids) > 100
    OR cardinality(v_payment_ids) > 100
    OR cardinality(v_user_ids) NOT BETWEEN 1 AND 20
    OR cardinality(v_grant_user_ids) > 20
    OR cardinality(v_grant_event_ids) > 200
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cleanup_ledger_size');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_request_ids) AS ids(value) WHERE value IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(v_payment_ids) AS ids(value) WHERE value IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(v_user_ids) AS ids(value) WHERE value IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(v_grant_user_ids) AS ids(value) WHERE value IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(v_grant_event_ids) AS ids(value) WHERE value IS NULL)
    OR (SELECT count(*) FROM unnest(v_request_ids) AS ids(value))
      <> (SELECT count(DISTINCT value) FROM unnest(v_request_ids) AS ids(value))
    OR (SELECT count(*) FROM unnest(v_payment_ids) AS ids(value))
      <> (SELECT count(DISTINCT value) FROM unnest(v_payment_ids) AS ids(value))
    OR (SELECT count(*) FROM unnest(v_user_ids) AS ids(value))
      <> (SELECT count(DISTINCT value) FROM unnest(v_user_ids) AS ids(value))
    OR (SELECT count(*) FROM unnest(v_grant_user_ids) AS ids(value))
      <> (SELECT count(DISTINCT value) FROM unnest(v_grant_user_ids) AS ids(value))
    OR (SELECT count(*) FROM unnest(v_grant_event_ids) AS ids(value))
      <> (SELECT count(DISTINCT value) FROM unnest(v_grant_event_ids) AS ids(value))
    OR EXISTS (
      SELECT 1 FROM unnest(v_grant_user_ids) AS ids(value)
      WHERE NOT (value = ANY(v_user_ids))
    )
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cleanup_ledger');
  END IF;

  SELECT id, club_id, name
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF NOT (
    left(v_tournament.name, length('CODEX_FLOOR_UAT_')) = 'CODEX_FLOOR_UAT_'
    OR left(v_tournament.name, length('CODEX_FLOOR_CANARY_')) = 'CODEX_FLOOR_CANARY_'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fixture_prefix_required');
  END IF;
  PERFORM id
  FROM public.clubs
  WHERE id = v_tournament.club_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_user_ids) AS fixture_users(fixture_user_id)
    LEFT JOIN public.profiles p ON p.user_id = fixture_user_id
    WHERE p.user_id IS NULL
      OR NOT (
        COALESCE(
          left(p.display_name, length('CODEX_FLOOR_UAT_')) = 'CODEX_FLOOR_UAT_',
          false
        )
        OR COALESCE(
          left(p.display_name, length('CODEX_FLOOR_CANARY_')) = 'CODEX_FLOOR_CANARY_',
          false
        )
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fixture_actor_prefix_required');
  END IF;

  IF (
    SELECT count(*)
    FROM public.tournament_prize_payment_requests r
    WHERE r.id = ANY(v_request_ids)
      AND r.tournament_id = p_tournament_id
      AND r.requested_by = ANY(v_user_ids)
      AND (r.reviewed_by IS NULL OR r.reviewed_by = ANY(v_user_ids))
  ) <> cardinality(v_request_ids) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_request_ownership_mismatch');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_prize_payment_requests r
    WHERE r.tournament_id = p_tournament_id
      AND r.requested_by = ANY(v_user_ids)
      AND NOT (r.id = ANY(v_request_ids))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_request_ledger_incomplete');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_prize_payment_requests r
    WHERE r.id = ANY(v_request_ids)
      AND r.payment_id IS NOT NULL
      AND NOT (r.payment_id = ANY(v_payment_ids))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_payment_ledger_incomplete');
  END IF;
  IF (
    SELECT count(*)
    FROM public.tournament_prize_payments p
    WHERE p.id = ANY(v_payment_ids)
      AND p.tournament_id = p_tournament_id
      AND p.paid_by = ANY(v_user_ids)
  ) <> cardinality(v_payment_ids) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_payment_ownership_mismatch');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_prize_payments p
    WHERE p.tournament_id = p_tournament_id
      AND p.paid_by = ANY(v_user_ids)
      AND NOT (p.id = ANY(v_payment_ids))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_payment_ledger_incomplete');
  END IF;
  SELECT count(*)
  INTO v_expected_grant_count
  FROM public.club_floor_payout_request_grants g
  WHERE g.club_id = v_tournament.club_id
    AND g.floor_user_id = ANY(v_grant_user_ids);
  IF (
    SELECT count(*)
    FROM public.tournament_prize_payment_request_events e
    WHERE e.id = ANY(v_grant_event_ids)
      AND e.request_id IS NULL
      AND e.club_id = v_tournament.club_id
      AND e.floor_user_id = ANY(v_grant_user_ids)
      AND e.actor_id = ANY(v_user_ids)
      AND e.event_type IN ('grant_added', 'grant_removed')
  ) <> cardinality(v_grant_event_ids) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_grant_event_ownership_mismatch');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_prize_payment_request_events e
    WHERE e.request_id IS NULL
      AND e.club_id = v_tournament.club_id
      AND e.floor_user_id = ANY(v_grant_user_ids)
      AND e.event_type IN ('grant_added', 'grant_removed')
      AND NOT (e.id = ANY(v_grant_event_ids))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cleanup_grant_event_ledger_incomplete');
  END IF;

  PERFORM set_config('vinpoker.fixture_cleanup', 'confirmed', true);

  DELETE FROM public.tournament_prize_payment_request_events e
  WHERE e.request_id = ANY(v_request_ids)
     OR e.id = ANY(v_grant_event_ids);
  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  DELETE FROM public.tournament_prize_payment_requests r
  WHERE r.id = ANY(v_request_ids);
  GET DIAGNOSTICS v_request_count = ROW_COUNT;

  DELETE FROM public.tournament_prize_payments p
  WHERE p.id = ANY(v_payment_ids);
  GET DIAGNOSTICS v_payment_count = ROW_COUNT;

  DELETE FROM public.club_floor_payout_request_grants g
  WHERE g.club_id = v_tournament.club_id
    AND g.floor_user_id = ANY(v_grant_user_ids);
  GET DIAGNOSTICS v_grant_count = ROW_COUNT;

  IF v_request_count <> cardinality(v_request_ids)
    OR v_payment_count <> cardinality(v_payment_ids)
    OR v_grant_count <> v_expected_grant_count
  THEN
    RAISE EXCEPTION 'fixture_cleanup_count_mismatch';
  END IF;

  PERFORM set_config('vinpoker.fixture_cleanup', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'deletedEvents', v_event_count,
    'deletedRequests', v_request_count,
    'deletedPayments', v_payment_count,
    'deletedGrants', v_grant_count,
    'remainingRequests', (
      SELECT count(*)
      FROM public.tournament_prize_payment_requests
      WHERE id = ANY(v_request_ids)
    ),
    'remainingPayments', (
      SELECT count(*)
      FROM public.tournament_prize_payments
      WHERE id = ANY(v_payment_ids)
    ),
    'remainingGrants', (
      SELECT count(*)
      FROM public.club_floor_payout_request_grants
      WHERE club_id = v_tournament.club_id
        AND floor_user_id = ANY(v_grant_user_ids)
    )
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('vinpoker.fixture_cleanup', '', true);
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_floor_payout_requestable_places(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_places jsonb;
  v_integrity_errors jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT club_id INTO v_club_id
  FROM public.tournaments
  WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.club_floors cf
    JOIN public.club_floor_payout_request_grants g
      ON g.club_id = cf.club_id AND g.floor_user_id = cf.user_id
    WHERE cf.club_id = v_club_id
      AND cf.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'floor_payout_grant_required');
  END IF;

  WITH positions AS (
    SELECT DISTINCT position
    FROM public.tournament_prizes
    WHERE tournament_id = p_tournament_id
  ),
  snapshots AS (
    SELECT
      pos.position,
      vinpoker_private.read_prize_snapshot(p_tournament_id, pos.position) AS snapshot
    FROM positions pos
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'finishedPlace', s.position,
      'entryId', s.snapshot ->> 'entryId',
      'recipientRef', s.snapshot ->> 'recipientRef',
      'recipientName', s.snapshot ->> 'recipientName',
      'prizeId', s.snapshot ->> 'prizeId',
      'prizeAmount', (s.snapshot ->> 'prizeAmount')::numeric,
      'fingerprint', s.snapshot ->> 'fingerprint',
      'isPaid', pp.id IS NOT NULL,
      'paymentId', pp.id,
      'pendingRequestId', r.id,
      'pendingRequestedByMe', r.requested_by = v_actor,
      'canRequest', pp.id IS NULL AND r.id IS NULL
    ) ORDER BY s.position), '[]'::jsonb)
  INTO v_places
  FROM snapshots s
  LEFT JOIN public.tournament_prize_payments pp
    ON pp.tournament_id = p_tournament_id
   AND pp.finished_place = s.position
   AND pp.status = 'paid'
  LEFT JOIN public.tournament_prize_payment_requests r
    ON r.tournament_id = p_tournament_id
   AND r.finished_place = s.position
   AND r.status = 'pending'
  WHERE COALESCE((s.snapshot ->> 'ok')::boolean, false);

  WITH positions AS (
    SELECT DISTINCT position
    FROM public.tournament_prizes
    WHERE tournament_id = p_tournament_id
  ),
  snapshots AS (
    SELECT
      pos.position,
      vinpoker_private.read_prize_snapshot(p_tournament_id, pos.position) AS snapshot
    FROM positions pos
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'finishedPlace', position,
    'error', snapshot ->> 'error'
  ) ORDER BY position), '[]'::jsonb)
  INTO v_integrity_errors
  FROM snapshots
  WHERE COALESCE((snapshot ->> 'ok')::boolean, false) IS NOT TRUE;

  RETURN jsonb_build_object(
    'ok', true,
    'tournamentId', p_tournament_id,
    'places', v_places,
    'integrityErrors', v_integrity_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_tournament_prize_payment_request(
  p_tournament_id uuid,
  p_finished_place integer,
  p_method text,
  p_notes text,
  p_idempotency_key text,
  p_expected_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament record;
  v_existing public.tournament_prize_payment_requests;
  v_pending public.tournament_prize_payment_requests;
  v_snapshot jsonb;
  v_payment_id uuid;
  v_request public.tournament_prize_payment_requests;
  v_notes text := NULLIF(btrim(p_notes), '');
  v_key text := btrim(p_idempotency_key);
  v_expected_fingerprint text := lower(btrim(p_expected_fingerprint));
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_finished_place IS NULL OR p_finished_place <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_finished_place');
  END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash', 'bank', 'app', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  END IF;
  IF v_key IS NULL OR length(v_key) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  END IF;
  IF v_expected_fingerprint IS NULL
    OR v_expected_fingerprint !~ '^[0-9a-f]{32}$'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_expected_fingerprint');
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'notes_too_long');
  END IF;

  SELECT id, club_id
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.club_floors cf
    JOIN public.club_floor_payout_request_grants g
      ON g.club_id = cf.club_id AND g.floor_user_id = cf.user_id
    WHERE cf.club_id = v_tournament.club_id
      AND cf.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'floor_payout_grant_required');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.tournament_prize_payment_requests
  WHERE requested_by = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.tournament_id IS DISTINCT FROM p_tournament_id
      OR v_existing.finished_place IS DISTINCT FROM p_finished_place
      OR v_existing.method IS DISTINCT FROM p_method
      OR v_existing.notes IS DISTINCT FROM v_notes
      OR v_existing.snapshot_fingerprint IS DISTINCT FROM v_expected_fingerprint
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_conflict');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'idempotent',
      'requestId', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  SELECT *
  INTO v_pending
  FROM public.tournament_prize_payment_requests
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place
    AND status = 'pending'
  ORDER BY id
  LIMIT 1
  FOR UPDATE;
  IF v_pending.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'pending_request_exists',
      'requestId', v_pending.id
    );
  END IF;

  v_snapshot := vinpoker_private.resolve_prize_snapshot_locked(
    p_tournament_id,
    p_finished_place
  );
  IF COALESCE((v_snapshot ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', COALESCE(v_snapshot ->> 'error', 'snapshot_unavailable')
    );
  END IF;
  IF v_snapshot ->> 'fingerprint' IS DISTINCT FROM v_expected_fingerprint THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'snapshot_changed',
      'currentFingerprint', v_snapshot ->> 'fingerprint'
    );
  END IF;

  SELECT id
  INTO v_payment_id
  FROM public.tournament_prize_payments
  WHERE tournament_id = p_tournament_id
    AND finished_place = p_finished_place
    AND status = 'paid'
  ORDER BY id
  LIMIT 1
  FOR UPDATE;
  IF v_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'already_paid',
      'paymentId', v_payment_id
    );
  END IF;

  BEGIN
    INSERT INTO public.tournament_prize_payment_requests (
      club_id, tournament_id, finished_place, requested_by,
      method, notes,
      snapshot_entry_id, snapshot_recipient_ref, snapshot_recipient_name,
      snapshot_prize_id, snapshot_prize_amount, snapshot_fingerprint,
      idempotency_key
    )
    VALUES (
      v_tournament.club_id,
      p_tournament_id,
      p_finished_place,
      v_actor,
      p_method,
      v_notes,
      (v_snapshot ->> 'entryId')::uuid,
      NULLIF(v_snapshot ->> 'recipientRef', '')::uuid,
      NULLIF(v_snapshot ->> 'recipientName', ''),
      (v_snapshot ->> 'prizeId')::uuid,
      (v_snapshot ->> 'prizeAmount')::numeric,
      v_snapshot ->> 'fingerprint',
      v_key
    )
    RETURNING * INTO v_request;
  EXCEPTION WHEN unique_violation THEN
    SELECT *
    INTO v_existing
    FROM public.tournament_prize_payment_requests
    WHERE requested_by = v_actor
      AND idempotency_key = v_key;
    IF v_existing.id IS NOT NULL
      AND v_existing.tournament_id = p_tournament_id
      AND v_existing.finished_place = p_finished_place
      AND v_existing.method IS NOT DISTINCT FROM p_method
      AND v_existing.notes IS NOT DISTINCT FROM v_notes
      AND v_existing.snapshot_fingerprint = v_expected_fingerprint
    THEN
      RETURN jsonb_build_object(
        'ok', true,
        'outcome', 'idempotent',
        'requestId', v_existing.id,
        'status', v_existing.status
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'request_conflict');
  END;

  PERFORM vinpoker_private.append_payout_request_event(
    v_request.id,
    v_request.club_id,
    v_request.requested_by,
    'created',
    v_actor,
    jsonb_build_object(
      'finishedPlace', v_request.finished_place,
      'snapshotFingerprint', v_request.snapshot_fingerprint
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'created',
    'requestId', v_request.id,
    'status', v_request.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_tournament_prize_payment_request(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_request public.tournament_prize_payment_requests;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT tournament_id INTO v_tournament_id
  FROM public.tournament_prize_payment_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  PERFORM id FROM public.tournaments
  WHERE id = v_tournament_id
  FOR UPDATE;

  SELECT *
  INTO v_request
  FROM public.tournament_prize_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.requested_by IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_request.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'idempotent', 'status', 'cancelled');
  ELSIF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_pending', 'status', v_request.status);
  END IF;

  UPDATE public.tournament_prize_payment_requests
  SET status = 'cancelled',
      reviewed_by = v_actor,
      reviewed_at = now(),
      decision_reason = 'cancelled_by_requester'
  WHERE id = p_request_id;
  PERFORM vinpoker_private.append_payout_request_event(
    p_request_id, v_request.club_id, v_request.requested_by,
    'cancelled', v_actor, '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'outcome', 'cancelled', 'status', 'cancelled');
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tournament_prize_payment_requests(
  p_club_id uuid,
  p_status text DEFAULT 'pending'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_can_review boolean := false;
  v_is_floor boolean := false;
  v_rows jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN (
    'pending', 'approved', 'rejected', 'cancelled', 'stale', 'superseded'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request_status');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.clubs c
    LEFT JOIN public.club_cashiers cc
      ON cc.club_id = c.id AND cc.user_id = v_actor
    WHERE c.id = p_club_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_can_review;
  SELECT EXISTS (
    SELECT 1 FROM public.club_floors
    WHERE club_id = p_club_id AND user_id = v_actor
  ) INTO v_is_floor;
  IF NOT v_can_review AND NOT v_is_floor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  WITH scoped AS (
    SELECT r.*
    FROM public.tournament_prize_payment_requests r
    WHERE r.club_id = p_club_id
      AND (p_status IS NULL OR r.status = p_status)
      AND (v_can_review OR r.requested_by = v_actor)
  ),
  with_current AS (
    SELECT
      r.*,
      vinpoker_private.read_prize_snapshot(r.tournament_id, r.finished_place) AS current_snapshot,
      p.display_name AS requester_name,
      t.name AS tournament_name
    FROM scoped r
    JOIN public.tournaments t ON t.id = r.tournament_id
    LEFT JOIN public.profiles p ON p.user_id = r.requested_by
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'clubId', club_id,
    'tournamentId', tournament_id,
    'tournamentName', tournament_name,
    'finishedPlace', finished_place,
    'requestedBy', requested_by,
    'requesterName', COALESCE(requester_name, 'Floor ' || left(requested_by::text, 8)),
    'method', method,
    'notes', notes,
    'recipientName', snapshot_recipient_name,
    'prizeAmount', snapshot_prize_amount,
    'snapshotFingerprint', snapshot_fingerprint,
    'currentFingerprint', current_snapshot ->> 'fingerprint',
    'snapshotMatches', COALESCE((current_snapshot ->> 'ok')::boolean, false)
      AND (current_snapshot ->> 'fingerprint') = snapshot_fingerprint,
    'currentRecipientName', current_snapshot ->> 'recipientName',
    'currentPrizeAmount', NULLIF(current_snapshot ->> 'prizeAmount', '')::numeric,
    'status', status,
    'reviewedBy', reviewed_by,
    'reviewedAt', reviewed_at,
    'decisionReason', decision_reason,
    'paymentId', payment_id,
    'createdAt', created_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM with_current;

  RETURN jsonb_build_object(
    'ok', true,
    'clubId', p_club_id,
    'canReview', v_can_review,
    'requests', v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_tournament_prize_payment_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_request public.tournament_prize_payment_requests;
  v_authorized boolean;
  v_owner uuid;
  v_note text := NULLIF(btrim(p_review_note), '');
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'review_note_too_long');
  END IF;

  SELECT tournament_id INTO v_tournament_id
  FROM public.tournament_prize_payment_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Lock order starts with tournament, then the request.
  PERFORM id FROM public.tournaments
  WHERE id = v_tournament_id
  FOR UPDATE;
  SELECT *
  INTO v_request
  FROM public.tournament_prize_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  -- Lock reviewer capability before the Floor grant. Grant management uses
  -- the same club -> grant order, so revoke-vs-approve cannot deadlock.
  SELECT owner_id
  INTO v_owner
  FROM public.clubs
  WHERE id = v_request.club_id
  FOR SHARE;
  v_authorized := v_owner = v_actor;
  IF NOT v_authorized THEN
    PERFORM 1
    FROM public.club_cashiers
    WHERE club_id = v_request.club_id
      AND user_id = v_actor
    FOR KEY SHARE;
    v_authorized := FOUND;
  END IF;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_request.requested_by = v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reviewer_must_differ');
  END IF;
  IF v_request.status = 'superseded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'already_paid',
      'status', 'superseded',
      'paymentId', v_request.payment_id
    );
  ELSIF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'idempotent',
      'status', v_request.status,
      'paymentId', v_request.payment_id
    );
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.tournament_prize_payment_requests
    SET status = 'rejected',
        reviewed_by = v_actor,
        reviewed_at = now(),
        decision_reason = COALESCE(v_note, 'rejected')
    WHERE id = p_request_id;
    PERFORM vinpoker_private.append_payout_request_event(
      p_request_id, v_request.club_id, v_request.requested_by,
      'rejected', v_actor, jsonb_build_object('note', v_note)
    );
    RETURN jsonb_build_object('ok', true, 'outcome', 'rejected', 'status', 'rejected');
  END IF;

  -- Lock the literal Floor membership and grant through ledger commit. A
  -- concurrent revoke/delete must therefore linearize before this check
  -- (approval becomes stale) or after the approved ledger write.
  PERFORM 1
    FROM public.club_floors cf
    JOIN public.club_floor_payout_request_grants g
      ON g.club_id = cf.club_id AND g.floor_user_id = cf.user_id
    WHERE cf.club_id = v_request.club_id
      AND cf.user_id = v_request.requested_by
    FOR KEY SHARE OF cf, g;
  IF NOT FOUND THEN
    UPDATE public.tournament_prize_payment_requests
    SET status = 'stale',
        reviewed_by = v_actor,
        reviewed_at = now(),
        decision_reason = 'grant_or_membership_revoked'
    WHERE id = p_request_id;
    PERFORM vinpoker_private.append_payout_request_event(
      p_request_id, v_request.club_id, v_request.requested_by,
      'stale', v_actor, jsonb_build_object('reason', 'grant_or_membership_revoked')
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'grant_or_membership_revoked',
      'outcome', 'stale'
    );
  END IF;

  RETURN vinpoker_private.record_prize_payment_internal(
    v_request.tournament_id,
    v_request.finished_place,
    v_actor,
    v_request.method,
    NULL,
    v_note,
    v_request.id,
    v_request.snapshot_fingerprint
  );
END;
$function$;

-- Preserve the existing direct owner/cashier signature and response contract,
-- but route its write through the same private ledger writer. Direct recording
-- supersedes a pending Floor request for the same place.
CREATE OR REPLACE FUNCTION public.record_tournament_prize_payment(
  p_tournament_id uuid,
  p_finished_place integer,
  p_method text DEFAULT NULL,
  p_proof_url text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_authorized boolean;
  v_owner uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT club_id
  INTO v_club_id
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT owner_id
  INTO v_owner
  FROM public.clubs
  WHERE id = v_club_id
  FOR SHARE;
  v_authorized := v_owner = v_actor;
  IF NOT v_authorized THEN
    PERFORM 1
    FROM public.club_cashiers
    WHERE club_id = v_club_id
      AND user_id = v_actor
    FOR KEY SHARE;
    v_authorized := FOUND;
  END IF;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  RETURN vinpoker_private.record_prize_payment_internal(
    p_tournament_id,
    p_finished_place,
    v_actor,
    p_method,
    p_proof_url,
    p_notes,
    NULL,
    NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_floor_payout_request_grant(uuid, uuid, boolean)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_floor_payout_request_grants(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cleanup_floor_payout_request_fixture(
  uuid, uuid[], uuid[], uuid[], uuid[], uuid[]
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_floor_payout_requestable_places(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_tournament_prize_payment_request(uuid, integer, text, text, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cancel_tournament_prize_payment_request(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_tournament_prize_payment_requests(uuid, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.review_tournament_prize_payment_request(uuid, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.record_tournament_prize_payment(uuid, integer, text, text, text)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.set_floor_payout_request_grant(uuid, uuid, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_floor_payout_request_grants(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_floor_payout_request_fixture(
  uuid, uuid[], uuid[], uuid[], uuid[], uuid[]
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_payout_requestable_places(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tournament_prize_payment_request(uuid, integer, text, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_tournament_prize_payment_request(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tournament_prize_payment_requests(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tournament_prize_payment_request(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_tournament_prize_payment(uuid, integer, text, text, text)
  TO authenticated;
