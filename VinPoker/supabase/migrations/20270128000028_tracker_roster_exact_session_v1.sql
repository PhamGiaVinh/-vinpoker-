-- Fix physical/logical table identity at Tracker hand start and roster writes.
-- No legacy rows are relinked. ROLLBACK: forward-restore the pinned definitions
-- only after disabling affected writes; retain evidence from created hands.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $migration$
DECLARE
  definition text;
  needle text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.snapshot_tracker_hand_blinds()'::regprocedure)
       IS DISTINCT FROM '9c997255e24a4cd71ec526dbb40a0367'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.set_tracker_table_roster_seat(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)'::regprocedure)
       IS DISTINCT FROM 'bf574736f82899d92fb7e9f3b95e5673' THEN
    RAISE EXCEPTION 'tracker_roster_session_definition_drift';
  END IF;
  definition := replace(pg_get_functiondef('floor_private.snapshot_tracker_hand_blinds()'::regprocedure), E'\r\n', E'\n');
  needle := 'WHERE tournament_id = NEW.tournament_id AND table_id = NEW.table_id
    AND is_active = true;';
  IF strpos(definition, needle)=0 THEN RAISE EXCEPTION 'tracker_roster_snapshot_patch_missing'; END IF;
  definition := replace(definition, needle, 'WHERE tournament_id = NEW.tournament_id
    AND table_session_id = NEW.table_session_id
    AND tournament_table_id = (
      SELECT tt.id FROM public.tournament_tables tt
      WHERE tt.tournament_id = NEW.tournament_id
        AND tt.table_session_id = NEW.table_session_id
        AND tt.status = ''active''
        AND (NEW.tournament_table_id IS NULL OR tt.id = NEW.tournament_table_id)
        AND (tt.id = NEW.table_id OR tt.game_table_id = NEW.table_id)
    )
    AND is_active = true;');
  EXECUTE definition;

  definition := replace(pg_get_functiondef('public.set_tracker_table_roster_seat(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)'::regprocedure), E'\r\n', E'\n');
  needle := '  ORDER BY (tt.id = p_table_id) DESC, tt.id';
  IF strpos(definition, needle)=0 THEN RAISE EXCEPTION 'tracker_roster_writer_patch_missing'; END IF;
  definition := replace(definition, needle, '    AND tt.status = ''active''
    AND EXISTS (SELECT 1 FROM public.table_sessions session_row
      WHERE session_row.id = tt.table_session_id
        AND session_row.closed_at IS NULL
        AND session_row.tournament_id = p_tournament_id
        AND session_row.club_id = v_club
        AND session_row.game_table_id = COALESCE(tt.game_table_id, tt.table_id))
  ORDER BY (tt.id = p_table_id) DESC, tt.id');
  EXECUTE definition;
END;
$migration$;
COMMIT;
