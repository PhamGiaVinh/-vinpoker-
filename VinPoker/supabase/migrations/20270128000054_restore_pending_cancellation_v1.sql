-- Forward-only exact restore intent cancellation. Slot54 checked source/live absent.
-- Rollback: revoke this endpoint; retain cancellation receipts so delayed retries
-- remain fenced. Never delete tombstones or undo an already committed restore.
BEGIN;
CREATE FUNCTION public.cancel_floor_restore_request_v1(
  p_entry_id uuid,p_to_tournament_table_id uuid,p_to_seat_number integer,
  p_expected_revision bigint,p_expected_control_epoch bigint,p_request_id uuid,
  p_expected_table_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); proof jsonb; fingerprint text; terminal jsonb;
BEGIN
  -- The own-actor reader performs exact input and current tournament authority
  -- checks. Receipt absence alone is NOT a cancellation acknowledgement.
  proof:=public.get_floor_restore_receipt_v1(p_entry_id,p_to_tournament_table_id,
    p_to_seat_number,p_expected_revision,p_expected_control_epoch,p_request_id,p_expected_table_session_id);
  IF proof->>'ok' IS DISTINCT FROM 'true' THEN RETURN proof; END IF;
  -- Same receipt fence as every restore wrapper delegating to private writer15.
  -- Writer acquires it before any seat/entry mutation. Do not acquire tournament
  -- locks before this fence: that would invert the original writer lock order.
  PERFORM floor_private.floor_table_v3_lock_receipt(actor,'floor_restore_busted_player_to_seat_v3',p_request_id);
  -- Fresh statement snapshot after waiting for an in-flight commit.
  proof:=public.get_floor_restore_receipt_v1(p_entry_id,p_to_tournament_table_id,
    p_to_seat_number,p_expected_revision,p_expected_control_epoch,p_request_id,p_expected_table_session_id);
  IF proof->>'ok' IS DISTINCT FROM 'true' OR proof->>'status'='committed' THEN RETURN proof; END IF;
  IF proof->>'status' IS DISTINCT FROM 'unknown' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','receipt_state_unverified');
  END IF;
  fingerprint:=pg_catalog.jsonb_build_object('entry_id',p_entry_id,
    'to_tournament_table_id',p_to_tournament_table_id,'to_seat_number',p_to_seat_number,
    'expected_revision',p_expected_revision,'expected_control_epoch',p_expected_control_epoch,
    'expected_table_session_id',p_expected_table_session_id)::text;
  terminal:=pg_catalog.jsonb_build_object('ok',false,'error','REQUEST_CANCELLED',
    'status','cancelled','actor_id',actor,'request_id',p_request_id,'payload',fingerprint::jsonb);
  -- Writer15 returns stored result before mutation. Negative receipt is durable
  -- and payload-bound; same-key changed destination remains a conflict.
  PERFORM floor_private.floor_table_v3_save_receipt(actor,'floor_restore_busted_player_to_seat_v3',
    p_request_id,fingerprint,terminal);
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','committed','result',terminal);
END $$;
ALTER FUNCTION public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)
  TO authenticated;
COMMIT;
