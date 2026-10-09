-- N02: CLI-generated candidate assigned unused catalog33 after source/live checks.
-- Production release still requires exact-head review and controlled apply gates.
-- Depends on exact reviewed N01 chain32. Preserve the logical table alias
-- written by roster/deferred consumers; never use physical game_table_id here.
-- No existing seat update/backfill or receipt/entry/chip rewrite.
-- ROLLBACK: forward restore the two pre-apply function bodies, preserving data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE r record; fn regprocedure; body text; rewritten text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)',
   '6f12a08bab466d61fcf6d76fd7aa52e9',
   $old$      assigned_at, player_name, avatar_url$old$,
   $new$      assigned_at, player_name, avatar_url, table_id$new$,
   $old$pg_catalog.now(), v_source_seat.player_name, v_source_seat.avatar_url$old$,
   $new$pg_catalog.now(), v_source_seat.player_name, v_source_seat.avatar_url, v_destination_table.id$new$),
  ('public.floor_break_table_v5(uuid,bigint,uuid,text,text)',
   '137f5844cc1dd4a591ae377002475f2f',
   $old$assigned_at, player_name, avatar_url
      ) VALUES$old$,
   $new$assigned_at, player_name, avatar_url, table_id
      ) VALUES$new$,
   $old$(SELECT source.avatar_url FROM public.tournament_seats source WHERE source.id=v_row.source_seat_id))$old$,
   $new$(SELECT source.avatar_url FROM public.tournament_seats source WHERE source.id=v_row.source_seat_id),
        v_row.destination_tournament_table_id)$new$)
 ) changes(signature,expected_md5,old_text,new_text,old_text2,new_text2)
 LOOP
  fn:=to_regprocedure(r.signature);
  IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
    AND md5(replace(p.prosrc,E'\r',''))=r.expected_md5
    AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'seat_move_tuple_definition_drift: %',r.signature; END IF;
  body:=replace(pg_get_functiondef(fn),E'\r','');
  IF length(body)-length(replace(body,r.old_text,''))<>length(r.old_text)
   OR length(body)-length(replace(body,r.old_text2,''))<>length(r.old_text2) THEN
   RAISE EXCEPTION 'seat_move_tuple_patch_not_unique: %',r.signature; END IF;
  rewritten:=replace(replace(body,r.old_text,r.new_text),r.old_text2,r.new_text2);
  EXECUTE rewritten;
 END LOOP;
END $patch$;
COMMIT;
