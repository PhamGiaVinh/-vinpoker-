-- CLI-created20261010092216, reserved forward47 after catalog/live36 check.
-- Reconcile only exact, positively bound attendance on a newly closed session.
-- No historical backfill, rest/payroll/checkout calculation or public RPC grant.
-- ROLLBACK: automatic acquisition OFF; remove this trigger/function in a reviewed
-- forward migration. Preserve assignments, attendance and immutable histories.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('floor_private.reconcile_closed_session_attendance_v1()') IS NOT NULL
   OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.table_sessions'::regclass
     AND tgname='trg_reconcile_closed_session_attendance_v1') THEN
   RAISE EXCEPTION 'closed_session_attendance_object_collision';
 END IF;
END $$;
CREATE FUNCTION floor_private.reconcile_closed_session_attendance_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attendance_row public.dealer_attendance%ROWTYPE;
BEGIN
 IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_assignments a
   LEFT JOIN public.dealer_attendance dat ON dat.id=a.attendance_id
   LEFT JOIN public.dealers d ON d.id=dat.dealer_id
   WHERE a.table_session_id=NEW.id AND
     (a.club_id IS DISTINCT FROM NEW.club_id OR a.table_id IS DISTINCT FROM NEW.game_table_id
      OR dat.id IS NULL OR a.dealer_id IS DISTINCT FROM dat.dealer_id
      OR d.club_id IS DISTINCT FROM NEW.club_id OR a.released_at IS NULL)) THEN
   RAISE EXCEPTION 'closed_session_dealer_context_invalid';
 END IF;
 -- The caller already holds physical/session locks. Acquire attendance in UUID
 -- order, matching assignment writers' physical/session -> attendance order.
 FOR attendance_row IN SELECT dat.* FROM public.dealer_attendance dat
   WHERE EXISTS(SELECT 1 FROM public.dealer_assignments a
     WHERE a.table_session_id=NEW.id AND a.attendance_id=dat.id AND a.released_at IS NOT NULL)
   ORDER BY dat.id FOR UPDATE LOOP
   IF attendance_row.status='checked_in' AND attendance_row.check_out_time IS NULL
     AND attendance_row.current_state='assigned'
     AND attendance_row.pre_assigned_table_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.dealer_assignments a
       WHERE a.attendance_id=attendance_row.id AND a.released_at IS NULL
         AND a.status IN ('assigned','on_break','pre_assigned','reserved')) THEN
     UPDATE public.dealer_attendance SET current_state='available'
       WHERE id=attendance_row.id AND current_state='assigned';
   END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
ALTER FUNCTION floor_private.reconcile_closed_session_attendance_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.reconcile_closed_session_attendance_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_reconcile_closed_session_attendance_v1
AFTER UPDATE OF closed_at ON public.table_sessions FOR EACH ROW
WHEN (OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL)
EXECUTE FUNCTION floor_private.reconcile_closed_session_attendance_v1();
COMMIT;
