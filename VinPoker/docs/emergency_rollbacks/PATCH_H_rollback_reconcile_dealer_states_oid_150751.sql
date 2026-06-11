-- PATCH H rollback snapshot — captured 2026-06-11 BEFORE applying migration
-- 20260810000000_patch_h_fix_reconcile_ambiguous_id.sql
--
-- Target OID 150751:
--   reconcile_dealer_states(p_club_id uuid)
--
-- This is the EXACT live function body captured via:
--   SELECT pg_get_functiondef(150751::oid);
-- run immediately before PATCH H. The only difference between this snapshot
-- and the PATCH H migration is the two STEP 1.5 / STEP 1.6 RETURNING clauses
-- (`RETURNING id` here → `RETURNING dass.id` in PATCH H).
--
-- NOTE: this body is NEWER than the repo baseline
-- (20260611000001_remote_only_schema_baseline.sql), which only contains STEP 1.5
-- and carries a latent capital-`D` `Dass.status` bug in STEP 3. The live function
-- has STEP 1.6 added and STEP 3 already lowercased — i.e. live drifted ahead of
-- the migrations. Use THIS snapshot (not the baseline) to revert PATCH H.
--
-- To revert PATCH H: run this file via the Management API SQL executor.
-- pg_get_functiondef does not emit GRANT statements; the function has no
-- SECURITY DEFINER and no explicit grants — CREATE OR REPLACE preserves the
-- existing privileges, so none are restated here.

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
    RETURNING id
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
    RETURNING id
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
  -- STEP 4: Fix pre_assigned stuck > 30s WITH assignment reference
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
      AND da.pre_assigned_at < NOW() - INTERVAL '30 seconds'
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.pre_assigned_attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
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
