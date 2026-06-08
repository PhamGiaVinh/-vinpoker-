-- Phase 5 PR #4: canary_health_check + swing_operations_summary RPCs
-- Provides monitoring/observability for canary verification

-- ═══ canary_health_check: comprehensive health snapshot ═══
CREATE OR REPLACE FUNCTION public.canary_health_check(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'club_id', p_club_id,
    'timestamp', now(),
    'dealers', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'available', COUNT(*) FILTER (WHERE da.current_state = 'available'),
        'assigned', COUNT(*) FILTER (WHERE da.current_state = 'assigned'),
        'on_break', COUNT(*) FILTER (WHERE da.current_state = 'on_break'),
        'pre_assigned', COUNT(*) FILTER (WHERE da.current_state = 'pre_assigned'),
        'checked_out', COUNT(*) FILTER (WHERE da.current_state = 'checked_out')
      )
      FROM dealer_attendance da
      JOIN dealers d ON d.id = da.dealer_id
      WHERE d.club_id = p_club_id
    ),
    'assignments', (
      SELECT jsonb_build_object(
        'active', COUNT(*) FILTER (WHERE status = 'assigned'),
        'completed', COUNT(*) FILTER (WHERE status = 'completed'),
        'on_break', COUNT(*) FILTER (WHERE status = 'on_break'),
        'swing_in_progress', COUNT(*) FILTER (WHERE swing_in_progress = true),
        'overdue_5min', COUNT(*) FILTER (
          WHERE status = 'assigned' 
            AND released_at IS NULL 
            AND swing_due_at < now() - interval '5 minutes'
        ),
        'overdue_30min', COUNT(*) FILTER (
          WHERE status = 'assigned' 
            AND released_at IS NULL 
            AND swing_due_at < now() - interval '30 minutes'
        ),
        'in_overtime', COUNT(*) FILTER (
          WHERE status = 'assigned' AND overtime_started_at IS NOT NULL
        )
      )
      FROM dealer_assignments
      WHERE club_id = p_club_id
    ),
    'pre_announce_queue', (
      SELECT jsonb_build_object(
        'pending', COUNT(*) FILTER (WHERE status = 'pending'),
        'processing', COUNT(*) FILTER (WHERE status = 'processing'),
        'sent', COUNT(*) FILTER (WHERE status = 'sent'),
        'failed', COUNT(*) FILTER (WHERE status = 'failed'),
        'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled')
      )
      FROM pre_announce_jobs
      WHERE club_id = p_club_id
    ),
    'tables', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'active', COUNT(*) FILTER (WHERE status = 'active'),
        'idle', COUNT(*) FILTER (WHERE status = 'idle'),
        'closed', COUNT(*) FILTER (WHERE status = 'closed')
      )
      FROM game_tables
      WHERE club_id = p_club_id
    ),
    'escalation_config', (
      SELECT to_jsonb(sec)
      FROM swing_escalation_config sec
      WHERE sec.club_id = p_club_id
    ),
    'available_dealer_count', public.count_available_dealers(p_club_id)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ═══ swing_operations_summary: recent swing activity ═══
CREATE OR REPLACE FUNCTION public.swing_operations_summary(
  p_club_id uuid,
  p_hours_back int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
  v_recent_diagnostics jsonb;
BEGIN
  SELECT jsonb_agg(sub.q ORDER BY sub.created_at DESC)
  INTO v_recent_diagnostics
  FROM (
    SELECT jsonb_build_object(
      'type', dl.diagnostic_type,
      'result', dl.result,
      'created_at', dl.created_at
    ) AS q, dl.created_at
    FROM diagnostic_logs dl
    WHERE dl.club_id = p_club_id
      AND dl.created_at > now() - (p_hours_back || ' hours')::interval
    ORDER BY dl.created_at DESC
    LIMIT 10
  ) sub;

  SELECT jsonb_build_object(
    'club_id', p_club_id,
    'period_hours', p_hours_back,
    'timestamp', now(),
    'swings_completed', (
      SELECT COUNT(*)
      FROM dealer_assignments
      WHERE club_id = p_club_id
        AND status = 'assigned'
        AND swing_processed_at IS NOT NULL
        AND swing_processed_at > now() - (p_hours_back || ' hours')::interval
    ),
    'swings_overdue_now', (
      SELECT COUNT(*)
      FROM dealer_assignments
      WHERE club_id = p_club_id
        AND status = 'assigned'
        AND released_at IS NULL
        AND swing_due_at < now()
    ),
    'overtime_dealers', (
      SELECT jsonb_agg(jsonb_build_object(
        'assignment_id', da.id,
        'table_name', gt.table_name,
        'dealer_name', d.full_name,
        'overtime_minutes', ROUND(EXTRACT(EPOCH FROM (now() - da.overtime_started_at))/60),
        'swing_due_at', da.swing_due_at
      ) ORDER BY da.overtime_started_at ASC)
      FROM dealer_assignments da
      JOIN game_tables gt ON gt.id = da.table_id
      JOIN dealer_attendance da2 ON da2.id = da.attendance_id
      JOIN dealers d ON d.id = da2.dealer_id
      WHERE da.club_id = p_club_id
        AND da.status = 'assigned'
        AND da.overtime_started_at IS NOT NULL
        AND da.released_at IS NULL
    ),
    'recent_diagnostics', COALESCE(v_recent_diagnostics, '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.canary_health_check(uuid) IS
  'Phase 5 PR #4: Returns comprehensive health snapshot for a club.
   Includes dealer states, assignment stats, pre-announce queue, tables, escalation config, available count.';
COMMENT ON FUNCTION public.swing_operations_summary(uuid, int) IS
  'Phase 5 PR #4: Returns recent swing activity summary for a club.
   Shows completed swings, overdue count, overtime dealers, and recent diagnostic logs.';