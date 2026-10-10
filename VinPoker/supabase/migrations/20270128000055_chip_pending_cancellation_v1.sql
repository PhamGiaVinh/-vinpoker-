-- Exact terminal cancellation; no inventory or finance ledger mutation.
-- Slot55 verified free alongside54. Rollback revoke endpoint, retain tombstones.
BEGIN;
CREATE FUNCTION public.cancel_chip_color_up_request_v1(
  p_tournament_id uuid,p_operation text,p_request_key text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; proof jsonb; terminal jsonb;
BEGIN
  proof:=public.get_chip_color_up_receipt_v1(p_tournament_id,p_operation,p_request_key,p_payload);
  IF proof ? 'error' THEN RETURN proof; END IF;
  SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id;
  -- Match writer16 order: club fence, tournament row, reverse operation row, key.
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||club::text));
  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.club_id=club FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF p_operation='reverse_color_up' THEN
    PERFORM 1 FROM public.color_up_operation o WHERE o.id=(p_payload->>'operation')::uuid
      AND o.tournament_id=p_tournament_id AND o.club_id=club FOR UPDATE;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','OPERATION_NOT_FOUND'); END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext(p_request_key));
  -- Recheck authority and receipt under writer fences with fresh snapshot.
  proof:=public.get_chip_color_up_receipt_v1(p_tournament_id,p_operation,p_request_key,p_payload);
  IF proof ? 'error' OR proof->>'status'='committed' THEN RETURN proof; END IF;
  IF proof->>'status' IS DISTINCT FROM 'unknown' THEN
    RETURN pg_catalog.jsonb_build_object('error','RECEIPT_STATE_UNVERIFIED');
  END IF;
  -- Legacy operations without private receipts may already have consumed chips.
  -- Never call those uncommitted just because the modern receipt is absent.
  IF p_operation='color_up' AND EXISTS(SELECT 1 FROM public.color_up_operation o WHERE o.idempotency_key=p_request_key) THEN
    RETURN pg_catalog.jsonb_build_object('error','LEGACY_RECEIPT_REVIEW_REQUIRED');
  END IF;
  terminal:=pg_catalog.jsonb_build_object('status','cancelled','error','REQUEST_CANCELLED',
    'actor_id',actor,'request_key',p_request_key,'operation',p_operation,'payload',p_payload);
  INSERT INTO floor_private.chip_mutation_receipts(actor_id,request_key,operation,payload,result)
    VALUES(actor,p_request_key,p_operation,p_payload,terminal);
  RETURN pg_catalog.jsonb_build_object('status','committed','result',terminal);
END $$;
ALTER FUNCTION public.cancel_chip_color_up_request_v1(uuid,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_chip_color_up_request_v1(uuid,text,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_chip_color_up_request_v1(uuid,text,text,jsonb) TO authenticated;
COMMIT;
