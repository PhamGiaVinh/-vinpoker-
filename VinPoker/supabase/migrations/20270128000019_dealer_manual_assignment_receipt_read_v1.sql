-- SOURCE ONLY. Service wrapper can reconcile an unknown committed initial assignment.
-- ROLLBACK: restore prior Edge artifact; retain assignment receipts and audit history.
BEGIN;
CREATE OR REPLACE FUNCTION public.worker_read_initial_assignment_receipt_v1(
 p_request_key text,p_club_id uuid,p_table_id uuid,p_table_session_id uuid,p_dealer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt floor_private.dealer_initial_assign_receipts%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
 SELECT * INTO receipt FROM floor_private.dealer_initial_assign_receipts r WHERE r.request_key=p_request_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF receipt.payload->>'club' IS DISTINCT FROM p_club_id::text
  OR receipt.payload->>'table' IS DISTINCT FROM p_table_id::text
  OR receipt.payload->>'session' IS DISTINCT FROM p_table_session_id::text
  OR NOT EXISTS(SELECT 1 FROM public.dealer_attendance dat
    WHERE dat.id=(receipt.payload->>'attendance')::uuid AND dat.dealer_id=p_dealer_id) THEN
  RETURN jsonb_build_object('outcome','idempotency_mismatch');
 END IF;
 RETURN receipt.result;
END;
$$;
REVOKE ALL ON FUNCTION public.worker_read_initial_assignment_receipt_v1(text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_read_initial_assignment_receipt_v1(text,uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
