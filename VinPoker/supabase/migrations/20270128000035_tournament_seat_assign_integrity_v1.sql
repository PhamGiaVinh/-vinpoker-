-- R1: registered-entry assignment preserves tuple, projection and receipt intent.
-- CLI-generated candidate promoted to unused forward catalog35 after source
-- reservation search and live ledger34/read-only function digest verification.
-- No existing seat update/backfill. Missing projection derives from locked entry;
-- existing disagreements fail closed, never overwrite historical counts.
-- ROLLBACK: forward restore pinned pre-apply function body; preserve seat history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE fn regprocedure; body text; old_columns text; old_values text; old_write text; new_write text;
BEGIN
 fn:=to_regprocedure('public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)');
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
   AND md5(replace(p.prosrc,E'\r',''))='e8bea18704dce78f0a83b1f1a703e72b'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
  RAISE EXCEPTION 'seat_assign_tuple_definition_drift'; END IF;
 body:=replace(pg_get_functiondef(fn),E'\r','');
 old_columns:=E'      assigned_by,\n      assigned_at\n    ) VALUES (';
 old_values:=E'      v_actor,\n      pg_catalog.now()\n    )\n    RETURNING id INTO v_seat_id;';
 IF length(body)-length(replace(body,old_columns,''))<>length(old_columns)
  OR length(body)-length(replace(body,old_values,''))<>length(old_values) THEN
  RAISE EXCEPTION 'seat_assign_tuple_patch_not_unique'; END IF;
 body:=replace(body,old_columns,E'      assigned_by,\n      assigned_at, table_id\n    ) VALUES (');
 body:=replace(body,old_values,E'      v_actor,\n      pg_catalog.now(), v_tournament_table.id\n    )\n    RETURNING id INTO v_seat_id;');
 old_write:=E'  BEGIN\n    UPDATE public.table_sessions\n';
 new_write:=$write$  BEGIN
    -- Entry is already locked and authorized. Materialize only its missing
    -- generation projection; do not reset an existing count to current_stack.
    INSERT INTO public.tournament_chip_counts (
      tournament_id, player_id, entry_number, chip_count
    ) VALUES (
      v_tournament.id, v_entry.player_id, v_entry.entry_no, v_entry.current_stack
    ) ON CONFLICT (tournament_id, player_id, entry_number) DO NOTHING;
    PERFORM 1 FROM public.tournament_chip_counts c
    WHERE c.tournament_id = v_tournament.id
      AND c.player_id = v_entry.player_id AND c.entry_number = v_entry.entry_no
      AND c.chip_count = v_entry.current_stack
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'chip_projection_mismatch');
    END IF;

    UPDATE public.table_sessions
$write$;
 IF length(body)-length(replace(body,old_write,''))<>length(old_write) THEN
   RAISE EXCEPTION 'seat_assign_projection_patch_not_unique'; END IF;
 body:=replace(body,old_write,new_write);
 EXECUTE body;
END $patch$;
DO $wrapper$
DECLARE f regprocedure:=to_regprocedure('public.floor_assign_entry_to_seat_v4(uuid,uuid,integer,bigint,uuid)'); b text; old_branch text;
BEGIN
 IF f IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=f
   AND md5(replace(p.prosrc,E'\r',''))='05d32501622fd990793a65bfb8515e1f'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'seat_assign_wrapper_definition_drift'; END IF;
 b:=replace(pg_get_functiondef(f),E'\r','');
 old_branch:='  IF FOUND THEN RETURN v_receipt.result; END IF;';
 IF length(b)-length(replace(b,old_branch,''))<>length(old_branch) THEN
   RAISE EXCEPTION 'seat_assign_wrapper_patch_not_unique'; END IF;
 b:=replace(b,old_branch,$branch$  IF FOUND THEN
    IF v_receipt.request_fingerprint IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'entry_id', p_entry_id,
      'tournament_table_id', p_tournament_table_id,
      'seat_number', p_seat_number,
      'expected_revision', p_expected_revision
    )::text THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;$branch$);
 EXECUTE b;
END $wrapper$;
COMMIT;
