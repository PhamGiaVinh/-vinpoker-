-- Forward-only, read-only own receipt reconciliation. Slot53 verified free.
-- Rollback: revoke authenticated EXECUTE; preserve receipts and all chip ledger.
BEGIN;
CREATE FUNCTION public.get_chip_color_up_receipt_v1(
  p_tournament_id uuid,p_operation text,p_request_key text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; receipt floor_private.chip_mutation_receipts%ROWTYPE;
  canonical jsonb; operation_id uuid;
BEGIN
  IF actor IS NULL THEN RETURN pg_catalog.jsonb_build_object('error','Unauthorized'); END IF;
  IF p_tournament_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('color_up','reverse_color_up')
    OR p_request_key IS NULL OR length(btrim(p_request_key))=0 OR length(p_request_key)>128
    OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload)<>'object' THEN
    RETURN pg_catalog.jsonb_build_object('error','INVALID_INPUT');
  END IF;
  SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN
    RETURN pg_catalog.jsonb_build_object('error','Forbidden');
  END IF;
  -- Match the exact original writer fingerprint, including nullable level.
  IF p_operation='color_up' THEN
    IF pg_catalog.jsonb_typeof(p_payload->'added') IS DISTINCT FROM 'number'
      OR (p_payload->>'added') !~ '^[0-9]+$'
      OR ((p_payload->'level') IS DISTINCT FROM 'null'::jsonb AND
        (pg_catalog.jsonb_typeof(p_payload->'level') IS DISTINCT FROM 'number' OR (p_payload->>'level') !~ '^[0-9]+$')) THEN
      RETURN pg_catalog.jsonb_build_object('error','INVALID_INPUT');
    END IF;
    canonical:=pg_catalog.jsonb_build_object('tournament',p_tournament_id,
      'removed',(p_payload->>'removed')::uuid,'target',(p_payload->>'target')::uuid,
      'added',(p_payload->>'added')::bigint,'level',(p_payload->>'level')::integer);
    IF canonical IS DISTINCT FROM p_payload OR (p_payload->>'removed') IS NULL OR (p_payload->>'target') IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('error','INVALID_INPUT');
    END IF;
  ELSE
    operation_id:=(p_payload->>'operation')::uuid;
    canonical:=pg_catalog.jsonb_build_object('operation',operation_id);
    IF operation_id IS NULL OR canonical IS DISTINCT FROM p_payload THEN
      RETURN pg_catalog.jsonb_build_object('error','INVALID_INPUT');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.color_up_operation o WHERE o.id=operation_id AND o.tournament_id=p_tournament_id AND o.club_id=club) THEN
      RETURN pg_catalog.jsonb_build_object('error','OPERATION_NOT_FOUND');
    END IF;
  END IF;
  SELECT * INTO receipt FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=actor AND r.request_key=p_request_key;
  IF NOT FOUND THEN
    -- Absence does not prove rejection: the mutation may still be in flight.
    RETURN pg_catalog.jsonb_build_object('status','unknown');
  END IF;
  IF receipt.operation IS DISTINCT FROM p_operation OR receipt.payload IS DISTINCT FROM canonical THEN
    RETURN pg_catalog.jsonb_build_object('error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN pg_catalog.jsonb_build_object('status','committed','result',receipt.result);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN pg_catalog.jsonb_build_object('error','INVALID_INPUT');
END $$;
ALTER FUNCTION public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb) TO authenticated;
COMMIT;
