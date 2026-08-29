-- ============================================================================
-- P1 Dealer Swing: reject any live binding to a checked-out attendance.
--
-- 20261240000001 makes cleanup re-check existing bindings after it locks an
-- attendance row. That closes assignment-first races. This trigger closes the
-- inverse order: cleanup may hold the attendance lock first, check it out, and
-- only then let a waiting writer resume. Foreign keys only prove the parent row
-- still exists; they do not prove that it remains a live dealer attendance.
--
-- This is a shared DB backstop for every writer, including SECURITY DEFINER
-- RPCs and service-role Edge writes. It applies only to an unreleased canonical
-- binding: assigned, on_break, or reserved. It locks all referenced attendance
-- rows in UUID order, then requires checked_in + no checkout timestamp + a
-- known working state. Writers that start after cleanup therefore wake up,
-- observe checked_out, and fail instead of re-binding the dealer.
--
-- Canonical lock order at this sink is attendance UUID ascending. Existing
-- assignment RPCs already lock their candidate attendance before writing; the
-- re-entrant row lock is safe. cleanup_stale_attendance never locks assignment
-- rows, so there is no attendance <-> assignment lock cycle.
--
-- SOURCE-ONLY. Do not apply with db push. Owner-gated controlled apply only.
-- Rollback: owner contains the cleanup cron, then ships a new forward migration
-- that drops this trigger/function after a replacement invariant is verified.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_live_dealer_assignment_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_expected_attendances integer := 0;
  v_locked_attendances   integer := 0;
  v_attendance           record;
BEGIN
  -- Historical/released rows are not live bindings. Their references remain
  -- valid audit history and must not be blocked by this operational guard.
  IF NEW.released_at IS NOT NULL
     OR NEW.status NOT IN ('assigned', 'on_break', 'reserved') THEN
    RETURN NEW;
  END IF;

  IF NEW.attendance_id IS NULL THEN
    RAISE EXCEPTION 'DEALER_ASSIGNMENT_BINDING_ATTENDANCE_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  v_expected_attendances := 1;
  IF NEW.pre_assigned_attendance_id IS NOT NULL
     AND NEW.pre_assigned_attendance_id IS DISTINCT FROM NEW.attendance_id THEN
    v_expected_attendances := 2;
  END IF;

  -- One ordered locking query prevents a writer that touches both the seated
  -- and incoming dealer from taking those two attendance locks in reverse order.
  FOR v_attendance IN
    SELECT attendance.id,
           attendance.status,
           attendance.current_state,
           attendance.check_out_time
    FROM public.dealer_attendance AS attendance
    WHERE attendance.id = ANY (
      ARRAY[NEW.attendance_id, NEW.pre_assigned_attendance_id]::uuid[]
    )
    ORDER BY attendance.id
    FOR UPDATE
  LOOP
    v_locked_attendances := v_locked_attendances + 1;

    IF v_attendance.status IS DISTINCT FROM 'checked_in'
       OR v_attendance.check_out_time IS NOT NULL
       OR v_attendance.current_state IS NULL
       OR v_attendance.current_state NOT IN (
         'available', 'assigned', 'on_break', 'pre_assigned', 'in_transition'
       ) THEN
      RAISE EXCEPTION
        'DEALER_ASSIGNMENT_BINDING_ATTENDANCE_NOT_LIVE: %',
        v_attendance.id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_locked_attendances <> v_expected_attendances THEN
    RAISE EXCEPTION 'DEALER_ASSIGNMENT_BINDING_ATTENDANCE_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_live_dealer_assignment_binding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_live_dealer_assignment_binding() TO service_role;

-- Trigger names run alphabetically within the same BEFORE row event. This name
-- deliberately runs before the existing pool-seat trigger, so a dead
-- attendance is rejected before any pool/override side effect is consumed.
DROP TRIGGER IF EXISTS trg_dealer_assignments_binding_liveness
  ON public.dealer_assignments;

CREATE TRIGGER trg_dealer_assignments_binding_liveness
BEFORE INSERT OR UPDATE OF attendance_id,
                           pre_assigned_attendance_id,
                           status,
                           released_at
ON public.dealer_assignments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_live_dealer_assignment_binding();

COMMENT ON FUNCTION public.enforce_live_dealer_assignment_binding() IS
  'P1 backstop: an unreleased assigned/on_break/reserved dealer binding may reference only a checked-in, not-checked-out working attendance. Locks attendance rows in UUID order.';

COMMIT;
