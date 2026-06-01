-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: detect_stuck_breaks — UPDATED SIGNATURE
--
-- Replaces the initial version from 20260704000000 with a version that returns
-- break_id so Pass 0c can call end_dealer_break for auto-fix.
--
-- Changes:
--   + break_id UUID in RETURN TABLE (needed for end_dealer_break RPC)
--   + dealer_id UUID in RETURN TABLE
--   - Uses dealer_breaks directly (simpler query, no JOIN via dealer_assignments)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Must DROP first because return type differs (can't CREATE OR REPLACE)
DROP FUNCTION IF EXISTS public.detect_stuck_breaks(p_club_id UUID);

CREATE OR REPLACE FUNCTION public.detect_stuck_breaks(
  p_club_id UUID
)
RETURNS TABLE(
  break_id UUID,
  attendance_id UUID,
  dealer_id UUID,
  dealer_name TEXT,
  expected_min INT,
  overdue_min INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    db.id                               AS break_id,
    da.attendance_id                    AS attendance_id,
    da.dealer_id                        AS dealer_id,
    d.full_name                         AS dealer_name,
    db.expected_duration_minutes        AS expected_min,
    GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (NOW() - db.break_start)) / 60) - db.expected_duration_minutes
    )::INT                              AS overdue_min
  FROM dealer_breaks db
  INNER JOIN dealer_assignments da ON da.id = db.assignment_id
  INNER JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND db.break_end IS NULL
    AND db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL < NOW()
  ORDER BY overdue_min DESC;
$$;

GRANT EXECUTE ON FUNCTION public.detect_stuck_breaks(UUID) TO service_role;

COMMENT ON FUNCTION public.detect_stuck_breaks IS
  'Returns overdue breaks with break_id for auto-fix via end_dealer_break RPC.';

-- Verify
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'detect_stuck_breaks'
      AND pg_get_function_result(p.oid) LIKE '%break_id%'
  ), 'detect_stuck_breaks must return break_id';
  RAISE NOTICE '✓ detect_stuck_breaks updated with break_id';
END;
$$;

COMMIT;
