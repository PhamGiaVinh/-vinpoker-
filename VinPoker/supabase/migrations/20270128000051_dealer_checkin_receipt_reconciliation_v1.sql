-- Read only: reconcile own exact check-in receipt without changing attendance.
-- Rollback: REVOKE EXECUTE ON FUNCTION
-- public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid) FROM authenticated;
-- Retain all receipts/attendance. No existing migration or payroll policy changes.
BEGIN;
CREATE FUNCTION public.get_dealer_checkin_receipt_v1(
  p_dealer_id uuid,p_club_id uuid,p_shift_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); prior record; fingerprint text;
BEGIN
  IF actor IS NULL OR p_dealer_id IS NULL OR p_club_id IS NULL
    OR p_shift_id IS NULL OR p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_dealer_operator(actor,p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  fingerprint:=jsonb_build_object('dealer',p_dealer_id,'club',p_club_id,'shift',p_shift_id)::text;
  SELECT * INTO prior FROM floor_private.floor_table_v3_existing_receipt(
    actor,'operator_check_in_dealer_v1',p_request_id);
  IF NOT FOUND THEN
    -- A concurrent transaction may still commit. This is not permission to retry
    -- with another key or to conclude that no attendance was created.
    RETURN jsonb_build_object('ok',true,'status','unknown');
  END IF;
  IF prior.request_fingerprint IS DISTINCT FROM fingerprint THEN
    RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN jsonb_build_object('ok',true,'status','committed','result',prior.result);
END $$;
REVOKE ALL ON FUNCTION public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_dealer_checkin_receipt_v1(uuid,uuid,uuid,uuid)
  TO authenticated;
COMMIT;
