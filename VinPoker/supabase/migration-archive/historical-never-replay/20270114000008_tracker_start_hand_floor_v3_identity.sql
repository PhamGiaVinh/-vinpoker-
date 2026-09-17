-- Bind new Tracker hands to the authoritative Floor V3 table/session identity.
-- The existing start_hand RPC keeps its public signature and poker behavior.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.tournament_hands') IS NULL
     OR pg_catalog.to_regclass('public.tournament_tables') IS NULL
     OR pg_catalog.to_regclass('public.table_sessions') IS NULL
  THEN
    RAISE EXCEPTION 'tracker_start_hand_floor_v3_dependency_missing'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION floor_private.bind_tracker_hand_floor_v3_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_identity RECORD;
BEGIN
  SELECT
    table_row.id AS tournament_table_id,
    session_row.id AS table_session_id
  INTO v_identity
  FROM public.tournament_tables table_row
  JOIN public.table_sessions session_row
    ON session_row.id = table_row.table_session_id
  WHERE table_row.id = NEW.table_id
    AND table_row.tournament_id = NEW.tournament_id
    AND table_row.status = 'active'
    AND session_row.tournament_id = NEW.tournament_id
    AND session_row.session_type = 'tournament'
    AND session_row.closed_at IS NULL;

  IF FOUND THEN
    NEW.tournament_table_id := v_identity.tournament_table_id;
    NEW.table_session_id := v_identity.table_session_id;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.bind_tracker_hand_floor_v3_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.bind_tracker_hand_floor_v3_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_bind_tracker_hand_floor_v3_identity
  ON public.tournament_hands;
CREATE TRIGGER trg_bind_tracker_hand_floor_v3_identity
  BEFORE INSERT ON public.tournament_hands
  FOR EACH ROW
  EXECUTE FUNCTION floor_private.bind_tracker_hand_floor_v3_identity();

COMMENT ON FUNCTION floor_private.bind_tracker_hand_floor_v3_identity() IS
  'Binds new Tracker hands to the active tournament table and Floor V3 session without changing start_hand ABI or poker semantics.';

COMMIT;
