-- ═══════════════════════════════════════════════════════════════════════════════
-- PATCH K: Extend reconcile_dealer_states STEP 1.6 to also clean stale on_break/
--          pre_assigned dealer_assignments rows when the dealer's attendance is
--          'pre_assigned' (not only 'available').
--
-- Target: OID 150751 — reconcile_dealer_states(p_club_id uuid)
--
-- Why (audit BUG-5, 2026-06-11):
--   When a dealer finishes a break, end_expired_breaks flips
--   dealer_attendance.current_state to 'available' but does NOT release the
--   dealer_assignments on_break row (released_at stays NULL). If that dealer is
--   then pre-assigned to a new table, their attendance becomes 'pre_assigned'
--   while the stale on_break row lingers inside idx_one_active_per_dealer.
--   STEP 1.6 only matched current_state='available', so the stale row sat
--   uncleaned (observed live: dealer "28", 44 min). That row is the "loaded
--   round" for the PATCH G/I duplicate-key class on the next swing of that dealer.
--   PATCH I (step 7c / Fix A) clears it at swing time; PATCH K clears it
--   proactively in reconcile so the pool isn't silently shrunk in the meantime.
--
-- Real-life reasoning: a dealer who returned from break and is now reserved for a
--   new table has, by definition, finished that break. The lingering on_break
--   assignment row is pure leftover state and is safe to release. Their actual
--   pre-assignment lives on the TARGET table's assignment (pre_assigned_attendance_id
--   pointer) + attendance.current_state, neither of which STEP 1.6 touches.
--
-- Change (the ONLY functional change vs the live PATCH H v2 body — see
--   docs/emergency_rollbacks/PATCH_K_rollback_reconcile_dealer_states_oid_150751.sql):
--     STEP 1.6:  da.current_state = 'available'
--             →  da.current_state IN ('available', 'pre_assigned')
--
-- Safety guards already in STEP 1.6 (unchanged) keep this tight:
--   • dass.attendance_id = da.id      → only the dealer's OWN rows
--   • dass.released_at IS NULL        → only un-released rows
--   • dass.assigned_at < NOW()-2 min  → never races an in-flight transition
--   • NOT EXISTS active 'assigned' for the dealer → never touches a working dealer
--   Releasing the row leaves attendance.current_state and the target table's
--   pre_assign pointer intact, so a valid upcoming swing is unaffected.
--
-- Not changed: signature, return JSON keys, PATCH H dual-clock STEP 4 guard, all
--   qualified RETURNING da.id / dass.id (no bare RETURNING id), every other STEP.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_dealer_states(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_fixed_available INT := 0;
  v_fixed_assigned INT := 0;
  v_fixed_pre_assigned_orphan INT := 0;
  v_fixed_pre_assigned_timeout INT := 0;
  v_cleared_orphaned INT := 0;
  v_fixed_orphan_assignments INT := 0;
BEGIN
  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 1: Fix available + có active assignment → set assigned
  -- ═══════════════════════════════════════════════════════════════════
  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'assigned'
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'available'
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_available FROM fixed;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 1.5: Release orphan on_break/pre_assigned assignments
  -- When a dealer has BOTH an assigned assignment AND an on_break
  -- or pre_assigned assignment at a different table, the non-assigned
  -- one is an orphan from a missed release and must be cleaned up.
  -- ═══════════════════════════════════════════════════════════════════
  WITH fixed AS (
    UPDATE dealer_assignments dass
    SET status = 'completed',
        released_at = NOW(),
        release_reason = 'pass0d_orphan_cleanup'
    FROM dealers d, dealer_attendance da
    WHERE dass.attendance_id = da.id
      AND da.dealer_id = d.id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND dass.status IN ('on_break', 'pre_assigned')
      AND dass.released_at IS NULL
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass2
        WHERE dass2.attendance_id = da.id
          AND dass2.id != dass.id
          AND dass2.status = 'assigned'
          AND dass2.released_at IS NULL
          AND dass2.table_id != dass.table_id
      )
    RETURNING dass.id            -- PATCH H: was `RETURNING id` (ambiguous)
  )
  SELECT COUNT(*) INTO v_fixed_orphan_assignments FROM fixed;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 1.6: Release DANGLING on_break/pre_assigned assignment rows for
  -- dealers who have returned to the pool with NO active assigned row.
  -- These orphans (missed release on break-end) silently shrink the
  -- pickable pool: pickNextDealer step-5b excludes any dealer with a
  -- non-released assignment row, so the dealer shows "Sẵn sàng" in the pool
  -- but is never picked → tables slip to Pass 3 emergency pre-assign or stall.
  -- Age guard (>2 min) avoids racing an in-flight transition.
  --
  -- PATCH K: attendance state widened from 'available' to
  -- IN ('available', 'pre_assigned'). A dealer who returned from break and
  -- was then pre-assigned to a new table keeps a stale own on_break row that
  -- the 'available'-only predicate missed (audit BUG-5, dealer "28", 44 min).
  -- Releasing it is safe — it only clears leftover state; the dealer's
  -- attendance state and the target table's pre_assign pointer are untouched.
  -- ═══════════════════════════════════════════════════════════════════
  WITH fixed AS (
    UPDATE dealer_assignments dass
    SET status = 'completed',
        released_at = NOW(),
        release_reason = 'pass0d_dangling_available_cleanup'
    FROM dealers d, dealer_attendance da
    WHERE dass.attendance_id = da.id
      AND da.dealer_id = d.id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state IN ('available', 'pre_assigned')   -- PATCH K: was = 'available'
      AND dass.status IN ('on_break', 'pre_assigned')
      AND dass.released_at IS NULL
      AND dass.assigned_at < NOW() - INTERVAL '2 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass2
        WHERE dass2.attendance_id = da.id
          AND dass2.status = 'assigned'
          AND dass2.released_at IS NULL
      )
    RETURNING dass.id            -- PATCH H: was `RETURNING id` (ambiguous)
  )
  SELECT v_fixed_orphan_assignments + COUNT(*) INTO v_fixed_orphan_assignments FROM fixed;

  IF v_fixed_orphan_assignments > 0 THEN
    RAISE NOTICE '[reconcile] Step 1.5/1.6: Released % orphan assignments (on_break/pre_assigned)', v_fixed_orphan_assignments;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 2: Fix assigned + KHÔNG có active assignment → set available
  -- ═══════════════════════════════════════════════════════════════════
  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'assigned'
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_assigned FROM fixed;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 3: Fix pre_assigned without assignment reference (B6 pattern)
  -- ═══════════════════════════════════════════════════════════════════
  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'pre_assigned'
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.pre_assigned_attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_pre_assigned_orphan FROM fixed;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 4: Fix pre_assigned stuck WITH assignment reference — STALE ONLY
  --
  -- PATCH H v2: Fixed the original 30-second threshold, which was far too
  -- aggressive. A normal Pass 2 pre-assign sits in the pre_assigned state
  -- for up to ~6–8 minutes before process-swing executes the swing.
  -- The 30s threshold therefore released VALID pre-assigns on every tick.
  --
  -- New guard: dual-clock approach using both pre_assigned_at and the
  -- matching assignment's swing_due_at as the real business clock.
  --   • da.pre_assigned_at < NOW() - 15 min : reservation held too long
  --   • dass.swing_due_at  < NOW() - 10 min : swing itself is already overdue
  -- Both must be true → release only when the swing is genuinely stale,
  -- not merely because the dealer has been waiting a while.
  --
  -- Dry-run verification (2026-06-11): dl 18 pre_assigned to Bàn 1,
  -- swing_due_at = 22:40 (+7 min). Old condition would have released them
  -- incorrectly. New condition: swing_due_at is NOT < NOW()-10min → 0 rows.
  -- ═══════════════════════════════════════════════════════════════════
  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'pre_assigned'
      AND da.pre_assigned_at < NOW() - INTERVAL '15 minutes'   -- PATCH H v2: was 30 seconds
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.pre_assigned_attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
          AND dass.swing_due_at < NOW() - INTERVAL '10 minutes' -- PATCH H v2: swing must be stale
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_pre_assigned_timeout FROM fixed;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 5: Clear orphaned pre_assigned_attendance_id
  -- ═══════════════════════════════════════════════════════════════════
  WITH cleared AS (
    UPDATE dealer_assignments dass
    SET pre_assigned_attendance_id = NULL,
        pre_assigned_at = NULL,
        updated_at = NOW()
    FROM dealers d, dealer_attendance da
    WHERE dass.attendance_id = da.id
      AND da.dealer_id = d.id
      AND d.club_id = p_club_id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
      AND dass.pre_assigned_attendance_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dealer_attendance da2
        WHERE da2.id = dass.pre_assigned_attendance_id
          AND da2.current_state = 'pre_assigned'
      )
    RETURNING dass.id
  )
  SELECT COUNT(*) INTO v_cleared_orphaned FROM cleared;

  RETURN jsonb_build_object(
    'fixed_available', v_fixed_available,
    'fixed_assigned', v_fixed_assigned,
    'fixed_pre_assigned_orphan', v_fixed_pre_assigned_orphan,
    'fixed_pre_assigned_timeout', v_fixed_pre_assigned_timeout,
    'cleared_orphaned', v_cleared_orphaned,
    'fixed_orphan_assignments', v_fixed_orphan_assignments
  );
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN
--   CREATE OR REPLACE FUNCTION only — no irreversible DDL.
--   To revert: run docs/emergency_rollbacks/PATCH_K_rollback_reconcile_dealer_states_oid_150751.sql
--   (verbatim pre-K live body) via the Management API. Do NOT edit this file.
-- ═══════════════════════════════════════════════════════════════════════════════
