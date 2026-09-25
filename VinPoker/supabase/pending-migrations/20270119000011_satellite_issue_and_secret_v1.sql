-- Forward-only Satellite Issue and current-secret lifecycle. SOURCE ONLY.
-- Issue requires a reconciled, fully funded locked plan and known frozen
-- components. Redemption remains unavailable until a separate atomic voucher
-- transfer path is verified. ROLLBACK: revoke the RPCs and restore the issue
-- and ticket write holds in a forward migration; retain all audit history.

ALTER TABLE public.satellite_award_issues
  ADD COLUMN IF NOT EXISTS issue_request_id uuid,
  ADD COLUMN IF NOT EXISTS issue_request_hash text,
  ADD COLUMN IF NOT EXISTS source_preview_revision text;
CREATE UNIQUE INDEX IF NOT EXISTS satellite_issue_request_unique_v1
  ON public.satellite_award_issues(issue_request_id)
  WHERE issue_request_id IS NOT NULL;

-- Preserve exact target fee components at Lock, not at Issue/Redeem. A plan
-- already locked before this migration has NULL detail and cannot Issue.
ALTER TABLE public.satellite_award_plans
  ADD COLUMN IF NOT EXISTS target_rake_vnd bigint,
  ADD COLUMN IF NOT EXISTS target_service_fee_vnd bigint;
ALTER TABLE public.satellite_tickets
  ADD COLUMN IF NOT EXISTS target_rake_vnd bigint,
  ADD COLUMN IF NOT EXISTS target_service_fee_vnd bigint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.satellite_award_plans'::pg_catalog.regclass
      AND conname='satellite_plan_fee_detail_v1') THEN
    ALTER TABLE public.satellite_award_plans
      ADD CONSTRAINT satellite_plan_fee_detail_v1 CHECK (
        (target_rake_vnd IS NULL AND target_service_fee_vnd IS NULL)
        OR (target_rake_vnd >= 0 AND target_service_fee_vnd >= 0
            AND target_rake_vnd::numeric + target_service_fee_vnd::numeric = target_fee_vnd)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.satellite_tickets'::pg_catalog.regclass
      AND conname='satellite_ticket_fee_detail_v1') THEN
    ALTER TABLE public.satellite_tickets
      ADD CONSTRAINT satellite_ticket_fee_detail_v1 CHECK (
        (target_rake_vnd IS NULL AND target_service_fee_vnd IS NULL)
        OR (target_rake_vnd >= 0 AND target_service_fee_vnd >= 0
            AND target_rake_vnd::numeric + target_service_fee_vnd::numeric = target_fee_vnd)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.satellite_capture_target_fee_detail_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_target public.tournaments%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM public.tournaments
    WHERE id=NEW.target_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_target.rake_amount IS NULL OR v_target.service_fee_amount IS NULL
     OR v_target.rake_amount < 0 OR v_target.service_fee_amount < 0
     OR v_target.rake_amount::numeric <> pg_catalog.trunc(v_target.rake_amount::numeric)
     OR v_target.service_fee_amount::numeric <> pg_catalog.trunc(v_target.service_fee_amount::numeric)
     OR v_target.rake_amount::numeric + v_target.service_fee_amount::numeric
        IS DISTINCT FROM NEW.target_fee_vnd::numeric THEN
    RAISE EXCEPTION 'satellite_target_fee_detail_invalid' USING ERRCODE='23514';
  END IF;
  NEW.target_rake_vnd := v_target.rake_amount;
  NEW.target_service_fee_vnd := v_target.service_fee_amount;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_capture_target_fee_detail_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_capture_target_fee_detail_v1
  ON public.satellite_award_plans;
CREATE TRIGGER satellite_capture_target_fee_detail_v1 BEFORE INSERT
  ON public.satellite_award_plans FOR EACH ROW
  EXECUTE FUNCTION private.satellite_capture_target_fee_detail_v1();

CREATE OR REPLACE FUNCTION private.satellite_copy_ticket_fee_detail_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan public.satellite_award_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id=NEW.source_tournament_id;
  IF NOT FOUND OR v_plan.target_rake_vnd IS NULL
     OR v_plan.target_service_fee_vnd IS NULL THEN
    RAISE EXCEPTION 'satellite_ticket_fee_detail_required' USING ERRCODE='23514';
  END IF;
  NEW.target_rake_vnd := v_plan.target_rake_vnd;
  NEW.target_service_fee_vnd := v_plan.target_service_fee_vnd;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_copy_ticket_fee_detail_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_copy_ticket_fee_detail_v1 ON public.satellite_tickets;
CREATE TRIGGER satellite_copy_ticket_fee_detail_v1 BEFORE INSERT
  ON public.satellite_tickets FOR EACH ROW
  EXECUTE FUNCTION private.satellite_copy_ticket_fee_detail_v1();

CREATE OR REPLACE FUNCTION private.satellite_ticket_fee_detail_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.target_rake_vnd,NEW.target_service_fee_vnd)
     IS DISTINCT FROM ROW(OLD.target_rake_vnd,OLD.target_service_fee_vnd) THEN
    RAISE EXCEPTION 'satellite_ticket_fee_detail_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_ticket_fee_detail_immutable_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_ticket_fee_detail_immutable_v1 BEFORE UPDATE
  ON public.satellite_tickets FOR EACH ROW
  EXECUTE FUNCTION private.satellite_ticket_fee_detail_immutable_v1();

CREATE OR REPLACE FUNCTION private.satellite_verified_issue_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan public.satellite_award_plans%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'satellite_issue_immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id=NEW.source_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_plan.club_id IS DISTINCT FROM NEW.club_id
     OR v_plan.target_buy_in_vnd IS NULL OR v_plan.target_fee_vnd IS NULL
     OR v_plan.target_rake_vnd IS NULL OR v_plan.target_service_fee_vnd IS NULL
     OR v_plan.obligation_shortfall_vnd IS DISTINCT FROM 0
     OR v_plan.funding_state IS DISTINCT FROM 'NO_SHORTFALL'
     OR v_plan.source_preview_revision IS NULL
     OR NEW.ticket_total IS DISTINCT FROM v_plan.ticket_total
     OR NEW.cash_total_vnd IS DISTINCT FROM v_plan.cash_total_vnd
     OR NEW.source_preview_revision IS DISTINCT FROM v_plan.source_preview_revision
     OR NEW.issued_by IS DISTINCT FROM auth.uid()
     OR NEW.issue_request_id IS NULL
     OR NEW.issue_request_hash !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'satellite_verified_issue_required' USING ERRCODE='23514';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(NEW.club_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_verified_issue_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_preview_write_hold_v1 ON public.satellite_award_issues;
CREATE TRIGGER satellite_verified_issue_guard_v1
  BEFORE INSERT OR UPDATE OR DELETE ON public.satellite_award_issues
  FOR EACH ROW EXECUTE FUNCTION private.satellite_verified_issue_guard_v1();

-- The existing v1 procedure validates result rank/player uniqueness, club,
-- closed results, planned quantities and serials. Only this wrapper may call
-- it after the write guard above requires a funded plan and request receipt.
REVOKE ALL ON FUNCTION public.satellite_issue_tickets_v1(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.satellite_issue_tickets_v2(
  p_source_tournament_id uuid,p_results jsonb,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.satellite_award_plans%ROWTYPE;
  v_issue public.satellite_award_issues%ROWTYPE;
  v_target_id uuid;
  v_id uuid;
  v_hash text;
  v_response jsonb;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_source_tournament_id IS NULL
     OR pg_catalog.jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'satellite_issue_request_invalid' USING ERRCODE='22023';
  END IF;
  v_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source',p_source_tournament_id,'results',p_results)::text);
  SELECT target_tournament_id INTO v_target_id FROM public.satellite_award_plans
    WHERE source_tournament_id=p_source_tournament_id;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'satellite_plan_not_locked' USING ERRCODE='22023';
  END IF;
  FOR v_id IN SELECT t.id FROM public.tournaments t
    WHERE t.id IN (p_source_tournament_id,v_target_id) ORDER BY t.id LOOP
    PERFORM 1 FROM public.tournaments t WHERE t.id=v_id FOR UPDATE;
  END LOOP;
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id=p_source_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'satellite_plan_not_locked' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_issue FROM public.satellite_award_issues
    WHERE source_tournament_id=p_source_tournament_id;
  IF FOUND THEN
    IF v_issue.issued_by IS DISTINCT FROM v_actor
       OR v_issue.issue_request_id IS DISTINCT FROM p_request_id
       OR v_issue.issue_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'satellite_issue_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN public.satellite_get_issuance_v1(p_source_tournament_id)
      || pg_catalog.jsonb_build_object('idempotent',true);
  END IF;
  -- v1 inserts the issue before its tickets. A transaction-local request
  -- marker lets the independent table guard store the immutable receipt.
  PERFORM pg_catalog.set_config('app.satellite_issue_request_id',p_request_id::text,true);
  PERFORM pg_catalog.set_config('app.satellite_issue_request_hash',v_hash,true);
  PERFORM pg_catalog.set_config('app.satellite_issue_revision',
    v_plan.source_preview_revision,true);
  v_response := public.satellite_issue_tickets_v1(p_source_tournament_id,p_results);
  RETURN v_response || pg_catalog.jsonb_build_object('idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.satellite_issue_tickets_v2(uuid,jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_issue_tickets_v2(uuid,jsonb,uuid)
  TO authenticated;

-- The old v1 INSERT omits the new receipt columns. Fill them only while the
-- privileged wrapper is executing; ordinary browser roles cannot write this
-- table and a direct v1 call is revoked.
CREATE OR REPLACE FUNCTION private.satellite_issue_receipt_fill_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.issue_request_id := nullif(
    pg_catalog.current_setting('app.satellite_issue_request_id',true),'')::uuid;
  NEW.issue_request_hash := nullif(
    pg_catalog.current_setting('app.satellite_issue_request_hash',true),'');
  NEW.source_preview_revision := nullif(
    pg_catalog.current_setting('app.satellite_issue_revision',true),'');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_issue_receipt_fill_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_issue_receipt_fill_v1 BEFORE INSERT
  ON public.satellite_award_issues FOR EACH ROW
  EXECUTE FUNCTION private.satellite_issue_receipt_fill_v1();

CREATE TABLE IF NOT EXISTS public.satellite_ticket_secret_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.satellite_tickets(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{32}$'),
  action text NOT NULL CHECK (action IN ('rotate','void')),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  old_code_hash text NOT NULL CHECK (old_code_hash ~ '^[0-9a-f]{32}$'),
  new_code_hash text CHECK (new_code_hash IS NULL OR new_code_hash ~ '^[0-9a-f]{32}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_ticket_event_shape_v1 CHECK (
    (action='rotate' AND new_code_hash IS NOT NULL)
    OR (action='void' AND new_code_hash IS NULL)
  )
);
ALTER TABLE public.satellite_ticket_secret_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_ticket_secret_events
  FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.satellite_ticket_secret_event_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'satellite_ticket_secret_event_immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION private.satellite_ticket_secret_event_immutable_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_ticket_secret_event_immutable_v1
  BEFORE UPDATE OR DELETE ON public.satellite_ticket_secret_events
  FOR EACH ROW EXECUTE FUNCTION private.satellite_ticket_secret_event_immutable_v1();

CREATE OR REPLACE FUNCTION private.satellite_ticket_write_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_issue public.satellite_award_issues%ROWTYPE;
  v_event public.satellite_ticket_secret_events%ROWTYPE;
  v_request uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'satellite_ticket_immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_issue FROM public.satellite_award_issues
      WHERE source_tournament_id=NEW.source_tournament_id;
    IF NOT FOUND OR v_issue.issue_request_id IS NULL
       OR v_issue.issue_request_id::text IS DISTINCT FROM
          pg_catalog.current_setting('app.satellite_issue_request_id',true)
       OR NEW.club_id IS DISTINCT FROM v_issue.club_id
       OR NEW.serial_no > v_issue.ticket_total
       OR NEW.status IS DISTINCT FROM 'issued'
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_issue.locked_results) x(value)
                      WHERE (x.value->>'position')::integer=NEW.award_position
                        AND (x.value->>'playerId')::uuid=NEW.winner_player_id) THEN
      RAISE EXCEPTION 'satellite_verified_ticket_issue_required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  v_request := nullif(
    pg_catalog.current_setting('app.satellite_secret_request_id',true),'')::uuid;
  SELECT * INTO v_event FROM public.satellite_ticket_secret_events
    WHERE request_id=v_request AND ticket_id=OLD.id AND actor_id=auth.uid();
  IF NOT FOUND OR OLD.status IS DISTINCT FROM 'issued'
     OR (pg_catalog.to_jsonb(NEW)-ARRAY['redemption_code','status','voided_at','voided_by','void_reason'])
        IS DISTINCT FROM
        (pg_catalog.to_jsonb(OLD)-ARRAY['redemption_code','status','voided_at','voided_by','void_reason'])
     OR v_event.old_code_hash IS DISTINCT FROM pg_catalog.md5(OLD.redemption_code::text)
     OR (v_event.action='rotate' AND (
          NEW.status IS DISTINCT FROM 'issued' OR NEW.redemption_code=OLD.redemption_code
          OR v_event.new_code_hash IS DISTINCT FROM pg_catalog.md5(NEW.redemption_code::text)
          OR ROW(NEW.voided_at,NEW.voided_by,NEW.void_reason)
             IS DISTINCT FROM ROW(OLD.voided_at,OLD.voided_by,OLD.void_reason)))
     OR (v_event.action='void' AND (
          NEW.status IS DISTINCT FROM 'voided' OR NEW.redemption_code IS DISTINCT FROM OLD.redemption_code
          OR NEW.voided_at IS NULL OR NEW.voided_by IS DISTINCT FROM auth.uid()
          OR NEW.void_reason IS DISTINCT FROM v_event.reason)) THEN
    RAISE EXCEPTION 'satellite_ticket_mutation_not_allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_ticket_write_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_preview_write_hold_v1 ON public.satellite_tickets;
CREATE TRIGGER satellite_ticket_write_guard_v1
  BEFORE INSERT OR UPDATE OR DELETE ON public.satellite_tickets
  FOR EACH ROW EXECUTE FUNCTION private.satellite_ticket_write_guard_v1();

CREATE OR REPLACE FUNCTION public.satellite_change_ticket_secret_v1(
  p_ticket_id uuid,p_current_code uuid,p_action text,p_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.satellite_tickets%ROWTYPE;
  v_event public.satellite_ticket_secret_events%ROWTYPE;
  v_request_hash text;
  v_next_code uuid;
BEGIN
  IF v_actor IS NULL OR p_ticket_id IS NULL OR p_current_code IS NULL
     OR p_request_id IS NULL OR p_action NOT IN ('rotate','void')
     OR length(pg_catalog.btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'satellite_ticket_change_invalid' USING ERRCODE='22023';
  END IF;
  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'ticket',p_ticket_id,'oldCode',p_current_code,
    'action',p_action,'reason',p_reason)::text);
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'satellite_ticket_not_found' USING ERRCODE='22023';
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.clubs c
                  WHERE c.id=v_ticket.club_id AND c.owner_id=v_actor)
          OR public.is_club_floor(v_actor,v_ticket.club_id)
          OR public.has_role(v_actor,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_event FROM public.satellite_ticket_secret_events
    WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_event.ticket_id IS DISTINCT FROM p_ticket_id
       OR v_event.actor_id IS DISTINCT FROM v_actor
       OR v_event.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'satellite_ticket_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotent',true,
      'status',v_ticket.status,
      'currentCode',CASE WHEN v_event.action='rotate'
        AND v_event.new_code_hash=pg_catalog.md5(v_ticket.redemption_code::text)
        THEN v_ticket.redemption_code ELSE NULL END);
  END IF;
  IF v_ticket.status IS DISTINCT FROM 'issued'
     OR v_ticket.redemption_code IS DISTINCT FROM p_current_code THEN
    RAISE EXCEPTION 'satellite_ticket_not_current' USING ERRCODE='23514';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_ticket.club_id);
  v_next_code := CASE WHEN p_action='rotate' THEN gen_random_uuid() ELSE NULL END;
  INSERT INTO public.satellite_ticket_secret_events(
    ticket_id,request_id,request_hash,action,actor_id,old_code_hash,new_code_hash,reason)
  VALUES(p_ticket_id,p_request_id,v_request_hash,p_action,v_actor,
    pg_catalog.md5(p_current_code::text),
    CASE WHEN v_next_code IS NULL THEN NULL ELSE pg_catalog.md5(v_next_code::text) END,
    p_reason);
  PERFORM pg_catalog.set_config('app.satellite_secret_request_id',p_request_id::text,true);
  IF p_action='rotate' THEN
    UPDATE public.satellite_tickets SET redemption_code=v_next_code WHERE id=p_ticket_id;
  ELSE
    UPDATE public.satellite_tickets SET status='voided',voided_at=now(),
      voided_by=v_actor,void_reason=p_reason WHERE id=p_ticket_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'idempotent',false,
    'status',CASE WHEN p_action='rotate' THEN 'issued' ELSE 'voided' END,
    'currentCode',v_next_code);
END $$;
REVOKE ALL ON FUNCTION public.satellite_change_ticket_secret_v1(uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_change_ticket_secret_v1(uuid,uuid,text,text,uuid)
  TO authenticated;
