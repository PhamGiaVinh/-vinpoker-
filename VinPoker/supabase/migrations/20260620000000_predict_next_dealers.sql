-- Migration: predict_next_dealers RPC
-- Returns next dealer prediction per active table in a single query.
-- Two-tier prediction:
--   1. CONFIRMED: pre_assigned_attendance_id exists on latest assignment
--   2. PREDICTED: most rested available dealer (longest since last rest)

CREATE OR REPLACE FUNCTION public.predict_next_dealers(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  WITH active_tables AS (
    SELECT id, table_name
    FROM game_tables
    WHERE club_id = p_club_id AND status = 'active'
  ),
  latest_assignment AS (
    SELECT DISTINCT ON (da.table_id)
      da.table_id,
      da.attendance_id,
      da.status,
      da.swing_due_at,
      da.pre_assigned_attendance_id,
      d.full_name AS current_dealer_name,
      datt.current_state,
      EXTRACT(EPOCH FROM (NOW() - da.assigned_at)) / 60 AS worked_minutes
    FROM dealer_assignments da
    LEFT JOIN dealer_attendance datt ON datt.id = da.attendance_id
    LEFT JOIN dealers d ON d.id = datt.dealer_id
    WHERE da.table_id IN (SELECT id FROM active_tables)
    ORDER BY da.table_id, da.assigned_at DESC
  ),
  confirmed_next AS (
    SELECT
      la.table_id,
      d.full_name AS next_dealer_name,
      datt.id AS next_attendance_id
    FROM latest_assignment la
    JOIN dealer_attendance datt ON datt.id = la.pre_assigned_attendance_id
    JOIN dealers d ON d.id = datt.dealer_id
    WHERE la.pre_assigned_attendance_id IS NOT NULL
  ),
  predicted_next AS (
    SELECT DISTINCT ON (t.id)
      t.id AS table_id,
      d.full_name AS next_dealer_name,
      datt.id AS next_attendance_id
    FROM active_tables t
    LEFT JOIN dealer_attendance datt
      ON datt.id = (
        SELECT da2.attendance_id
        FROM dealer_assignments da2
        WHERE da2.table_id = t.id
          AND da2.status = 'assigned'
        LIMIT 1
      )
    CROSS JOIN LATERAL (
      SELECT datt2.id, d.full_name, dsm.minutes_since_rest
      FROM dealer_attendance datt2
      JOIN dealers d ON d.id = datt2.dealer_id
      LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = datt2.id
      WHERE d.club_id = p_club_id
        AND datt2.current_state = 'available'
        AND datt2.status = 'checked_in'
        AND datt2.priority_break_flag = false
        AND datt2.id NOT IN (
          SELECT da3.attendance_id FROM dealer_assignments da3
          WHERE da3.status = 'assigned'
        )
      ORDER BY dsm.minutes_since_rest DESC NULLS LAST
      LIMIT 1
    ) candidates
    LEFT JOIN dealers d ON d.id = candidates.id
    LEFT JOIN dealer_attendance datt ON datt.id = candidates.id
    WHERE NOT EXISTS (
      SELECT 1 FROM confirmed_next cn WHERE cn.table_id = t.id
    )
    ORDER BY t.id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'tableId',           t.id,
      'tableName',         t.table_name,
      'currentDealerName', la.current_dealer_name,
      'currentState',      la.current_state,
      'workedMinutes',     COALESCE(la.worked_minutes::INT, 0),
      'swingDueAt',        la.swing_due_at,
      'minutesUntilSwing', GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(la.swing_due_at, NOW()) - NOW())) / 60)::INT,
      'nextDealerName',    COALESCE(cn.next_dealer_name, pn.next_dealer_name),
      'nextDealerId',      COALESCE(cn.next_attendance_id, pn.next_attendance_id)::TEXT,
      'confidence',        CASE WHEN cn.table_id IS NOT NULL THEN 'confirmed' ELSE 'predicted' END
    )
    ORDER BY t.table_name
  ) INTO v_result
  FROM active_tables t
  LEFT JOIN latest_assignment la ON la.table_id = t.id
  LEFT JOIN confirmed_next cn ON cn.table_id = t.id
  LEFT JOIN predicted_next pn ON pn.table_id = t.id;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;

-- Grant execute to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.predict_next_dealers TO anon;
GRANT EXECUTE ON FUNCTION public.predict_next_dealers TO authenticated;
