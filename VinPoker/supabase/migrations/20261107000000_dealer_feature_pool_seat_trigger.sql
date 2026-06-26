-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 5a — Auto-swing feature/final pool enforcement via a dealer_assignments
-- seat trigger (HYBRID) + revoke direct writes. SOURCE-ONLY (ADR 012 + Amendment A8).
--
-- Live introspection (read-only pg_proc) proved perform_swing has 3 live overloads
-- (CORE seat-writer + a self-picking WRAPPER that delegates to CORE + a dead 5-arg) plus
-- execute_pre_assigned_swing — so enforcement goes at the single shared write sink
-- (dealer_assignments) as ONE trigger covering every seat-writer + future writers, instead
-- of reproducing 3-4 complex live rotation RPCs.
--
-- Builds on Patch 2 tables (20261104000000), Patch 3 helper (20261105000000), Patch 4
-- assign override (20261106000000). Apply AFTER all three (DR-3). NO `supabase db push`,
-- NO deploy_db, NO schema_migrations edit.
--
--   • A8.0 model: BEFORE INSERT OR UPDATE trigger — fires for new active seats AND
--     promote-to-active UPDATEs (reserved/pre_assigned → assigned); skips already-active
--     bookkeeping + race-restores of the same dealer/table.
--   • A8.2 lock: trigger holds dealer_table_profiles FOR UPDATE through the write → closes
--     TOCTOU vs set_table_dealer_pool. Uniform order {da|attendance} → profile (assign no
--     longer locks profile-first) → deadlock-free (config RPCs lock only profile; assign
--     uses SKIP LOCKED on attendance).
--   • A8.3 override skip-flag: assign_dealer_to_table sets tx-local dealer_feature.override
--     ='on' so the trigger allows the authorized+audited override. SAFE ONLY because direct
--     writes are revoked below → the sole inserter is a postgres SECURITY DEFINER RPC.
--     INVARIANT: if INSERT/UPDATE on dealer_assignments is ever re-granted to
--     authenticated/anon, the skip-flag becomes a bypass — this revoke must hold.
--   • A8.1 kill-switch: app_settings('dealer_feature_tables_enabled') JSONB boolean; the
--     trigger short-circuits (fully inert, no lock) when off.
--
-- HARD SEQUENCING GATE: do NOT flip the kill-switch until Patch 5b (picker pool-filter) AND
-- Patch 6 are merged — else the cron/WRAPPER feeds non-pool dealers → trigger-rollback every
-- cycle → outgoing stuck + OT (A8.4).
--
-- ROLLBACK: snapshot pg_get_functiondef of the trigger fn + assign_dealer_to_table + the
-- grants BEFORE apply. Undo = DROP TRIGGER + DROP FUNCTION + re-GRANT the prior writes +
-- restore the Patch-4 assign body (re-add STEP 0.7, drop the skip-flag). Inert until the flip.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (1) Revoke direct writes (P0-1) ──────────────────────────────────────────
-- SECURITY DEFINER RPCs (owner=postgres) + service_role become the sole seat-writers.
-- authenticated/anon keep SELECT (frontend reads the swing board). Verified safe: no
-- authenticated/anon direct write exists in code (only process-swing:3023 via service_role).
revoke insert, update, delete, truncate on public.dealer_assignments from authenticated, anon;

-- ── (2) Enforcement trigger (the hard guarantee for ALL seat-writers) ─────────
create or replace function public.dealer_assignments_pool_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_dealer_id uuid;
begin
  -- Only active seats matter.
  if NEW.status not in ('assigned', 'on_break') then
    return NEW;
  end if;

  -- Same dealer continuing/restoring the SAME table's seat (already-active version/time
  -- bookkeeping, or a race-lost restore completed→assigned) → not a new occupant → no re-check.
  -- A NEW occupant (INSERT, a different dealer/table, or a reserved/pre_assigned → assigned
  -- promote) falls through to enforcement.
  if TG_OP = 'UPDATE'
     and OLD.attendance_id = NEW.attendance_id
     and OLD.table_id = NEW.table_id
     and OLD.status in ('assigned', 'on_break', 'completed') then
    return NEW;
  end if;

  -- A8.1 kill-switch: fully inert when off (no profile lock, no work).
  if not coalesce(
       (select s.value = 'true'::jsonb from public.app_settings s
        where s.key = 'dealer_feature_tables_enabled'),
       false) then
    return NEW;
  end if;

  -- A8.3 authorized manual override (assign_dealer_to_table sets this tx-local flag).
  if coalesce(current_setting('dealer_feature.override', true), '') = 'on' then
    return NEW;
  end if;

  -- DR-3 absence guard (defensive; the tables exist once Patch 2 is applied).
  if to_regclass('public.dealer_table_profiles') is null then
    return NEW;
  end if;

  select dealer_id into v_dealer_id from public.dealer_attendance where id = NEW.attendance_id;

  -- A8.2 anchor: hold the profile row FOR UPDATE through the write → set_table_dealer_pool
  -- (which locks the same row) cannot change the pool between this check and the seat.
  -- Normal tables have no profile row → FOR UPDATE matches nothing → no lock, no cost.
  perform 1 from public.dealer_table_profiles where table_id = NEW.table_id for update;

  if not public._assert_dealer_allowed_for_table(NEW.table_id, v_dealer_id) then
    raise exception 'DEALER_NOT_IN_POOL: dealer % not allowed for feature/final table %',
      v_dealer_id, NEW.table_id using errcode = 'DT010';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_dealer_assignments_pool_enforce on public.dealer_assignments;
create trigger trg_dealer_assignments_pool_enforce
  before insert or update on public.dealer_assignments
  for each row execute function public.dealer_assignments_pool_enforce();

-- ── (3) assign_dealer_to_table: uniform lock order + override skip-flag ────────
-- Faithful re-copy of the Patch-4 10-arg body (20261106000000) with TWO changes:
--   • REMOVE the STEP 0.7 profile-first lock — the trigger is now the sole locking enforcer,
--     so assign's order becomes attendance(SKIP LOCKED) → [INSERT → trigger: profile] =
--     uniform {da|attendance} → profile with every seat-writer (A8.2). STEP 1.5's inline
--     _assert stays as a PLAIN-read pre-check for a clean 'not_eligible'; the trigger (under
--     the profile lock) is the race-authoritative backstop.
--   • ADD set_config('dealer_feature.override','on',true) in the override branch so the trigger
--     stands down for the authorized + audited override.
-- Same 10-arg signature → CREATE OR REPLACE (no DROP); the overload guard fail-safes drift.
create or replace function public.assign_dealer_to_table(
  p_attendance_id    UUID,
  p_table_id         UUID,
  p_assigned_at      TIMESTAMPTZ  DEFAULT NOW(),
  p_swing_due_at     TIMESTAMPTZ  DEFAULT NULL,
  p_club_id          UUID          DEFAULT NULL,
  p_idempotency_key  TEXT          DEFAULT NULL,
  p_force_replace    BOOLEAN       DEFAULT false,
  p_override         BOOLEAN       DEFAULT false,
  p_override_reason  TEXT          DEFAULT NULL,
  p_actor            UUID          DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id    UUID;
  v_orphan_count     INT := 0;
  v_now              TIMESTAMPTZ := NOW();
  v_resolved_club_id UUID;
  v_dealer_id        UUID;
  v_gt_club          UUID;
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

  -- STEP 1: Lock attendance row (dealer must be available and checked in)
  SELECT dealer_id INTO v_dealer_id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'detail', 'Dealer not available or locked');
  END IF;

  -- STEP 1.5 (Patch 4 + 5a): feature/final eligibility PLAIN-read pre-check for a clean
  -- 'not_eligible' / the audited manual override. The race-authoritative enforcer is the
  -- BEFORE INSERT/UPDATE trigger (dealer_assignments_pool_enforce) which holds
  -- dealer_table_profiles FOR UPDATE through the seat (A8.2); this inline read is not locked.
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
    -- FATAL audit by design: an override that cannot be recorded must NOT happen. p_actor passed
    -- is_club_dealer_control ⇒ a real auth.users id ⇒ the actor_id FK will not fail. entity_type/
    -- entity_id match Patch-3 config audits so one query pulls a table's config + override history.
    INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (v_gt_club, p_actor, 'dealer_feature_override_assign', 'dealer_table_profile', p_table_id,
      jsonb_build_object('table_id', p_table_id, 'dealer_id', v_dealer_id, 'attendance_id', p_attendance_id,
        'override', true, 'reason', p_override_reason, 'forced_non_pool_dealer', true));
    -- A8.3: tell the seat trigger to stand down for THIS authorized override (tx-local).
    PERFORM set_config('dealer_feature.override', 'on', true);
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

  -- STEP 6: Resolve club_id (p_club_id wins; v_gt_club above is override-path only)
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

-- Overload-bomb guard: exactly one assign_dealer_to_table must remain.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc
      WHERE proname = 'assign_dealer_to_table'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'assign_dealer_to_table overload not unique (a prior signature was not dropped)';
  END IF;
END $$;

COMMENT ON FUNCTION public.assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) IS
  'v4 (Patch 5a): v3 atomic-assign + override, with the profile-first lock removed (the BEFORE INSERT/UPDATE trigger dealer_assignments_pool_enforce is the sole locking enforcer, uniform {da|attendance}→profile) + the override branch sets tx-local dealer_feature.override so the trigger allows the authorized override. Inline _assert is a plain-read pre-check only.';

COMMENT ON FUNCTION public.dealer_assignments_pool_enforce() IS
  'Patch 5a: BEFORE INSERT OR UPDATE enforcement on dealer_assignments. Blocks a non-pool dealer from being seated on a feature/final table (table_mode=feature OR is_final), holding dealer_table_profiles FOR UPDATE through the write (A8.2 TOCTOU). Inert when app_settings.dealer_feature_tables_enabled is off; stands down for the tx-local dealer_feature.override skip-flag set by an authorized assign_dealer_to_table override. errcode DT010.';

COMMIT;
