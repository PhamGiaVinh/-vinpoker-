-- Forward-only automatic execute-time rest fence. No attendance/payroll history repair.
-- Uses the same 15-minute execute floor as migration 23 and current Swing policy.
-- Planning reserved/pre_assigned rows is not execution. Authorized manual intent is unchanged.
-- ROLLBACK: keep auto Swing OFF; drop only guard_dealer_automatic_rest_history_v1.
-- Preserve every assignment, receipt and ledger. Requires migrations 22 and 23.
BEGIN;
CREATE OR REPLACE FUNCTION floor_private.guard_dealer_automatic_rest_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_acquiring boolean; v_headers jsonb; v_marker timestamptz; v_actual timestamptz; v_active boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'assigned' OR NEW.released_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN v_acquiring:=true;
  ELSE
    v_acquiring:=OLD.status IS DISTINCT FROM 'assigned' OR OLD.released_at IS NOT NULL
      OR ROW(NEW.attendance_id,NEW.table_id,NEW.table_session_id,NEW.club_id)
        IS DISTINCT FROM ROW(OLD.attendance_id,OLD.table_id,OLD.table_session_id,OLD.club_id);
    -- Filling a NULL denormalized dealer_id for the SAME attendance is not new work.
  END IF;
  IF NOT v_acquiring THEN RETURN NEW; END IF;
  -- Verify manual authority before deciding whether the existing manual override applies.
  PERFORM floor_private.assert_dealer_acquisition_intent(NEW.club_id);
  v_headers:=COALESCE(NULLIF(pg_catalog.current_setting('request.headers',true),''),'{}')::jsonb;
  IF auth.role()='authenticated' OR v_headers->>'x-vinpoker-dealer-intent'='manual' THEN RETURN NEW; END IF;
  SELECT a.last_released_at INTO v_marker FROM public.dealer_attendance a
    JOIN public.dealers d ON d.id=a.dealer_id
    WHERE a.id=NEW.attendance_id AND a.dealer_id=NEW.dealer_id AND d.club_id=NEW.club_id
    AND a.status='checked_in' AND a.check_out_time IS NULL FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEALER_REST_ATTENDANCE_UNVERIFIED'; END IF;
  -- A legacy release writer may have left last_released_at stale or NULL.
  SELECT max(a.released_at) FILTER(WHERE a.status='completed' AND a.released_at IS NOT NULL),
    COALESCE(bool_or(a.released_at IS NULL AND a.status IN ('assigned','on_break','in_transition')),false)
    INTO v_actual,v_active FROM public.dealer_assignments a
    WHERE a.attendance_id=NEW.attendance_id AND a.dealer_id=NEW.dealer_id
      AND a.club_id=NEW.club_id AND a.id IS DISTINCT FROM NEW.id;
  -- A release in another transaction is either still active in this snapshot or
  -- already a fresh release. Never wait on/lock history rows after attendance.
  IF v_active THEN RAISE EXCEPTION 'DEALER_REST_ACTIVE_ASSIGNMENT'; END IF;
  IF GREATEST(v_marker,v_actual)>pg_catalog.now()-interval '15 minutes' THEN
    RAISE EXCEPTION 'DEALER_REST_REQUIRED';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.guard_dealer_automatic_rest_history() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS guard_dealer_automatic_rest_history_v1 ON public.dealer_assignments;
CREATE TRIGGER guard_dealer_automatic_rest_history_v1 BEFORE INSERT OR UPDATE ON public.dealer_assignments
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_automatic_rest_history();
COMMIT;
