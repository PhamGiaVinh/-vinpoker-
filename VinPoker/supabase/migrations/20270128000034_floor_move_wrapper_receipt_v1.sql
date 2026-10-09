-- N03 CLI-generated candidate assigned unused forward catalog34 after live/source checks.
-- Release requires exact-head review, recovery verification and controlled apply.
-- ROLLBACK: restore the exact previous wrapper body through a forward migration.
-- Keep new-intent seat-lock checks and canonical v2 mutation unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE fn regprocedure := to_regprocedure('public.move_player_seat_v3(uuid,uuid,integer,bigint,bigint,uuid)');
 body text;
 old_clause text := 'IF FOUND THEN RETURN v_receipt.result; END IF;';
 new_clause text := $replacement$IF FOUND THEN
    IF v_receipt.request_fingerprint IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'entry_id', p_entry_id,
      'to_tournament_table_id', p_to_tournament_table_id,
      'to_seat_number', p_to_seat_number,
      'expected_source_revision', p_expected_source_revision,
      'expected_destination_revision', p_expected_destination_revision
    )::text THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;$replacement$;
BEGIN
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
  AND md5(replace(p.prosrc,chr(13),''))='fba82420a2586c9a1d45f70905b71a97'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
  RAISE EXCEPTION 'move_wrapper_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 IF length(body)-length(replace(body,old_clause,''))<>length(old_clause) THEN
  RAISE EXCEPTION 'move_wrapper_patch_not_unique';
 END IF;
 EXECUTE replace(body,old_clause,new_clause);
END $patch$;
COMMIT;
