-- CLI-created candidate; forward40 unused in source/live catalog at creation.
-- Same-snapshot pseudo-random source/seat ordering makes preview replayable.
-- Progressive occupancy rank keeps the existing shortest-table-first policy.
-- ROLLBACK: restore pinned planner/break definitions through reviewed forward
-- SQL; keep applied seats/tickets/audit. Re-preview any outstanding plans.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 rows_fn regprocedure:='floor_private.floor_break_plan_rows_v1(uuid,uuid)'::regprocedure;
 plan_fn regprocedure:='public.floor_plan_break_table_v1(uuid,bigint,text)'::regprocedure;
 break_fn regprocedure:='public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure;
 fn regprocedure; body text; needle text; replacement text;
 expected text; part integer;
BEGIN
 FOR fn,expected IN SELECT * FROM (VALUES
   (rows_fn,'96ab5a716bb5eb408ba95561cba9c420'),
   (plan_fn,'198285df15c1e135270f264be39222f5'),
   (break_fn,'f2f87e52ae43a9c21f314b3d7df33e9d')) AS required(oid,digest)
 LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
     AND md5(replace(p.prosrc,chr(13),''))=expected
     AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
     RAISE EXCEPTION 'balanced_plan_definition_drift: %',fn;
   END IF;
 END LOOP;
 IF to_regprocedure('floor_private.floor_break_plan_rows_v2(uuid,uuid,text,bigint)') IS NOT NULL THEN
   RAISE EXCEPTION 'balanced_plan_helper_already_exists';
 END IF;
 body:=replace(pg_get_functiondef(rows_fn),chr(13),'');
 FOR part IN 1..4 LOOP
   CASE part
   WHEN 1 THEN
     needle:='floor_private.floor_break_plan_rows_v1(p_tournament_id uuid, p_source_tournament_table_id uuid)';
     replacement:='floor_private.floor_break_plan_rows_v2(p_tournament_id uuid, p_source_tournament_table_id uuid, p_draw_mode text, p_expected_revision bigint)';
   WHEN 2 THEN
     needle:='ORDER BY s.seat_number, s.id';
     replacement:=$text$ORDER BY CASE WHEN p_draw_mode='redraw_balanced'
       THEN pg_catalog.md5(s.id::text||p_expected_revision::text) END,
       s.seat_number, s.id$text$;
   WHEN 3 THEN
     needle:=$text$destination_rows AS (
    SELECT row_number() OVER (
        ORDER BY gt.table_number, tt.id, seat_no
      ) AS ordinal,$text$;
     replacement:=$text$destination_candidates AS (
    SELECT occupied.count AS occupied_count,
      row_number() OVER (PARTITION BY tt.id ORDER BY
        CASE WHEN p_draw_mode='redraw_balanced' THEN
          pg_catalog.md5(tt.id::text||seat_no::text||p_expected_revision::text) END,
        seat_no) AS slot_rank,$text$;
   WHEN 4 THEN
     needle:=$text$  )
  SELECT s.ordinal, s.source_seat_id$text$;
     replacement:=$text$  ), destination_rows AS (
    SELECT row_number() OVER (ORDER BY
        CASE WHEN p_draw_mode='redraw_balanced' THEN occupied_count+slot_rank-1 ELSE 0 END,
        CASE WHEN p_draw_mode='redraw_balanced' THEN
          pg_catalog.md5(destination_tournament_table_id::text||p_expected_revision::text) END,
        destination_table_number,destination_tournament_table_id,slot_rank
      ) AS ordinal,
      destination_tournament_table_id,destination_table_session_id,
      destination_table_number,destination_seat_number,transfer_mode
    FROM destination_candidates
  )
  SELECT s.ordinal, s.source_seat_id$text$;
   END CASE;
   IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
     RAISE EXCEPTION 'balanced_helper_patch_not_unique: %',part;
   END IF;
   body:=replace(body,needle,replacement);
 END LOOP;
 EXECUTE body;
 body:=replace(pg_get_functiondef(plan_fn),chr(13),'');
 FOR part IN 1..3 LOOP
   CASE part
   WHEN 1 THEN
     needle:=$text$p_draw_mode <> 'fill_lowest_table'$text$;
     replacement:=$text$p_draw_mode IS NULL OR p_draw_mode NOT IN ('fill_lowest_table','redraw_balanced')$text$;
   WHEN 2 THEN
     needle:='floor_private.floor_break_plan_rows_v1(v_tournament.id, v_tt.id)';
     replacement:='floor_private.floor_break_plan_rows_v2(v_tournament.id, v_tt.id, p_draw_mode, p_expected_revision)';
   WHEN 3 THEN
     needle:=$text$'complete', v_complete,$text$;
     replacement:=$text$'draw_mode', p_draw_mode, 'complete', v_complete,$text$;
   END CASE;
   IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
     RAISE EXCEPTION 'balanced_public_plan_patch_not_unique: %',part;
   END IF;
   body:=replace(body,needle,replacement);
 END LOOP;
 EXECUTE body;
 body:=replace(pg_get_functiondef(break_fn),chr(13),'');
 needle:='floor_private.floor_break_plan_rows_v1(v_tournament.id, v_tt.id)';
 replacement:='floor_private.floor_break_plan_rows_v2(v_tournament.id, v_tt.id, p_draw_mode, p_expected_revision)';
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'balanced_commit_patch_not_unique';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $patch$;
ALTER FUNCTION floor_private.floor_break_plan_rows_v2(uuid,uuid,text,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_break_plan_rows_v2(uuid,uuid,text,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
