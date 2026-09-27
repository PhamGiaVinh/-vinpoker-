-- Atomic Satellite award Lock. SOURCE ONLY, dependent on cutoff/entry fences.
-- The plan row itself is the immutable request receipt and source snapshot.
-- Ticket Issue remains blocked by satellite_preview_write_hold_v1.
-- ROLLBACK: revoke this RPC and restore the award-plan write hold in a forward
-- migration; never discard a populated plan or its source evidence.
ALTER TABLE public.satellite_award_plans
  ADD COLUMN IF NOT EXISTS lock_request_id uuid,
  ADD COLUMN IF NOT EXISTS lock_request_hash text,
  ADD COLUMN IF NOT EXISTS source_preview_revision text,
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source_pool_vnd bigint,
  ADD COLUMN IF NOT EXISTS source_fee_vnd bigint,
  ADD COLUMN IF NOT EXISTS obligation_shortfall_vnd bigint,
  ADD COLUMN IF NOT EXISTS funding_state text;
CREATE UNIQUE INDEX IF NOT EXISTS satellite_award_lock_request_v1
  ON public.satellite_award_plans(lock_request_id) WHERE lock_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.satellite_verified_award_plan_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source public.tournaments%ROWTYPE;
  v_preview jsonb;
BEGIN
  IF TG_OP='DELETE' OR TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'satellite_verified_plan_immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_source FROM public.tournaments
    WHERE id=NEW.source_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_source.operations_mode IS DISTINCT FROM 'satellite'
     OR v_source.club_id IS DISTINCT FROM NEW.club_id
     OR v_source.registration_closed_at IS NULL
     OR v_source.satellite_cutoff_fenced_at IS NULL
     OR v_source.status::text IN ('cancelled','completed','finished')
     OR EXISTS (SELECT 1 FROM public.tournament_close_report r
                WHERE r.tournament_id=NEW.source_tournament_id) THEN
    RAISE EXCEPTION 'satellite_lock_source_not_closed_or_result_locked'
      USING ERRCODE='23514';
  END IF;
  IF auth.uid() IS NULL OR NEW.locked_by IS DISTINCT FROM auth.uid()
     OR NEW.lock_request_id IS NULL
     OR NEW.lock_request_hash !~ '^[0-9a-f]{32}$'
     OR NEW.source_preview_revision !~ '^v2:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'satellite_lock_receipt_invalid' USING ERRCODE='23514';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(NEW.club_id);
  v_preview := public.satellite_source_funding_preview_v2(
    NEW.source_tournament_id,NEW.target_tournament_id,NEW.award_lines);
  IF v_preview->>'state' IS DISTINCT FROM 'READY'
     OR v_preview->>'previewRevision' IS DISTINCT FROM NEW.source_preview_revision
     OR v_preview IS DISTINCT FROM NEW.source_snapshot
     OR (v_preview->>'sourcePoolVnd')::bigint IS DISTINCT FROM NEW.source_pool_vnd
     OR (v_preview->>'feeVnd')::bigint IS DISTINCT FROM NEW.source_fee_vnd
     OR (v_preview->>'obligationShortfallVnd')::bigint
        IS DISTINCT FROM NEW.obligation_shortfall_vnd
     OR v_preview->>'fundingState' IS DISTINCT FROM NEW.funding_state
     OR (v_preview->'awardPlan'->>'totalLiabilityVnd')::bigint
        IS DISTINCT FROM NEW.total_liability_vnd THEN
    RAISE EXCEPTION 'satellite_lock_source_or_payload_changed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_verified_award_plan_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_preview_write_hold_v1 ON public.satellite_award_plans;
DROP TRIGGER IF EXISTS satellite_verified_award_plan_guard_v1 ON public.satellite_award_plans;
CREATE TRIGGER satellite_verified_award_plan_guard_v1
  BEFORE INSERT OR UPDATE OR DELETE ON public.satellite_award_plans
  FOR EACH ROW EXECUTE FUNCTION private.satellite_verified_award_plan_guard_v1();

CREATE OR REPLACE FUNCTION public.satellite_lock_award_plan_v1(
  p_source_tournament_id uuid,
  p_target_tournament_id uuid,
  p_awards jsonb,
  p_expected_preview_revision text,
  p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_source public.tournaments%ROWTYPE;
  v_plan public.satellite_award_plans%ROWTYPE;
  v_preview jsonb;
  v_award jsonb;
  v_hash text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_source_tournament_id IS NULL
     OR p_target_tournament_id IS NULL OR p_awards IS NULL
     OR p_expected_preview_revision !~ '^v2:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'satellite_lock_request_invalid' USING ERRCODE='22023';
  END IF;
  v_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source',p_source_tournament_id,'target',p_target_tournament_id,
    'awards',p_awards,'revision',p_expected_preview_revision)::text);
  -- Same ordering as the read-only preview and legacy award RPC. Cashier
  -- registration-first writers never need a registration lock from this RPC.
  FOR v_id IN SELECT t.id FROM public.tournaments t
    WHERE t.id IN (p_source_tournament_id,p_target_tournament_id) ORDER BY t.id
  LOOP
    PERFORM 1 FROM public.tournaments t WHERE t.id=v_id FOR UPDATE;
  END LOOP;
  SELECT * INTO v_source FROM public.tournaments WHERE id=p_source_tournament_id;
  IF NOT FOUND OR v_source.operations_mode IS DISTINCT FROM 'satellite' THEN
    RAISE EXCEPTION 'satellite_tournament_scope_invalid' USING ERRCODE='22023';
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.clubs c
                  WHERE c.id=v_source.club_id AND c.owner_id=v_actor)
          OR public.is_club_floor(v_actor,v_source.club_id)
          OR public.has_role(v_actor,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id=p_source_tournament_id;
  IF FOUND THEN
    IF v_plan.lock_request_id IS DISTINCT FROM p_request_id
       OR v_plan.lock_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'satellite_lock_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'locked',true,'idempotent',true,
      'sourceTournamentId',v_plan.source_tournament_id,
      'previewRevision',v_plan.source_preview_revision,
      'sourcePoolVnd',v_plan.source_pool_vnd::text,
      'feeVnd',v_plan.source_fee_vnd::text,
      'obligationShortfallVnd',v_plan.obligation_shortfall_vnd::text,
      'fundingState',v_plan.funding_state);
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_source.club_id);
  IF v_source.registration_closed_at IS NULL
     OR v_source.satellite_cutoff_fenced_at IS NULL THEN
    RAISE EXCEPTION 'satellite_lock_registration_open' USING ERRCODE='23514';
  END IF;
  v_preview := public.satellite_source_funding_preview_v2(
    p_source_tournament_id,p_target_tournament_id,p_awards);
  IF v_preview->>'previewRevision' IS DISTINCT FROM p_expected_preview_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'locked',false,
      'error','stale_preview','currentPreviewRevision',v_preview->>'previewRevision');
  END IF;
  IF v_preview->>'state' IS DISTINCT FROM 'READY' THEN
    RAISE EXCEPTION 'satellite_lock_source_not_ready' USING ERRCODE='23514';
  END IF;
  v_award := v_preview->'awardPlan';
  INSERT INTO public.satellite_award_plans(
    source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
    award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by,
    lock_request_id,lock_request_hash,source_preview_revision,source_snapshot,
    source_pool_vnd,source_fee_vnd,obligation_shortfall_vnd,funding_state)
  VALUES (p_source_tournament_id,p_target_tournament_id,v_source.club_id,
    (v_award->>'targetEntryPriceVnd')::bigint,v_award->'awardLines',
    (v_award->>'ticketTotal')::integer,(v_award->>'cashTotalVnd')::bigint,
    (v_award->>'totalLiabilityVnd')::bigint,v_actor,
    p_request_id,v_hash,p_expected_preview_revision,v_preview,
    (v_preview->>'sourcePoolVnd')::bigint,(v_preview->>'feeVnd')::bigint,
    (v_preview->>'obligationShortfallVnd')::bigint,v_preview->>'fundingState');
  RETURN pg_catalog.jsonb_build_object('ok',true,'locked',true,'idempotent',false,
    'sourceTournamentId',p_source_tournament_id,
    'previewRevision',p_expected_preview_revision,
    'sourcePoolVnd',v_preview->>'sourcePoolVnd',
    'feeVnd',v_preview->>'feeVnd',
    'obligationShortfallVnd',v_preview->>'obligationShortfallVnd',
    'fundingState',v_preview->>'fundingState');
END $$;
REVOKE ALL ON FUNCTION public.satellite_lock_award_plan_v1(uuid,uuid,jsonb,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_lock_award_plan_v1(uuid,uuid,jsonb,text,uuid)
  TO authenticated;
