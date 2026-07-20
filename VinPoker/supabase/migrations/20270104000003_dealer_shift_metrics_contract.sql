-- 20270104000003_dealer_shift_metrics_contract.sql
-- Restores the canonical Dealer Swing metrics read model omitted from the
-- forward Drift migration. This is additive/forward-only: do not replay the
-- historical view migrations that bundled unrelated break behavior. The
-- definition follows 20260805000000's attendance-first break semantics, not
-- 20260701000010's historical maintenance migration.
--
-- ROLLBACK: restore the pre-apply view definition captured in the controlled
-- rollout backup. Do not use DROP ... CASCADE.

BEGIN;

-- The attendance-first predicate covers both assignment-linked and manual
-- pool breaks exactly once. `attendance_id` is populated for new rows and is
-- derived through the assignment join for legacy rows.
CREATE OR REPLACE VIEW public.dealer_shift_metrics AS
SELECT
  da.id AS attendance_id,
  da.dealer_id,
  d.full_name,
  d.tier,
  d.skills,
  da.shift_date,
  da.current_state,
  da.priority_break_flag,
  da.worked_minutes_since_last_break,
  da.total_worked_minutes_today,
  da.status,
  COALESCE((
    SELECT SUM(
      EXTRACT(EPOCH FROM (COALESCE(db.break_end, NOW()) - db.break_start)) / 60
    )
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments db_assign ON db_assign.id = db.assignment_id
    WHERE COALESCE(db.attendance_id, db_assign.attendance_id) = da.id
  ), 0::numeric)::INTEGER AS total_break_minutes,
  (
    SELECT MAX(db.break_end)
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments db_assign ON db_assign.id = db.assignment_id
    WHERE COALESCE(db.attendance_id, db_assign.attendance_id) = da.id
  ) AS last_break_end,
  (
    SELECT MAX(db.break_start)
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments db_assign ON db_assign.id = db.assignment_id
    WHERE COALESCE(db.attendance_id, db_assign.attendance_id) = da.id
  ) AS last_break_start,
  EXTRACT(EPOCH FROM (
    NOW() - COALESCE(
      (
        SELECT MAX(dassign.released_at)
        FROM public.dealer_assignments dassign
        WHERE dassign.attendance_id = da.id
          AND dassign.released_at IS NOT NULL
      ),
      da.check_in_time,
      NOW()
    )
  )) / 60::numeric AS minutes_since_rest,
  (
    SELECT COUNT(*)
    FROM public.dealer_assignments dassign
    WHERE dassign.attendance_id = da.id
      AND dassign.released_at IS NOT NULL
  )::INTEGER AS total_assignments,
  (
    SELECT dassign.table_id
    FROM public.dealer_assignments dassign
    WHERE dassign.attendance_id = da.id
      AND dassign.released_at IS NOT NULL
    ORDER BY dassign.released_at DESC
    LIMIT 1
  ) AS last_table_id,
  da.pre_assigned_table_id,
  da.pre_assigned_at,
  da.created_at,
  da.updated_at,
  d.club_id,
  d.status AS dealer_status,
  da.total_worked_minutes_today AS total_worked_minutes
FROM public.dealer_attendance da
JOIN public.dealers d ON d.id = da.dealer_id
WHERE da.status = 'checked_in';

-- Only Edge/service access is an active consumer. A view is not a client API.
REVOKE ALL ON TABLE public.dealer_shift_metrics FROM PUBLIC;
REVOKE ALL ON TABLE public.dealer_shift_metrics FROM anon, authenticated;
GRANT SELECT ON TABLE public.dealer_shift_metrics TO service_role;

COMMIT;
