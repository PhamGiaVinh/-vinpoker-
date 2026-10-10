-- Read-only reconciliation of the actor's exact mistaken-bust restore request.
-- Slot52 checked absent in source catalog/reservations and live ledger before use.
-- Rollback: REVOKE EXECUTE ON FUNCTION public.get_floor_restore_receipt_v1
-- (uuid,uuid,integer,bigint,bigint,uuid,uuid) FROM authenticated; retain all receipts.
BEGIN;
CREATE FUNCTION public.get_floor_restore_receipt_v1(
  p_entry_id uuid,p_to_tournament_table_id uuid,p_to_seat_number integer,
  p_expected_revision bigint,p_expected_control_epoch bigint,p_request_id uuid,
  p_expected_table_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; fingerprint text; prior record;
BEGIN
  IF actor IS NULL OR p_entry_id IS NULL OR p_to_tournament_table_id IS NULL
    OR p_to_seat_number IS NULL OR p_to_seat_number NOT BETWEEN 1 AND 9
    OR p_expected_revision IS NULL OR p_expected_revision<0
    OR p_expected_control_epoch IS NULL OR p_expected_control_epoch<0
    OR p_request_id IS NULL OR p_expected_table_session_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  SELECT t.club_id INTO club FROM public.tournament_entries e
    JOIN public.tournaments t ON t.id=e.tournament_id WHERE e.id=p_entry_id;
  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,club) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  -- Do not require a currently busted entry/open destination: committed restore
  -- changes entry state and the exact destination session may since have closed.
  fingerprint:=pg_catalog.jsonb_build_object(
    'entry_id',p_entry_id,'to_tournament_table_id',p_to_tournament_table_id,
    'to_seat_number',p_to_seat_number,'expected_revision',p_expected_revision,
    'expected_control_epoch',p_expected_control_epoch,
    'expected_table_session_id',p_expected_table_session_id)::text;
  SELECT * INTO prior FROM floor_private.floor_table_v3_existing_receipt(
    actor,'floor_restore_busted_player_to_seat_v3',p_request_id);
  IF NOT FOUND THEN
    -- A transaction may still be in flight. Absence never licenses a new key.
    RETURN pg_catalog.jsonb_build_object('ok',true,'status','unknown');
  END IF;
  IF prior.request_fingerprint IS DISTINCT FROM fingerprint THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','committed','result',prior.result);
END $$;
ALTER FUNCTION public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)
  TO authenticated;
COMMIT;
