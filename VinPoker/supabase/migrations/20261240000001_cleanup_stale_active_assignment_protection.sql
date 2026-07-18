-- ============================================================================
-- P1 Dealer Swing: stale attendance must never override a live dealer binding.
--
-- Incident: 2026-07-16. Five dealers with new assignments were checked out by
-- the 13:00 Bangkok cleanup cron because their old check-ins were stale. The
-- prior #317 guard only protected assignments less than two hours overdue.
--
-- Invariant:
--   A stale attendance is never checked out, and no assignment is released,
--   while a canonical live dealer binding exists. Assignment age and
--   swing_due_at age are deliberately irrelevant.
--
-- Canonical protected binding (verified against the current schema and
-- assignment paths):
--   released_at IS NULL
--   AND status IN ('assigned', 'on_break', 'reserved')
--   AND attendance_id = stale attendance OR pre_assigned_attendance_id = it
--
-- `reserved` is not a seated/table-active assignment, but it is an unreleased
-- dealer reservation and the scheduler treats it as a live dealer binding.
-- There is no `pre_assigned` or `in_transition` assignment status in the
-- current status constraint; those are attendance states, not predicates here.
--
-- Atomicity:
--   1. Lock each stale attendance row with FOR UPDATE.
--   2. Re-check the protected-binding predicate in a subsequent UPDATE statement.
-- The assignment and pre-assignment foreign keys take a conflicting key-share
-- lock on that attendance row. The separate UPDATE gets a fresh READ COMMITTED
-- snapshot after a competing bind commits; no check-out can win after a live
-- binding exists.
--
-- Scope: same function signature, SECURITY DEFINER, search_path and tenant
-- scoping as the currently-applied #317 implementation. CREATE OR REPLACE
-- preserves the existing owner and grants; this migration deliberately changes
-- no permissions, cron schedule, data, feature flag or Edge function.
--
-- SOURCE-ONLY. Do not apply with db push. Owner-gated controlled apply only.
-- Rollback: do not re-enable the prior two-hour guard while the cron is active.
-- If a rollback is required, owner first contains the cron, then ships a new
-- forward migration after local transaction and race evidence.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_stale_attendance(
  p_club_id uuid DEFAULT NULL::uuid,
  p_stale_threshold_hours integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff        timestamptz;
  v_cleaned       integer := 0;
  v_dealer_ids    uuid[];
  v_attendance_id uuid;
  v_dealer_id     uuid;
BEGIN
  v_cutoff := now() - (p_stale_threshold_hours || ' hours')::interval;

  -- Lock each attendance before deciding that it is cleanable. The UPDATE in
  -- the loop is intentionally a separate statement: under READ COMMITTED it
  -- receives a fresh snapshot after any competing assignment commit.
  FOR v_attendance_id IN
    SELECT attendance.id
    FROM public.dealer_attendance AS attendance
    JOIN public.dealers AS dealer ON dealer.id = attendance.dealer_id
    WHERE (p_club_id IS NULL OR dealer.club_id = p_club_id)
      AND attendance.check_out_time IS NULL
      AND attendance.check_in_time < v_cutoff
      AND attendance.current_state IN ('assigned', 'pre_assigned', 'in_transition', 'on_break')
    FOR UPDATE OF attendance
  LOOP
    v_dealer_id := NULL;

    UPDATE public.dealer_attendance AS attendance
    SET current_state  = 'checked_out',
        status         = 'checked_out',
        check_out_time = attendance.check_in_time + interval '8 hours',
        updated_at     = now()
    WHERE attendance.id = v_attendance_id
      -- FINAL ATOMIC GUARD: stale attendance never wins over a live binding.
      AND NOT EXISTS (
        SELECT 1
        FROM public.dealer_assignments AS assignment
        WHERE assignment.released_at IS NULL
          AND assignment.status IN ('assigned', 'on_break', 'reserved')
          AND (
            assignment.attendance_id = attendance.id
            OR assignment.pre_assigned_attendance_id = attendance.id
          )
      )
    RETURNING attendance.dealer_id INTO v_dealer_id;

    IF FOUND THEN
      v_cleaned := v_cleaned + 1;
      v_dealer_ids := array_append(v_dealer_ids, v_dealer_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cleaned', v_cleaned,
    'dealer_ids', v_dealer_ids
  );
END;
$function$;

COMMENT ON FUNCTION public.cleanup_stale_attendance(uuid, integer) IS
  'Daily stale-attendance cleanup. P1 invariant: never checkout a dealer with an unreleased assigned, on_break, reserved, or pre-assigned live dealer binding.';
