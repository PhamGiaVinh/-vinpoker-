-- SOURCE ONLY. Forward correction to payout snapshot v1; no live apply.
-- ROLLBACK: revoke the payout/overlay RPCs in a forward migration. Preserve
-- append-only overlay and finalization evidence; never reinterpret it as cash.
DO $preflight$ BEGIN
 IF to_regclass('public.bank_transactions') IS NULL OR
    to_regclass('public.payment_settlements') IS NULL THEN
   RAISE EXCEPTION 'multi_day_bank_proof_dependency_missing' USING ERRCODE='23514';
 END IF;
END $preflight$;

ALTER TABLE public.multi_day_overlay_funding_v1
 ADD COLUMN IF NOT EXISTS bank_transaction_id uuid
 REFERENCES public.bank_transactions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS multi_day_overlay_bank_once_v1
 ON public.multi_day_overlay_funding_v1(bank_transaction_id)
 WHERE bank_transaction_id IS NOT NULL;

-- The prior text-only entry point is deliberately held. Historical rows with
-- no bank proof remain visible but cannot fund a verified payout.
CREATE OR REPLACE FUNCTION public.multi_day_record_overlay_v1(
 p_event_id uuid,p_kind text,p_amount_vnd bigint,p_evidence_ref text,
 p_reason text,p_reverses_id uuid,p_adjusts_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'multi_day_overlay_bank_proof_required' USING ERRCODE='23514';
END $$;

CREATE FUNCTION public.multi_day_record_overlay_v1(
 p_event_id uuid,p_kind text,p_amount_vnd bigint,p_evidence_ref text,
 p_reason text,p_reverses_id uuid,p_adjusts_id uuid,p_request_id uuid,
 p_bank_transaction_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_bank public.bank_transactions%ROWTYPE;
 v_prior public.multi_day_overlay_funding_v1%ROWTYPE;
 v_parent public.multi_day_overlay_funding_v1%ROWTYPE;
 v_hash text; v_id uuid;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
    p_kind NOT IN('RECORDED','REVERSAL','ADJUSTMENT') OR
    p_amount_vnd IS NULL OR p_amount_vnd<=0 OR p_amount_vnd>9007199254740991 OR
    length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 8 AND 200 OR
    length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500 OR
    (p_kind IN('RECORDED','ADJUSTMENT') AND p_bank_transaction_id IS NULL) OR
    (p_kind='REVERSAL' AND p_bank_transaction_id IS NOT NULL) THEN
   RAISE EXCEPTION 'multi_day_overlay_invalid' USING ERRCODE='22023';
 END IF;
 -- Same bank-first order as canonical SePay matching. Finalize never takes a
 -- bank row lock; allocated bank evidence is immutable by the trigger below.
 IF p_bank_transaction_id IS NOT NULL THEN
   SELECT * INTO v_bank FROM public.bank_transactions
     WHERE id=p_bank_transaction_id FOR UPDATE;
 END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
     WHERE r.event_id=v_event.id AND r.club_id=v_event.club_id) THEN
   RAISE EXCEPTION 'multi_day_overlay_event_not_configured' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_event.club_id
     AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_overlay_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('event',p_event_id,
   'kind',p_kind,'amount',p_amount_vnd,'evidence',btrim(p_evidence_ref),
   'reason',btrim(p_reason),'reverses',p_reverses_id,'adjusts',p_adjusts_id,
   'bank',p_bank_transaction_id)::text);
 SELECT * INTO v_prior FROM public.multi_day_overlay_funding_v1
   WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR
      v_prior.actor_id IS DISTINCT FROM v_actor OR
      v_prior.payload_hash IS DISTINCT FROM v_hash THEN
     RAISE EXCEPTION 'multi_day_overlay_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'recordId',v_prior.id,
     'status',v_prior.status,'idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     WHERE g.id AND g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 IF p_kind IN('RECORDED','ADJUSTMENT') THEN
   IF v_bank.id IS NULL OR v_bank.club_id IS DISTINCT FROM v_event.club_id OR
      v_bank.provider IS DISTINCT FROM 'sepay' OR
      v_bank.api_verified_at IS NULL OR
      v_bank.transfer_type IS DISTINCT FROM 'in' OR
      v_bank.status IS DISTINCT FROM 'unmatched' OR
      v_bank.amount IS NULL OR v_bank.amount<=0 OR
      p_amount_vnd>v_bank.amount OR
      NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts a
        WHERE a.club_id=v_event.club_id AND a.account_number=v_bank.account_number
          AND a.is_active) OR
      EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.bank_transaction_id=v_bank.id) OR
      EXISTS(SELECT 1 FROM public.payment_settlements s
        WHERE s.bank_transaction_id=v_bank.id) OR
      EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 o
        WHERE o.bank_transaction_id=v_bank.id) THEN
     RAISE EXCEPTION 'multi_day_overlay_bank_unverified_or_allocated'
       USING ERRCODE='23514';
   END IF;
 END IF;
 IF p_kind='RECORDED' THEN
   IF p_reverses_id IS NOT NULL OR p_adjusts_id IS NOT NULL THEN
     RAISE EXCEPTION 'multi_day_overlay_parent_invalid' USING ERRCODE='23514';
   END IF;
 ELSIF p_kind='REVERSAL' THEN
   SELECT * INTO v_parent FROM public.multi_day_overlay_funding_v1
     WHERE id=p_reverses_id AND event_id=p_event_id;
   IF NOT FOUND OR v_parent.kind NOT IN('RECORDED','ADJUSTMENT') OR
      v_parent.amount_vnd<>p_amount_vnd OR p_adjusts_id IS NOT NULL OR
      EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 x
        WHERE x.reverses_id=p_reverses_id) THEN
     RAISE EXCEPTION 'multi_day_overlay_reversal_invalid' USING ERRCODE='23514';
   END IF;
 ELSE
   SELECT * INTO v_parent FROM public.multi_day_overlay_funding_v1
     WHERE id=p_adjusts_id AND event_id=p_event_id AND kind='REVERSAL';
   IF NOT FOUND OR p_reverses_id IS NOT NULL OR
      EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 x
        WHERE x.adjusts_id=p_adjusts_id) THEN
     RAISE EXCEPTION 'multi_day_overlay_adjustment_invalid' USING ERRCODE='23514';
   END IF;
 END IF;
 IF p_bank_transaction_id IS NOT NULL THEN
   UPDATE public.bank_transactions SET status='matched',processed_at=now()
     WHERE id=p_bank_transaction_id;
 END IF;
 INSERT INTO public.multi_day_overlay_funding_v1(club_id,event_id,kind,status,
   amount_vnd,evidence_ref,reason,reverses_id,adjusts_id,actor_id,request_id,
   payload_hash,bank_transaction_id)
 VALUES(v_event.club_id,p_event_id,p_kind,
   CASE p_kind WHEN 'RECORDED' THEN 'RECORDED' WHEN 'REVERSAL' THEN 'REVERSED'
     ELSE 'ADJUSTED' END,p_amount_vnd,btrim(p_evidence_ref),btrim(p_reason),
   p_reverses_id,p_adjusts_id,v_actor,p_request_id,v_hash,p_bank_transaction_id)
 RETURNING id INTO v_id;
 RETURN pg_catalog.jsonb_build_object('ok',true,'recordId',v_id,
   'status',CASE p_kind WHEN 'RECORDED' THEN 'RECORDED' WHEN 'REVERSAL'
     THEN 'REVERSED' ELSE 'ADJUSTED' END,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_record_overlay_v1(
 uuid,text,bigint,text,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_record_overlay_v1(
 uuid,text,bigint,text,text,uuid,uuid,uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION private.multi_day_overlay_bank_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 o
     WHERE o.bank_transaction_id=OLD.id) THEN
   RAISE EXCEPTION 'multi_day_allocated_bank_immutable' USING ERRCODE='23514';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_overlay_bank_immutable_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_overlay_bank_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.bank_transactions FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_overlay_bank_immutable_v1();

-- A movement must identify the same registration, flight and club. A NULL
-- registration is retained as unmatched ledger evidence, never pooled.
CREATE FUNCTION private.multi_day_movement_identity_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_reg public.tournament_registrations%ROWTYPE; v_event uuid;
BEGIN
 IF NEW.bank_transaction_id IS NOT NULL THEN
   PERFORM 1 FROM public.bank_transactions b
     WHERE b.id=NEW.bank_transaction_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 o
       WHERE o.bank_transaction_id=NEW.bank_transaction_id) THEN
     RAISE EXCEPTION 'multi_day_overlay_bank_already_allocated'
       USING ERRCODE='23514';
   END IF;
 END IF;
 IF NEW.registration_id IS NOT NULL THEN
   SELECT * INTO v_reg FROM public.tournament_registrations
     WHERE id=NEW.registration_id;
   SELECT t.event_id INTO v_event FROM public.tournaments t
     WHERE t.id=v_reg.tournament_id AND t.phase='flight';
 END IF;
 IF v_event IS NULL AND NEW.tournament_id IS NOT NULL THEN
   SELECT t.event_id INTO v_event FROM public.tournaments t
     WHERE t.id=NEW.tournament_id AND t.phase='flight';
 END IF;
 IF v_event IS NOT NULL AND NEW.registration_id IS NOT NULL AND
    EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 q
     WHERE q.event_id=v_event) AND
    (v_reg.id IS NULL OR
     NEW.tournament_id IS DISTINCT FROM v_reg.tournament_id OR
     NEW.club_id IS DISTINCT FROM v_reg.club_id OR
     NEW.club_id IS DISTINCT FROM
       (SELECT e.club_id FROM public.tournament_events e WHERE e.id=v_event)) THEN
   RAISE EXCEPTION 'multi_day_movement_source_mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_movement_identity_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_movement_identity_v1 BEFORE INSERT
 ON public.cashier_buyin_movements FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_movement_identity_v1();

-- Keep the original calculation private and uncallable by API clients;
-- the public wrapper below is the only preview/finalize seam.
ALTER FUNCTION public.multi_day_payout_preview_v1(uuid) SET SCHEMA private;
ALTER FUNCTION private.multi_day_payout_preview_v1(uuid)
 RENAME TO multi_day_payout_unverified_v1;
REVOKE ALL ON FUNCTION private.multi_day_payout_unverified_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.multi_day_payout_preview_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_club uuid; v_banks jsonb; v_funding text; v_hash text;
BEGIN
 SELECT e.club_id INTO v_club FROM public.tournament_events e WHERE e.id=p_event_id;
 IF auth.uid() IS NULL OR v_club IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.clubs c WHERE c.id=v_club AND
     (c.owner_id=auth.uid() OR public.is_club_floor(auth.uid(),v_club))) THEN
   RAISE EXCEPTION 'multi_day_payout_actor_or_qualification_denied'
     USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     WHERE g.id AND g.enabled AND v_club=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 -- Check exact movement identity before the old source classifier runs.
 IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
   LEFT JOIN public.tournament_registrations r ON r.id=m.registration_id
   LEFT JOIN public.tournaments rt ON rt.id=r.tournament_id
   LEFT JOIN public.tournaments mt ON mt.id=m.tournament_id
   WHERE (rt.event_id=p_event_id OR mt.event_id=p_event_id) AND
     (r.id IS NULL OR m.tournament_id IS DISTINCT FROM r.tournament_id OR
      m.club_id IS DISTINCT FROM r.club_id OR m.club_id IS DISTINCT FROM v_club)) THEN
   RAISE EXCEPTION 'multi_day_payout_source_unmatched' USING ERRCODE='23514';
 END IF;
 -- Confirmed legacy state is not funding. Until a canonical historical
 -- money proof is represented in the source contract, NULL snapshot is held.
 IF EXISTS(SELECT 1 FROM public.tournament_registrations r
   JOIN public.tournaments t ON t.id=r.tournament_id
   WHERE t.event_id=p_event_id AND t.phase='flight' AND
     r.status='confirmed' AND r.price_snapshot IS NULL) THEN
   RAISE EXCEPTION 'multi_day_payout_legacy_funding_unverified'
     USING ERRCODE='23514';
 END IF;
 v_result:=private.multi_day_payout_unverified_v1(p_event_id);
 IF EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 o
   LEFT JOIN public.bank_transactions b ON b.id=o.bank_transaction_id
   WHERE o.event_id=p_event_id AND o.kind IN('RECORDED','ADJUSTMENT') AND
     (b.id IS NULL OR b.club_id IS DISTINCT FROM o.club_id OR
      b.provider IS DISTINCT FROM 'sepay' OR b.api_verified_at IS NULL OR
      b.transfer_type IS DISTINCT FROM 'in' OR b.status IS DISTINCT FROM 'matched' OR
      b.amount IS NULL OR b.amount<o.amount_vnd OR
      EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.bank_transaction_id=b.id) OR
      EXISTS(SELECT 1 FROM public.payment_settlements s
        WHERE s.bank_transaction_id=b.id))) THEN
   RAISE EXCEPTION 'multi_day_payout_overlay_unverified' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'overlayId',o.id,'bankTransactionId',b.id,'bankAmountVnd',b.amount,
   'provider',b.provider,'apiVerifiedAt',b.api_verified_at,
   'transferType',b.transfer_type,'status',b.status,'clubId',b.club_id)
   ORDER BY o.id),'[]'::jsonb) INTO v_banks
 FROM public.multi_day_overlay_funding_v1 o
 JOIN public.bank_transactions b ON b.id=o.bank_transaction_id
 WHERE o.event_id=p_event_id AND o.kind IN('RECORDED','ADJUSTMENT');
 v_funding:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'priorFunding',v_result->>'fundingRevision','bankProof',v_banks)::text);
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'priorInput',v_result->>'payoutInputHash','funding',v_funding)::text);
 RETURN pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(
   v_result,'{fundingRevision}',pg_catalog.to_jsonb(v_funding)),
   '{payoutInputHash}',pg_catalog.to_jsonb(v_hash)),
   '{sourceSnapshot,bankProof}',v_banks,true);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_payout_preview_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_payout_preview_v1(uuid)
 TO authenticated,service_role;
