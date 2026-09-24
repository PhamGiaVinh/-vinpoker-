-- Forward-only compatibility for the deployed record_hand writer. V3 explicit
-- tournament_table_id/table_session_id remain authoritative; the legacy IDs
-- below are derived projections for Tracker and older read consumers.
-- No existing business row is rewritten by this migration.
-- ROLLBACK: leave the UI flag OFF and use a reviewed forward migration to drop
-- these three triggers/functions after all Tracker readers use explicit IDs.
BEGIN;

CREATE OR REPLACE FUNCTION floor_private.floor_v3_project_legacy_table_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.game_table_id IS NULL OR NEW.table_session_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.table_sessions s
    WHERE s.id = NEW.table_session_id
      AND s.game_table_id = NEW.game_table_id
      AND s.tournament_id = NEW.tournament_id
      AND s.session_type = 'tournament'
      AND s.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'table_session_mismatch';
  END IF;
  IF NEW.table_id IS NOT NULL AND NEW.table_id IS DISTINCT FROM NEW.game_table_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'legacy_game_table_mismatch';
  END IF;
  NEW.table_id := NEW.game_table_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.floor_v3_project_legacy_table_on_insert()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_floor_v3_project_legacy_table_on_insert ON public.tournament_tables;
CREATE TRIGGER trg_floor_v3_project_legacy_table_on_insert
BEFORE INSERT ON public.tournament_tables
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_v3_project_legacy_table_on_insert();

CREATE OR REPLACE FUNCTION floor_private.floor_v3_project_legacy_seat_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.is_active OR NEW.tournament_table_id IS NULL
     OR NEW.table_session_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tournament_tables tt
    WHERE tt.id = NEW.tournament_table_id
      AND tt.tournament_id = NEW.tournament_id
      AND tt.table_session_id = NEW.table_session_id
      AND tt.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'seat_table_session_mismatch';
  END IF;
  -- tournament_seats.table_id is the historical assignment ID, not the
  -- physical game_table ID used by tournament_tables.table_id.
  NEW.table_id := NEW.tournament_table_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.floor_v3_project_legacy_seat_on_insert()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_floor_v3_project_legacy_seat_on_insert ON public.tournament_seats;
CREATE TRIGGER trg_floor_v3_project_legacy_seat_on_insert
BEFORE INSERT ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_v3_project_legacy_seat_on_insert();

CREATE OR REPLACE FUNCTION floor_private.floor_v3_project_legacy_entry_on_seat_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_game_table_id uuid;
BEGIN
  IF NOT NEW.is_active OR NEW.tournament_table_id IS NULL
     OR NEW.table_session_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT tt.game_table_id INTO v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = NEW.tournament_table_id
    AND tt.tournament_id = NEW.tournament_id
    AND tt.table_session_id = NEW.table_session_id;
  IF v_game_table_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'seat_game_table_missing';
  END IF;
  UPDATE public.tournament_entries e
  SET table_id = v_game_table_id,
      seat_id = NEW.id,
      seat_number = NEW.seat_number,
      updated_at = pg_catalog.now()
  WHERE e.id = NEW.entry_id
    AND e.tournament_id = NEW.tournament_id
    AND e.player_id = NEW.player_id
    AND e.entry_no = NEW.entry_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'seat_entry_mismatch';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.floor_v3_project_legacy_entry_on_seat_insert()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_floor_v3_project_legacy_entry_on_seat_insert ON public.tournament_seats;
CREATE TRIGGER trg_floor_v3_project_legacy_entry_on_seat_insert
AFTER INSERT ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_v3_project_legacy_entry_on_seat_insert();

COMMIT;
