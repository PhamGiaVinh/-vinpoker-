-- Forward-only automatic execute-time rest fence. No attendance/payroll history repair.
-- Uses the same 15-minute execute floor as migration 23 and current Swing policy.
-- Planning reserved/pre_assigned rows is not execution. Authorized manual intent is unchanged.
-- ROLLBACK: keep auto Swing OFF; drop only guard_dealer_automatic_rest_history_v1.
-- Preserve every assignment, receipt and ledger. Requires migrations 22 and 23.
BEGIN;
CREATE OR REPLACE FUNCTION floor_private.guard_dealer_automatic_rest_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_acquiring boolean; v_headers jsonb; v_marker timestamptz; v_actual timestamptz; v_active boolean; v_dealer uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Tag only the observed on-break -> completed housekeeping transition,
    -- with an audited break that started no earlier than that lifecycle state.
    -- A former break on a resumed assignment must never shorten a later rest.
    IF OLD.status='on_break' AND OLD.released_at IS NULL
      AND NEW.status='completed' AND NEW.released_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.dealer_breaks b WHERE b.assignment_id=OLD.id
        AND b.break_start>=COALESCE(OLD.updated_at,OLD.assigned_at)
        AND b.break_start<=NEW.released_at) THEN
      NEW.release_reason:='rest_history_verified_break_cleanup_v1';
    ELSIF NEW.status='assigned' OR (NEW.status='completed' AND OLD.status<>'on_break') THEN
      IF NEW.release_reason='rest_history_verified_break_cleanup_v1' THEN NEW.release_reason:=NULL; END IF;
    END IF;
  END IF;
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
  -- Automatic acquisition must create a new lifecycle, never resurrect a release.
  IF TG_OP='UPDATE' AND OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEALER_REST_RELEASED_ASSIGNMENT_REUSE';
  END IF;
  SELECT a.last_released_at,a.dealer_id INTO v_marker,v_dealer FROM public.dealer_attendance a
    JOIN public.dealers d ON d.id=a.dealer_id
    WHERE a.id=NEW.attendance_id AND (NEW.dealer_id IS NULL OR a.dealer_id=NEW.dealer_id) AND d.club_id=NEW.club_id
    AND a.status='checked_in' AND a.check_out_time IS NULL FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEALER_REST_ATTENDANCE_UNVERIFIED'; END IF;
  -- A legacy release writer may have left last_released_at stale or NULL.
  -- A canonical break record proves when work stopped. Later cleanup of an
  -- on_break assignment is housekeeping, not a new end of work/rest clock.
  SELECT max(CASE WHEN a.release_reason='rest_history_verified_break_cleanup_v1'
    THEN COALESCE(b.work_ended_at,a.released_at) ELSE a.released_at END)
    FILTER(WHERE a.status='completed' AND a.released_at IS NOT NULL),
    COALESCE(bool_or(a.released_at IS NULL AND a.status IN ('assigned','on_break','in_transition')),false)
    INTO v_actual,v_active FROM public.dealer_assignments a
    LEFT JOIN LATERAL (
      SELECT max(db.break_start) AS work_ended_at FROM public.dealer_breaks db
      WHERE db.assignment_id=a.id AND db.break_start>=a.assigned_at
        AND db.break_start<=a.released_at
    ) b ON true
    WHERE a.attendance_id=NEW.attendance_id AND (a.dealer_id IS NULL OR a.dealer_id=v_dealer)
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
