-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 4 — Enforce feature/final dealer-pool eligibility in assign_dealer_to_table
-- + audited manual floor override. SOURCE-ONLY (per ADR 012 + Amendment A7).
--
-- Redefines the single chokepoint for ALL dealer-assignment writes (manual edge +
-- fillEmptyTables + checkout-dealer + process-swing Pass 3). Builds on Patch 2 tables
-- (20261104000000) + Patch 3 helper (20261105000000). Apply AFTER both (DR-3).
-- NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
--   • DR-2 lock order (Amendment A7): lock dealer_table_profiles FOR UPDATE (the anchor)
--     BEFORE the attendance lock (order profile→da), so _assert_dealer_allowed_for_table
--     reads under the anchor and the pool cannot change between check and seat (closes TOCTOU).
--   • DR-1 kill-switch: the helper returns "allowed" while app_settings
--     'dealer_feature_tables_enabled' is off → enforcement OUTCOMES are inert until enabled.
--   • Override (DR-8b) is MANUAL-only: requires p_override + a non-empty reason + an actor
--     authorized via is_club_dealer_control against the table's AUTHORITATIVE game_tables club
--     (not client p_club_id) + a self-guard for direct callers; audited FATALLY to audit_logs.
--   • allow_override is informational (owner decision) — no SQL hard-lock against override.
--
-- HARD SEQUENCING GATE: do NOT enable the kill-switch until Patch 5 (force-release checks
-- eligibility BEFORE releasing; swing re-check under the profile lock) AND Patch 6 (edge passes
-- the override args) are merged — else the existing edge force-assign of a non-pool dealer to a
-- special table returns 'not_eligible' → HTTP 500, and Pass-3 force-release strands tables empty.
--
-- ROLLBACK: snapshot pg_get_functiondef('public.assign_dealer_to_table') BEFORE apply; rollback
-- = DROP the 10-param + CREATE the original 7-param body (20260801000005). Inert until the flip.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop prior signatures so the new 10-param is the ONLY overload (the post-condition DO block
-- below fail-safes a missed/mismatched drop). Live signature = the 7-param (20260801000005).
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz, uuid, text, boolean);                  -- live 7-param
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz, uuid, text, boolean, boolean, text, uuid);  -- new 10-param (re-run safety)

CREATE OR REPLACE FUNCTION public.assign_dealer_to_table(
  p_attendance_id    UUID,
  p_table_id         UUID,
  p_assigned_at      TIMESTAMPTZ  DEFAULT NOW(),
  p_swing_due_at     TIMESTAMPTZ  DEFAULT NULL,
  p_club_id          UUID          DEFAULT NULL,
  p_idempotency_key  TEXT          DEFAULT NULL,
  p_force_replace    BOOLEAN       DEFAULT false,
  p_override         BOOLEAN       DEFAULT false,    -- Patch 4: manual override of a special-table pool
  p_override_reason  TEXT          DEFAULT NULL,     -- Patch 4: required, audited
  p_actor            UUID          DEFAULT NULL      -- Patch 4: override actor (edge passes JWT sub)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public    -- Patch 4: was missing → closes a latent SECURITY DEFINER search_path hole
AS $$
DECLARE
  v_assignment_id    UUID;
  v_orphan_count     INT := 0;
  v_now              TIMESTAMPTZ := NOW();
  v_resolved_club_id UUID;
  v_dealer_id        UUID;    -- Patch 4: resolved from the locked attendance row (for eligibility)
  v_gt_club          UUID;    -- Patch 4: authoritative game_tables club (override authz/audit only)
BEGIN
  -- STEP 0: Idempotency check — BEFORE any side effects (a replay returns the already-decided
  -- assignment; it does NOT re-run eligibility/override or re-audit).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_assignment_id
    FROM dealer_assignments
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_assignment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'outcome', 'ok',
        'assignment_id', v_assignment_id,
        'orphan_count', 0,
        'idempotent', true
      );
    END IF;
  END IF;

  -- STEP 0.7 (Patch 4 — DR-2 profile-lock anchor): lock the special table's profile row FIRST,
  -- BEFORE the attendance lock, so set_table_dealer_pool cannot mutate the pool between the
  -- eligibility read (STEP 1.5) and the seat. Lock order = profile → da (canonical, ADR A7).
  -- Normal tables have no profile row → FOR UPDATE matches nothing → common path unchanged
  -- (serialization only on special tables, never the outcome). to_regclass guard mirrors the
  -- helper (DR-3) so applying before Patch 2 cannot error.
  IF to_regclass('public.dealer_table_profiles') IS NOT NULL THEN
    PERFORM 1 FROM public.dealer_table_profiles WHERE table_id = p_table_id FOR UPDATE;
  END IF;

  -- STEP 1: Lock attendance row (dealer must be available and checked in)
  SELECT dealer_id INTO v_dealer_id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'detail', 'Dealer not available or locked');
  END IF;

  -- STEP 1.5 (Patch 4 — feature/final eligibility + audited manual override):
  -- The profile row is FOR UPDATE'd in STEP 0.7 (DR-2 anchor, order profile→da) BEFORE this read,
  -- so _assert_dealer_allowed_for_table is authoritative — the pool cannot change between check and seat.
  IF NOT public._assert_dealer_allowed_for_table(p_table_id, v_dealer_id) THEN
    IF NOT p_override THEN
      RETURN jsonb_build_object('outcome', 'not_eligible', 'detail', 'Dealer not in pool for feature/final table', 'table_id', p_table_id);
    END IF;
    IF p_actor IS NULL OR btrim(coalesce(p_override_reason, '')) = '' THEN
      RETURN jsonb_build_object('outcome', 'override_invalid', 'detail', 'Override requires actor and non-empty reason');
    END IF;
    -- Direct authenticated caller may only act as itself; the edge runs as service_role
    -- (auth.uid() NULL) so p_actor (the JWT sub it verified) is trusted.
    IF auth.uid() IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor mismatch');
    END IF;
    -- AUTHORITATIVE club from game_tables (NOT client p_club_id) → no cross-club override bypass.
    SELECT club_id INTO v_gt_club FROM game_tables WHERE id = p_table_id;
    IF v_gt_club IS NULL OR NOT public.is_club_dealer_control(p_actor, v_gt_club) THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor not authorized to override for this table');
    END IF;
    -- FATAL audit by design: an override that cannot be recorded must NOT happen (no silent
    -- non-pool seat on a final/livestream table). p_actor passed is_club_dealer_control ⇒ a real
    -- auth.users id ⇒ the actor_id FK will not fail. entity_type/entity_id match Patch-3 config
    -- audits so one query pulls a table's full config + override history.
    INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (v_gt_club, p_actor, 'dealer_feature_override_assign', 'dealer_table_profile', p_table_id,
      jsonb_build_object('table_id', p_table_id, 'dealer_id', v_dealer_id, 'attendance_id', p_attendance_id,
        'override', true, 'reason', p_override_reason, 'forced_non_pool_dealer', true));
  END IF;

  -- STEP 2: Check table is not already occupied (skip if p_force_replace)
  IF NOT p_force_replace AND EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'table_occupied', 'detail', 'Table already has an active dealer');
  END IF;

  -- STEP 3: Release existing assignment at target table
  -- (has effect when p_force_replace bypassed Step 2, or for stale data cleanup)
  WITH released AS (
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'displaced_by_new_assignment'
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
    RETURNING attendance_id
  )
  UPDATE dealer_attendance
  SET current_state = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id IN (SELECT attendance_id FROM released)
    AND current_state IN ('assigned', 'on_break');

  -- STEP 4: Release orphan assignments for this dealer at OTHER tables
  SELECT COUNT(*) INTO v_orphan_count
  FROM dealer_assignments
  WHERE attendance_id = p_attendance_id
    AND status IN ('assigned', 'on_break')
    AND table_id != p_table_id
    AND released_at IS NULL;

  IF v_orphan_count > 0 THEN
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'force_release_before_reassign'
    WHERE attendance_id = p_attendance_id
      AND status IN ('assigned', 'on_break')
      AND table_id != p_table_id
      AND released_at IS NULL;

    RAISE NOTICE '[assign_dealer_to_table] Released % orphan assignment(s) for attendance %',
      v_orphan_count, p_attendance_id;
  END IF;

  -- STEP 5: Clear stale needs_replacement flag
  UPDATE dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  -- STEP 6: Resolve club_id (unchanged — p_club_id wins; v_gt_club above is override-path only)
  IF p_club_id IS NOT NULL THEN
    v_resolved_club_id := p_club_id;
  ELSE
    SELECT club_id INTO v_resolved_club_id
    FROM game_tables
    WHERE id = p_table_id;
  END IF;

  -- STEP 7: Insert new assignment
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status,
    assigned_at, swing_due_at, idempotency_key
  ) VALUES (
    p_attendance_id, p_table_id, v_resolved_club_id, 'assigned',
    p_assigned_at, p_swing_due_at, p_idempotency_key
  ) RETURNING id INTO v_assignment_id;

  -- STEP 8: Update dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'assignment_id', v_assignment_id,
    'orphan_count', v_orphan_count
  );
END;
$$;

-- Overload-bomb guard (P1-C fail-safe): exactly one assign_dealer_to_table must remain.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc
      WHERE proname = 'assign_dealer_to_table'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'assign_dealer_to_table overload not unique (a prior signature was not dropped)';
  END IF;
END $$;

COMMENT ON FUNCTION public.assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) IS
  'v3 (Patch 4): v2 atomic-assign + feature/final eligibility under a dealer_table_profiles FOR UPDATE anchor (DR-2/A7) + audited manual override (p_override/p_override_reason/p_actor; outcomes not_eligible/override_invalid/forbidden). Enforcement OUTCOMES inert while app_settings.dealer_feature_tables_enabled is off.';

COMMIT;
