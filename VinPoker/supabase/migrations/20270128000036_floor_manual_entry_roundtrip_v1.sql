-- Canonical manual participation may leave/re-enter a seat without inventing
-- CLI-generated candidate promoted to unused forward catalog36 after source/live checks.
-- a registration. Preserve all existing authorization/session/chip/receipt gates.
-- ROLLBACK: new forward migration restores the three pinned pre-apply bodies;
-- preserve entries, seats, chip projections and immutable receipt history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE r record; f regprocedure; b text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)',
   '2306d56c6245305f5893bfd6d04c05a1',
   $old$IF v_entry.status <> 'registered' OR v_entry.registration_id IS NULL THEN$old$,
   $new$IF v_entry.status <> 'registered'
     OR (v_entry.registration_id IS NULL AND v_entry.source IS DISTINCT FROM 'manual') THEN$new$),
  ('public.floor_free_sit_player_v1(uuid,bigint,bigint,integer,uuid,text)',
   'aaeb18d612b167d80065aed240f12057',
   $old$IF v_entry.registration_id IS NULL THEN$old$,
   $new$IF v_entry.registration_id IS NULL AND v_entry.source IS DISTINCT FROM 'manual' THEN$new$),
  ('public.get_floor_seatable_entries(uuid)',
   '40cc87387afbdc03b7fa29ef9d7179a7',
   $old$AND entry_row.registration_id IS NOT NULL$old$,
   $new$AND (entry_row.registration_id IS NOT NULL OR entry_row.source = 'manual')$new$)
 ) x(signature,expected_md5,old_text,new_text)
 LOOP
  f:=to_regprocedure(r.signature);
  IF f IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=f
   AND md5(replace(p.prosrc,E'\r',''))=r.expected_md5
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'manual_entry_roundtrip_definition_drift: %',r.signature;
  END IF;
  b:=replace(pg_get_functiondef(f),E'\r','');
  IF length(b)-length(replace(b,r.old_text,''))<>length(r.old_text) THEN
   RAISE EXCEPTION 'manual_entry_roundtrip_patch_not_unique: %',r.signature;
  END IF;
  b:=replace(b,r.old_text,r.new_text);
  EXECUTE b;
 END LOOP;
END $patch$;
DO $display$
DECLARE f regprocedure:='public.get_floor_seatable_entries(uuid)'::regprocedure; b text;
 old_text text:='COALESCE(profile_row.display_name, entry_row.player_id::text)';
 new_text text:=$new$COALESCE(NULLIF(pg_catalog.btrim(profile_row.display_name), ''),
       floor_private.tournament_entry_display_v1(entry_row.id,entry_row.player_id,entry_row.tournament_id,entry_row.entry_no)->>'player_name',
       entry_row.player_id::text)$new$;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f
   AND md5(replace(prosrc,E'\r',''))='a32ac52a84eb3516a8dc4d22b0cc67f5') THEN
   RAISE EXCEPTION 'manual_entry_waiting_display_definition_drift';
 END IF;
 b:=replace(pg_get_functiondef(f),E'\r','');
 IF length(b)-length(replace(b,old_text,''))<>length(old_text) THEN
   RAISE EXCEPTION 'manual_entry_waiting_display_patch_not_unique';
 END IF;
 EXECUTE replace(b,old_text,new_text);
END $display$;
COMMIT;
