-- 20261223000000_end_breaks_on_demand.sql
-- F2 (owner decision 2026-07-08): "khi cần người thì không cần nghỉ bù —
-- nghỉ TỔNG 15 phút trong break pool là đủ." When Pass R detects a supply
-- shortage it returns up to p_max_count dealers who are on an AUTO comp break
-- (reason='auto_break_on_swing') and have rested >= p_min_rest_minutes total,
-- back to the available pool. No shortage → the comp break runs its course
-- (end_expired_breaks is UNTOUCHED). This does NOT force-release anyone from a
-- table; it only frees already-resting dealers earlier so a swap CAN happen.
--
-- SET mirrors complete_dealer_break (20260904000000): close the break row
-- (break_end=NOW) + the shared attendance clause used by end_expired_breaks
-- (20260805000000:455-461). Closing the row (unlike end_expired_breaks'
-- attendance-only flip) keeps checkout-dealer's break-minute sum correct (it
-- counts CLOSED rows only) and prevents stale open rows. NEVER touches
-- last_released_at — the execute rest floor (process-swing EXECUTE_MIN_REST=15),
-- lock_rotation_slot's rest guard and buildRotationSupply all anchor on release
-- markers, which stay honest, so the true 15-min inter-swing rest is preserved.
--
-- PROTECTED (never ended early): meal breaks (separate table dealer_meal_breaks,
-- 20260609000000 — never in dealer_breaks; plus an explicit NOT EXISTS guard for
-- the stale-open-row race), manual breaks (reason 'manual%', operator intent),
-- any break with < p_min_rest_minutes elapsed.
--
-- ⚠️ BEFORE APPLY (owner runbook, P0#1): confirm live comp-breaks actually use
-- reason='auto_break_on_swing':
--   SELECT reason, count(*) FROM public.dealer_breaks WHERE break_end IS NULL
--    GROUP BY reason ORDER BY count(*) DESC;
-- If a different/NULL reason dominates, patch the WHERE clause with evidence
-- (keep excluding 'manual%' + meal breaks) — do NOT broaden blindly.
--
-- SOURCE-ONLY: apply via SQL editor in an owner-gated window (the deploy
-- workflow never auto-runs db push). Rollback:
--   docs/emergency_rollbacks/ROLLBACK_end_breaks_on_demand_20261223.sql
-- The Pass R caller is try/catch non-fatal, so apply order vs the edge PR is free.

CREATE OR REPLACE FUNCTION public.end_breaks_on_demand(
  p_club_id          UUID,
  p_min_rest_minutes INT DEFAULT 15,
  p_max_count        INT DEFAULT 1
)
RETURNS TABLE(
  attendance_id  UUID,
  dealer_name    TEXT,
  break_id       UUID,
  break_start    TIMESTAMPTZ,
  rested_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_club_id IS NULL OR COALESCE(p_max_count, 0) <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    -- One open AUTO comp break per on_break dealer, past the rest floor.
    SELECT DISTINCT ON (att.id)
      db.id          AS c_break_id,
      att.id         AS c_att_id,
      d.full_name    AS c_dealer_name,
      db.break_start AS c_break_start
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
    JOIN public.dealer_attendance att
      ON att.id = COALESCE(db.attendance_id, da.attendance_id)
    JOIN public.dealers d ON d.id = att.dealer_id
    WHERE d.club_id = p_club_id
      AND att.current_state = 'on_break'
      AND att.status = 'checked_in'
      AND db.break_end IS NULL
      AND db.reason = 'auto_break_on_swing'
      AND db.break_start <= v_now - (GREATEST(p_min_rest_minutes, 0) || ' minutes')::INTERVAL
      -- Meal-break guard: a STALE open comp-break row (end_expired_breaks flips
      -- attendance but never closes the row) must not yank a dealer off an
      -- active meal break.
      AND NOT EXISTS (
        SELECT 1 FROM public.dealer_meal_breaks mb
        WHERE mb.attendance_id = att.id AND mb.status = 'active'
      )
    ORDER BY att.id, db.break_start ASC
  ),
  picked AS (
    SELECT c.c_break_id, c.c_att_id, c.c_dealer_name, c.c_break_start
    FROM candidate c
    JOIN public.dealer_breaks db ON db.id = c.c_break_id
    ORDER BY c.c_break_start ASC             -- most-rested first
    LIMIT LEAST(p_max_count, 20)             -- hard per-call safety cap
    FOR UPDATE OF db SKIP LOCKED             -- race-safe vs perform_swing / manage-break
  ),
  closed AS (
    UPDATE public.dealer_breaks db
    SET break_end = v_now
    FROM picked p
    WHERE db.id = p.c_break_id
      AND db.break_end IS NULL               -- idempotent double-end guard
    RETURNING p.c_att_id AS att_id, p.c_dealer_name AS dealer_name,
              db.id AS break_id, p.c_break_start AS break_start
  )
  UPDATE public.dealer_attendance att
  SET current_state                   = 'available',
      priority_break_flag             = false,
      worked_minutes_since_last_break = 0,
      pool_entered_at                 = v_now,
      updated_at                      = v_now
  FROM closed c
  WHERE att.id = c.att_id
    AND att.current_state = 'on_break'        -- CAS: state changed since read → skip
  RETURNING
    att.id,
    c.dealer_name,
    c.break_id,
    c.break_start,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - c.break_start)) / 60))::INT;
END;
$$;

REVOKE ALL ON FUNCTION public.end_breaks_on_demand(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_breaks_on_demand(UUID, INT, INT) TO service_role;

COMMENT ON FUNCTION public.end_breaks_on_demand(UUID, INT, INT) IS
  'Dealer Swing F2: when Pass R sees a supply shortage, end up to p_max_count AUTO comp breaks '
  '(reason=auto_break_on_swing) that already have >= p_min_rest_minutes rest, returning those '
  'dealers to the available pool early. Never touches manual/meal breaks or last_released_at; '
  'never force-releases a seated dealer. service_role only.';

NOTIFY pgrst, 'reload schema';
