-- N01: preserve display metadata when a canonical entry changes seats.
-- CLI-generated candidate promoted to unused catalog32 after source/ledger31 checks.
-- Identity, chips, receipts, session/epoch and writer authorization stay unchanged.
-- No UPDATE/backfill of existing or historical seats. Readers recover display only.
-- ROLLBACK: reviewed forward migration restores the pinned reader/writer bodies,
-- then drops the new trigger and private functions. Keep names on new seat rows;
-- do not delete seats, revert chip/entry history or restore the whole database.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $$ BEGIN
 IF to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)') IS NOT NULL
  OR to_regprocedure('floor_private.preserve_tournament_seat_display_v1()') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_seats'::regclass
   AND tgname='trg_tournament_seat_display_preserve_v1') THEN
  RAISE EXCEPTION 'seat_display_object_collision'; END IF;
END $$;

-- Display history is usable only for this exact canonical participation tuple.
-- Never infer an entry or recover names from another re-entry, player or tour.
CREATE FUNCTION floor_private.tournament_entry_display_v1(
 p_entry_id uuid,p_player_id uuid,p_tournament_id uuid,p_entry_no integer
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object(
  'player_name',(SELECT NULLIF(pg_catalog.btrim(q.player_name),'')
   FROM public.tournament_seats q
   WHERE q.entry_id=e.id AND q.player_id=e.player_id
    AND q.tournament_id=e.tournament_id AND q.entry_number=e.entry_no
    AND NULLIF(pg_catalog.btrim(q.player_name),'') IS NOT NULL
   ORDER BY q.is_active DESC,q.created_at DESC,q.id DESC LIMIT 1)
 ) FROM public.tournament_entries e
 WHERE e.id=p_entry_id AND e.player_id=p_player_id
  AND e.tournament_id=p_tournament_id AND e.entry_no=p_entry_no;
$$;
ALTER FUNCTION floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated,service_role;

-- All existing immediate/deferred/break/redraw insert writers share this seam.
-- Fill missing names only. Avatar must be copied from the actual locked source
-- by writers below, including NULL. History timestamps/UUIDs are not provenance.
CREATE FUNCTION floor_private.preserve_tournament_seat_display_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE metadata jsonb;
BEGIN
 IF NEW.entry_id IS NOT NULL AND NULLIF(pg_catalog.btrim(NEW.player_name),'') IS NULL THEN
  metadata:=floor_private.tournament_entry_display_v1(
   NEW.entry_id,NEW.player_id,NEW.tournament_id,NEW.entry_number);
  IF NULLIF(pg_catalog.btrim(NEW.player_name),'') IS NULL THEN
   NEW.player_name:=COALESCE(metadata->>'player_name',NEW.player_name); END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION floor_private.preserve_tournament_seat_display_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.preserve_tournament_seat_display_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_tournament_seat_display_preserve_v1
 BEFORE INSERT ON public.tournament_seats FOR EACH ROW
 EXECUTE FUNCTION floor_private.preserve_tournament_seat_display_v1();

-- Forward-only reader patches. Pins are CR-normalized prosrc MD5, verified on
-- live and intact local chain31. Exact single-occurrence replacements retain
-- every existing scope/actor/session/epoch check, signature, owner and ACL.
DO $readers$
DECLARE r record; fn regprocedure; definition text; rewritten text; proc pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)',
   'f324438898630a3cab8df1cbdd152615',
   $old$      assigned_by,
      assigned_at
    ) VALUES ($old$,
   $new$      assigned_by,
      assigned_at, player_name, avatar_url
    ) VALUES ($new$,
   $old$      pg_catalog.now()
    )
    RETURNING id INTO v_new_seat_id;$old$,
   $new$      pg_catalog.now(), v_source_seat.player_name, v_source_seat.avatar_url
    )
    RETURNING id INTO v_new_seat_id;$new$),
  ('floor_private.floor_apply_tracker_moves_after_hand_v1()',
   '94615bcb3783bb495dd5e1810de12415',
   $old$        is_active, entry_id, status, assigned_by, assigned_at
      ) VALUES ($old$,
   $new$        is_active, entry_id, status, assigned_by, assigned_at, player_name, avatar_url
      ) VALUES ($new$,
   $old$        true, v_entry.id, 'active', v_move.requested_by, pg_catalog.now()
      ) RETURNING id INTO v_new_seat_id;$old$,
   $new$        true, v_entry.id, 'active', v_move.requested_by, pg_catalog.now(), v_seat.player_name, v_seat.avatar_url
      ) RETURNING id INTO v_new_seat_id;$new$),
  ('public.floor_break_table_v5(uuid,bigint,uuid,text,text)',
   'b644180a63e5f5d095b95e13666b305d',
   $old$        seat_number, chip_count, is_active, entry_id, status, assigned_by, assigned_at
      ) VALUES ($old$,
   $new$        seat_number, chip_count, is_active, entry_id, status, assigned_by, assigned_at, player_name, avatar_url
      ) VALUES ($new$,
   $old$        'active', v_actor, pg_catalog.now())
      RETURNING id INTO v_new_seat_id;$old$,
   $new$        'active', v_actor, pg_catalog.now(),
        (SELECT source.player_name FROM public.tournament_seats source WHERE source.id=v_row.source_seat_id),
        (SELECT source.avatar_url FROM public.tournament_seats source WHERE source.id=v_row.source_seat_id))
      RETURNING id INTO v_new_seat_id;$new$),
  ('public.get_floor_tournament_table_roster_v3(uuid)',
   '7e21849a9d5525b64b5910d08acb772e',
   $old$NULLIF(pg_catalog.btrim(seat_row.player_name), ''),$old$,
   $new$NULLIF(pg_catalog.btrim(seat_row.player_name), ''),
            floor_private.tournament_entry_display_v1(seat_row.entry_id,seat_row.player_id,seat_row.tournament_id,seat_row.entry_number)->>'player_name',$new$,
   NULL,NULL),
  ('public.get_floor_tournament_table_roster_v5(uuid)',
   'b56f74560f48156fb6ee2f668b7ced27',
   $old$COALESCE(NULLIF(p.display_name, ''), NULLIF(s.player_name, ''), s.player_id::text)$old$,
   $new$COALESCE(NULLIF(p.display_name, ''), NULLIF(s.player_name, ''), floor_private.tournament_entry_display_v1(s.entry_id,s.player_id,s.tournament_id,s.entry_number)->>'player_name', s.player_id::text)$new$,
   NULL,NULL),
  ('floor_private.floor_break_plan_rows_v1(uuid,uuid)',
   'c65822e0ecaad44d23436f2059459bf8',
   $old$COALESCE(NULLIF(p.display_name, ''), NULLIF(s.player_name, ''), s.player_id::text)$old$,
   $new$COALESCE(NULLIF(p.display_name, ''), NULLIF(s.player_name, ''), floor_private.tournament_entry_display_v1(s.entry_id,s.player_id,s.tournament_id,s.entry_number)->>'player_name', s.player_id::text)$new$,
   NULL,NULL),
  ('floor_private.tournament_participation_v1(uuid)',
   '995b184cdb355082b73af4a75521c7ae',
   $old$(SELECT q.player_name FROM public.tournament_seats q
     WHERE q.entry_id=e.id ORDER BY q.is_active DESC,q.created_at DESC,q.id LIMIT 1)$old$,
   $new$(floor_private.tournament_entry_display_v1(e.id,e.player_id,e.tournament_id,e.entry_no)->>'player_name')$new$,
   $old$'player_name',s.player_name,'avatar_url',s.avatar_url$old$,
   $new$'player_name',COALESCE(NULLIF(pg_catalog.btrim(s.player_name),''),floor_private.tournament_entry_display_v1(s.entry_id,s.player_id,s.tournament_id,s.entry_number)->>'player_name',s.player_name),'avatar_url',s.avatar_url$new$),
  ('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)',
   'de13e84ac47f4fb4638b40e0b21b3c37',
   $old$'seat',to_jsonb(q),$old$,
   $new$'seat',CASE WHEN q.id IS NULL THEN NULL ELSE to_jsonb(q)||jsonb_build_object('player_name',COALESCE(NULLIF(pg_catalog.btrim(q.player_name),''),floor_private.tournament_entry_display_v1(q.entry_id,q.player_id,q.tournament_id,q.entry_number)->>'player_name',q.player_name)) END,$new$,
   NULL,NULL)
 ) changes(signature,expected_md5,old_text,new_text,old_text_2,new_text_2)
 LOOP
  fn:=to_regprocedure(r.signature);
  SELECT * INTO proc FROM pg_proc WHERE oid=fn;
  IF fn IS NULL OR md5(replace(proc.prosrc,E'\r','')) IS DISTINCT FROM r.expected_md5
   OR pg_get_userbyid(proc.proowner)<>'postgres' OR NOT proc.prosecdef
   OR proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
   RAISE EXCEPTION 'seat_display_reader_drift: %',r.signature; END IF;
  definition:=replace(pg_get_functiondef(fn),E'\r','');
  IF length(definition)-length(replace(definition,r.old_text,''))<>length(r.old_text) THEN
   RAISE EXCEPTION 'seat_display_reader_patch_not_unique: %',r.signature; END IF;
  rewritten:=replace(definition,r.old_text,r.new_text);
  IF r.old_text_2 IS NOT NULL THEN
   IF length(rewritten)-length(replace(rewritten,r.old_text_2,''))<>length(r.old_text_2) THEN
    RAISE EXCEPTION 'seat_display_reader_second_patch_not_unique: %',r.signature; END IF;
   rewritten:=replace(rewritten,r.old_text_2,r.new_text_2);
  END IF;
  EXECUTE rewritten;
 END LOOP;
END;
$readers$;
COMMIT;
