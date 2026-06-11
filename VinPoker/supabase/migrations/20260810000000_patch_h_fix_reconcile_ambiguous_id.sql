-- ═══════════════════════════════════════════════════════════════════════════════
-- PATCH H: Fix `column reference "id" is ambiguous` in reconcile_dealer_states
--
-- Target: OID 150751
--   reconcile_dealer_states(p_club_id uuid)   -- single overload
--   Called every cron tick by process-swing Pass 0d (index.ts:1107).
--
-- Root cause
--   STEP 1.5 and STEP 1.6 both run:
--     UPDATE dealer_assignments dass
--     SET ...
--     FROM dealers d, dealer_attendance da
--     WHERE ...
--     RETURNING id           ← UNQUALIFIED
--   All three tables in scope (dealer_assignments, dealers, dealer_attendance)
--   have an `id` column, so `RETURNING id` is ambiguous. PostgreSQL resolves
--   column references at PLAN time (not per-row), so STEP 1.5 fails to plan on
--   every invocation regardless of row matches → the whole plpgsql transaction
--   rolls back → reconcile_dealer_states has been a complete no-op every tick,
--   surfacing in logs as `[Pass 0d] ❌ DB error: column reference "id" is ambiguous`.
--
-- Fix v2 (three changes vs the live body — see
--      docs/emergency_rollbacks/PATCH_H_rollback_reconcile_dealer_states_oid_150751.sql)
--   STEP 1.5: RETURNING id → RETURNING dass.id
--   STEP 1.6: RETURNING id → RETURNING dass.id
--   (dass = the UPDATE target dealer_assignments; this is the row whose id the
--    surrounding `SELECT COUNT(*) FROM fixed` counts.)
--   STEP 4: 30-second stale threshold corrected to dual-clock guard:
--           da.pre_assigned_at < NOW() - 15 min
--           AND dass.swing_due_at < NOW() - 10 min
--           Dry-run showed the 30s threshold would release valid active pre-assigns
--           (dl 18, Bàn 1, swing_due_at +7 min). New condition: 0 rows.
--
-- Behaviour-change flag
--   Because the function has been dead every tick, this fix makes it execute for
--   real for the FIRST time. Its first successful runs may report a burst of
--   fixed_* counts as it clears accumulated state drift. This is the intended
--   purpose, but DRY-RUN the counts before applying (see
--   docs/dry_runs/PATCH_H_dryrun_reconcile_counts.sql) so the burst is expected.
--
-- Not changed: signature, return type, language, security attributes (none /
--   invoker, no SECURITY DEFINER), JSON result keys, all other logic.
--   pg_get_functiondef emits no GRANT; CREATE OR REPLACE preserves existing
--   privileges, so none are restated here.
--
-- This migration body was captured from the LIVE function (OID 150751), which is
-- NEWER than the repo baseline (20260611000001_remote_only_schema_baseline.sql):
-- the baseline lacks STEP 1.6 and carries a capital-`D` `Dass.status` bug in
-- STEP 3 that the live function does not have.
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
  -- dealers who have returned to 'available' with NO active assigned row.
  -- These orphans (missed release on break-end) silently shrink the
  -- pickable pool: pickNextDealer step-5b excludes any dealer with a
  -- non-released assignment row, so the dealer shows "Sẵn sàng" in the pool
  -- but is never picked → tables slip to Pass 3 emergency pre-assign or stall.
  -- Age guard (>2 min) avoids racing an in-flight transition.
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
      AND da.current_state = 'available'
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
--
-- CREATE OR REPLACE FUNCTION only — no irreversible DDL.
-- To revert: run docs/emergency_rollbacks/PATCH_H_rollback_reconcile_dealer_states_oid_150751.sql
-- (the verbatim pre-apply live body) via the Management API. Do NOT edit this file.
-- ═══════════════════════════════════════════════════════════════════════════════
