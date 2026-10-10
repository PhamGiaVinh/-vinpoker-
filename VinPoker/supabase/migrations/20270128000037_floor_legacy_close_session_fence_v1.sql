-- CLI-created candidate assigned unused forward catalog37 after source/live check.
-- NOT release-ready until reachable consumers use canonical revision/receipt APIs.
-- Legacy signature cannot express session/epoch/revision intent safely.
-- ROLLBACK: reviewed forward restoration of the exact previous function body;
-- do not remove sessions, seats, receipts, or history. Keep canonical writers.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 fn regprocedure:=to_regprocedure('public.close_tournament_table(uuid,text,text)');
 body text;
 needle text:='  IF p_draw_mode NOT IN (''redraw_balanced'', ''fill_lowest_table'') THEN';
 locked_needle text:='  IF v_close.status = ''closed'' THEN';
 gate text:=$gate$  -- Session-managed logical tables must use a canonical fenced writer.
  -- Check actor before revealing compatibility state; no mutation/reconciliation.
  IF EXISTS (
    SELECT 1 FROM public.tournament_tables tt
    WHERE tt.id=p_tournament_table_id AND (
      tt.table_session_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.table_sessions s
        WHERE s.game_table_id=COALESCE(tt.game_table_id,tt.table_id)
      )
    )
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tournament_tables tt
      JOIN public.tournaments t ON t.id=tt.tournament_id
      WHERE tt.id=p_tournament_table_id
        AND floor_private.floor_table_v3_actor_is_tournament_operator(v_actor,t.club_id)
    ) THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','exact_session_required');
  END IF;
$gate$;
BEGIN
 IF fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn
   AND md5(replace(p.prosrc,chr(13),''))='a0796151a560c1b5cbd355c6c48f8473'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=public']::text[]) THEN
   RAISE EXCEPTION 'legacy_close_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 IF length(body)-length(replace(body,needle,''))<>length(needle)
    OR length(body)-length(replace(body,locked_needle,''))<>length(locked_needle) THEN
   RAISE EXCEPTION 'legacy_close_patch_not_unique';
 END IF;
 -- Recheck after tournament/table locks: an initial compatibility read may
 -- precede another writer opening a session. Never authorize from that read.
 body:=replace(body,needle,gate||needle);
 EXECUTE replace(body,locked_needle,gate||locked_needle);
END $patch$;
COMMIT;
