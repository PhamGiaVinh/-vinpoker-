-- ============================================================================
-- PATCH 4 / STAGE A — floor_bust_syncs_entry HEADLESS TEST.
-- One-paste, self-contained, BEGIN…ROLLBACK → NOTHING saved. Requires migration
-- 20261121000000_floor_bust_syncs_entry.sql applied. Proves: a floor bust mirrors
-- entry.status='busted'; a MOVE does not; a null-entry_id seat falls back by player;
-- and a FORCED entry-sync error is swallowed so the floor's seat UPDATE still commits (P0-2).
--
-- ⚠️ Paste and run the WHOLE block at once so the final ROLLBACK executes (runs on the
--    production DB; fake ids fb5…/fb6… do not collide with real rows).
-- ============================================================================
BEGIN;

DROP TABLE IF EXISTS _fb_results;
CREATE TEMP TABLE _fb_results (case_no int, scenario text, expected text, actual text);

DO $$
DECLARE
  v_club  uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e5 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s5 uuid;
  v_st text; v_bz timestamptz; v_seat_active boolean;
BEGIN
  SELECT id INTO v_club FROM public.clubs ORDER BY created_at, id LIMIT 1;
  IF v_club IS NULL THEN RAISE EXCEPTION 'FB-SBX: no club to host the test'; END IF;

  -- graph: tournament + game_table (tournament_entries.player_id / tournament_seats.player_id have NO FK)
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time) VALUES
    ('fb500000-0000-0000-0000-000000000001', v_club, '[FBSBX] floor-bust-sync', 'active', 10000, 100000, now()+interval '1 day');
  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('fb500000-0000-0000-0000-0000000000a1', v_club, '[FBSBX] table');

  -- three seated entries, three active seats. Players fb6…1/2/3.
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('fb500000-0000-0000-0000-0000000000e1','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000001',1,'seated',10000),
    ('fb500000-0000-0000-0000-0000000000e2','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000002',1,'seated',10000),
    ('fb500000-0000-0000-0000-0000000000e3','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000003',1,'seated',10000),
    ('fb500000-0000-0000-0000-0000000000e5','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000005',1,'seated',10000);
  v_e1 := 'fb500000-0000-0000-0000-0000000000e1';
  v_e2 := 'fb500000-0000-0000-0000-0000000000e2';
  v_e3 := 'fb500000-0000-0000-0000-0000000000e3';
  v_e5 := 'fb500000-0000-0000-0000-0000000000e5';

  INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status, entry_id) VALUES
    ('fb500000-0000-0000-0000-0000000000s1','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000001',1,'fb500000-0000-0000-0000-0000000000a1',1,10000,true,'active','fb500000-0000-0000-0000-0000000000e1'),
    ('fb500000-0000-0000-0000-0000000000s2','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000002',1,'fb500000-0000-0000-0000-0000000000a1',2,10000,true,'active','fb500000-0000-0000-0000-0000000000e2'),
    -- s3 has a NULL entry_id (legacy seat) → exercises the player-fallback branch
    ('fb500000-0000-0000-0000-0000000000s3','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000003',1,'fb500000-0000-0000-0000-0000000000a1',3,10000,true,'active',NULL),
    ('fb500000-0000-0000-0000-0000000000s5','fb500000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000005',1,'fb500000-0000-0000-0000-0000000000a1',5,10000,true,'active','fb500000-0000-0000-0000-0000000000e5');
  v_s1 := 'fb500000-0000-0000-0000-0000000000s1';
  v_s2 := 'fb500000-0000-0000-0000-0000000000s2';
  v_s3 := 'fb500000-0000-0000-0000-0000000000s3';
  v_s5 := 'fb500000-0000-0000-0000-0000000000s5';

  -- CASE 1 — genuine floor bust (entry_id link): free the seat → entry must become 'busted' + busted_at set.
  UPDATE public.tournament_seats SET is_active = false WHERE id = v_s1;
  SELECT status, busted_at INTO v_st, v_bz FROM public.tournament_entries WHERE id = v_e1;
  INSERT INTO _fb_results VALUES (1, 'floor bust (entry_id) → entry busted',
    'busted + busted_at set', format('%s + busted_at %s', v_st, CASE WHEN v_bz IS NULL THEN 'NULL' ELSE 'set' END));

  -- CASE 2 — MOVE (is_active=false BUT status='moved'): WHEN clause excludes it → entry stays 'seated'.
  UPDATE public.tournament_seats SET is_active = false, status = 'moved' WHERE id = v_s2;
  SELECT status INTO v_st FROM public.tournament_entries WHERE id = v_e2;
  INSERT INTO _fb_results VALUES (2, 'move (status=moved) → entry NOT busted', 'seated', v_st);

  -- CASE 3 — null-entry_id seat → player fallback busts the seated entry (and proves no raise on null path).
  UPDATE public.tournament_seats SET is_active = false WHERE id = v_s3;
  SELECT status INTO v_st FROM public.tournament_entries WHERE id = v_e3;
  INSERT INTO _fb_results VALUES (3, 'null entry_id bust → player fallback busts entry', 'busted', v_st);

  -- CASE 4 — no-raise (P0-2): re-bust an already-busted entry's seat (0 rows matched, no error) +
  -- the fact that we reached here at all proves the AFTER trigger never raised on any case above.
  UPDATE public.tournament_seats SET is_active = true,  status = 'active' WHERE id = v_s1;  -- reactivate
  UPDATE public.tournament_seats SET is_active = false WHERE id = v_s1;                      -- bust again
  INSERT INTO _fb_results VALUES (4, 'trigger never raised (P0-2)', 'reached verdict, no exception', 'reached verdict, no exception');

  -- CASE 5 — FORCED sync error (P0-2): a temp raising trigger on tournament_entries makes the entry UPDATE
  -- inside floor_bust_sync_entry throw; floor_bust swallows it → the floor's seat UPDATE still commits and the
  -- entry is NOT busted (sync skipped, no data harm). (Briefly DDL-locks tournament_entries inside this
  -- BEGIN…ROLLBACK — controlled-session only.)
  CREATE OR REPLACE FUNCTION public._fb_force_raise() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'FBSBX forced sync error'; END; $f$;
  CREATE TRIGGER _fb_force_raise_trg BEFORE UPDATE ON public.tournament_entries
    FOR EACH ROW EXECUTE FUNCTION public._fb_force_raise();
  UPDATE public.tournament_seats SET is_active = false WHERE id = v_s5;  -- entry-sync throws → swallowed
  DROP TRIGGER _fb_force_raise_trg ON public.tournament_entries;
  SELECT is_active INTO v_seat_active FROM public.tournament_seats WHERE id = v_s5;
  SELECT status INTO v_st FROM public.tournament_entries WHERE id = v_e5;
  INSERT INTO _fb_results VALUES (5, 'forced sync error → seat freed, entry NOT busted',
    'seat=false + seated', format('seat=%s + %s', v_seat_active, v_st));
END $$;

SELECT case_no, scenario, expected, actual,
       CASE WHEN actual = expected
              OR (case_no = 1 AND actual = 'busted + busted_at set')
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM _fb_results ORDER BY case_no;

ROLLBACK;
