-- SOURCE ONLY. Evidence-linked, append-only event overlay funding.
-- A required shortfall is never a funded overlay. A correction reverses a
-- specific record; a replacement is a new linked record, not an UPDATE.
-- ROLLBACK: revoke the RPC in a forward migration; preserve this ledger.
CREATE TABLE IF NOT EXISTS public.multi_day_overlay_funding_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 event_id uuid NOT NULL REFERENCES public.tournament_events(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('RECORDED','REVERSAL','ADJUSTMENT')),
 status text NOT NULL CHECK(status IN('RECORDED','REVERSED','ADJUSTED')),
 amount_vnd bigint NOT NULL CHECK(amount_vnd>0 AND amount_vnd<=9007199254740991),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 8 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 reverses_id uuid UNIQUE REFERENCES public.multi_day_overlay_funding_v1(id) ON DELETE RESTRICT,
 adjusts_id uuid REFERENCES public.multi_day_overlay_funding_v1(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL UNIQUE,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='RECORDED' AND status='RECORDED' AND reverses_id IS NULL AND adjusts_id IS NULL)
   OR (kind='REVERSAL' AND status='REVERSED' AND reverses_id IS NOT NULL AND adjusts_id IS NULL)
   OR (kind='ADJUSTMENT' AND status='ADJUSTED' AND reverses_id IS NULL AND adjusts_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS multi_day_overlay_funding_event_v1
 ON public.multi_day_overlay_funding_v1(event_id,created_at,id);
ALTER TABLE public.multi_day_overlay_funding_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_overlay_funding_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_overlay_append_only_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_overlay_funding_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION public.multi_day_record_overlay_v1(
 p_event_id uuid,p_kind text,p_amount_vnd bigint,p_evidence_ref text,
 p_reason text,p_reverses_id uuid,p_adjusts_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_prior public.multi_day_overlay_funding_v1%ROWTYPE;
 v_parent public.multi_day_overlay_funding_v1%ROWTYPE;
 v_hash text; v_id uuid;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
   p_kind NOT IN('RECORDED','REVERSAL','ADJUSTMENT') OR
   p_amount_vnd IS NULL OR p_amount_vnd<=0 OR p_amount_vnd>9007199254740991 OR
   length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 8 AND 200 OR
   length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500 THEN
   RAISE EXCEPTION 'multi_day_overlay_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
     WHERE r.event_id=v_event.id AND r.club_id=v_event.club_id) THEN
   RAISE EXCEPTION 'multi_day_overlay_event_not_configured' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_overlay_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('event',p_event_id,'kind',p_kind,
   'amount',p_amount_vnd,'evidence',btrim(p_evidence_ref),'reason',btrim(p_reason),
   'reverses',p_reverses_id,'adjusts',p_adjusts_id)::text);
 SELECT * INTO v_prior FROM public.multi_day_overlay_funding_v1 WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR v_prior.actor_id IS DISTINCT FROM v_actor
     OR v_prior.payload_hash IS DISTINCT FROM v_hash THEN
     RAISE EXCEPTION 'multi_day_overlay_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'recordId',v_prior.id,
     'status',v_prior.status,'idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
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
 INSERT INTO public.multi_day_overlay_funding_v1(club_id,event_id,kind,status,
   amount_vnd,evidence_ref,reason,reverses_id,adjusts_id,actor_id,request_id,payload_hash)
 VALUES(v_event.club_id,p_event_id,p_kind,
   CASE p_kind WHEN 'RECORDED' THEN 'RECORDED' WHEN 'REVERSAL' THEN 'REVERSED'
     ELSE 'ADJUSTED' END,p_amount_vnd,btrim(p_evidence_ref),btrim(p_reason),
   p_reverses_id,p_adjusts_id,v_actor,p_request_id,v_hash)
 RETURNING id INTO v_id;
 RETURN pg_catalog.jsonb_build_object('ok',true,'recordId',v_id,
   'status',CASE p_kind WHEN 'RECORDED' THEN 'RECORDED' WHEN 'REVERSAL'
     THEN 'REVERSED' ELSE 'ADJUSTED' END,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_record_overlay_v1(
 uuid,text,bigint,text,text,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_record_overlay_v1(
 uuid,text,bigint,text,text,uuid,uuid,uuid) TO authenticated,service_role;
