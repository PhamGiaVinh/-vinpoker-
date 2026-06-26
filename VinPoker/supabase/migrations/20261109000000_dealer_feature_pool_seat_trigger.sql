-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 5a-rewrite — auto-swing feature/final pool enforcement via a dealer_assignments
-- seat trigger, using the M2 same-tx single-use override CLAIM (NO REVOKE, NO GUC).
-- SOURCE-ONLY (ADR 012 + Amendment A8, claim model). Supersedes the rejected #556
-- (REVOKE+GUC) approach.
--
-- Apply AFTER Patch 2 (20261104000000), Patch 3 (20261105000000), Patch 4 (20261106000000),
-- AND Patch 5a-claim (20261108000000 — this migration references public.dealer_override_claims).
-- NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- WHY this replaces #556: re-grep proved REVOKE would break release_dealer_from_table
-- (SECURITY INVOKER, called from DealerSwingTab.tsx:2168 as authenticated) + expose 3 other
-- INVOKER writers. So: NO REVOKE; the override signal is a same-tx, single-use claim row
-- written by assign's DEFINER override branch into dealer_override_claims (RLS-no-write →
-- unforgeable) and consumed by this trigger. release_dealer_from_table + the 3 INVOKER
-- writers are UNTOUCHED → zero production regression.
--
--   • A8.0 model: BEFORE INSERT OR UPDATE trigger at the shared seat sink — covers every
--     seat-writer + future ones; fires on new active seats + promote-to-active UPDATEs;
--     skips already-active bookkeeping + same-dealer/table race-restores.
--   • A8.2 lock: trigger holds dealer_table_profiles FOR UPDATE through the write → TOCTOU
--     closed. Uniform order {da|attendance} → profile (assign STEP 0.7 removed). Deadlock-free
--     (config RPCs lock only profile; assign uses SKIP LOCKED on attendance).
--   • A8.3 override = same-tx single-use CLAIM (no GUC, no REVOKE). Trigger consumes (DELETE)
--     the claim anchored on attendance_id (seat-instance) + txid=pg_current_xact_id() (same-tx,
--     replay-proof). Single-use is safe: an override seat is created by assign via ONE direct
--     status='assigned' INSERT (STEP 7) → trigger fires exactly once → consume there. The
--     reserved/pre_assigned→assigned multi-transition path is auto/pool (claim-free).
--   • A8.1 kill-switch + non-special short-circuit BEFORE pg_current_xact_id() → no xid forcing
--     on the hot path (normal tables, off-state, pool dealers never touch it).
--
-- ROLLBACK: snapshot pg_get_functiondef of the trigger fn + assign_dealer_to_table BEFORE apply.
-- Undo = DROP TRIGGER + DROP FUNCTION dealer_assignments_pool_enforce() + restore the Patch-4
-- assign body (re-add STEP 0.7, drop the claim INSERT). Inert until the kill-switch flips.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (1) Enforcement trigger (claim-model; the hard guarantee for ALL seat-writers) ──
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
  -- INSERT, a different dealer/table, or a reserved/pre_assigned → assigned promote → falls through.
  if TG_OP = 'UPDATE'
     and OLD.attendance_id = NEW.attendance_id
     and OLD.table_id = NEW.table_id
     and OLD.status in ('assigned', 'on_break', 'completed') then
    return NEW;
  end if;

  -- A8.1 kill-switch: fully inert when off (short-circuit BEFORE any lock / xid).
  if not coalesce(
       (select s.value = 'true'::jsonb from public.app_settings s
        where s.key = 'dealer_feature_tables_enabled'),
       false) then
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

  -- Pool dealer (or normal table → helper returns true) → allowed. NO claim lookup, NO xid touched
  -- (honors the "short-circuit before pg_current_xact_id() on the hot path" requirement: only a
  -- NON-pool dealer on a SPECIAL table reaches the claim/xid branch below).
  if public._assert_dealer_allowed_for_table(NEW.table_id, v_dealer_id) then
    return NEW;
  end if;

  -- Non-pool dealer on a special table → require a same-tx, single-use authorized override CLAIM.
  -- A8.3: match anchored on attendance_id (this seat instance) + txid (same assign tx);
  -- DELETE consumes it (single-use) so one claim authorizes exactly one seat write. A client
  -- cannot fabricate a claim (dealer_override_claims is RLS-no-write; only the postgres DEFINER
  -- assign writes it). pg_current_xact_id() is reached ONLY here (rare).
  delete from public.dealer_override_claims
   where attendance_id = NEW.attendance_id
     and txid = pg_current_xact_id()::text::bigint;
  if FOUND then
    return NEW;  -- authorized override, consumed
  end if;

  raise exception 'DEALER_NOT_IN_POOL: dealer % not allowed for feature/final table %',
    v_dealer_id, NEW.table_id using errcode = 'DT006';
end;
$$;

drop trigger if exists trg_dealer_assignments_pool_enforce on public.dealer_assignments;
create trigger trg_dealer_assignments_pool_enforce
  before insert or update on public.dealer_assignments
  for each row execute function public.dealer_assignments_pool_enforce();

-- ── (2) assign_dealer_to_table: uniform lock order + write an override CLAIM ───────
-- Faithful re-copy of the merged Patch-4 10-arg body (20261106000000) with TWO changes:
--   • REMOVE the STEP 0.7 profile-first lock — the trigger is the sole locking enforcer →
--     uniform {da|attendance} → profile order (A8.2). STEP 1.5's inline _assert stays a
--     PLAIN-read pre-check for a clean 'not_eligible'; the trigger is the race-authoritative backstop.
--   • REPLACE the override skip-signal: instead of a forgeable GUC, INSERT a same-tx single-use
--     claim into dealer_override_claims (after the audit) so the trigger allows THIS seat.
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
  -- assignment; it does NOT re-run eligibility/override, re-audit, or write a claim).
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

  -- STEP 1.5 (Patch 4 + 5a-rewrite): feature/final eligibility PLAIN-read pre-check for a clean
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
    -- is_club_dealer_control ⇒ a real auth.users id ⇒ the actor_id FK will not fail.
    INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (v_gt_club, p_actor, 'dealer_feature_override_assign', 'dealer_table_profile', p_table_id,
      jsonb_build_object('table_id', p_table_id, 'dealer_id', v_dealer_id, 'attendance_id', p_attendance_id,
        'override', true, 'reason', p_override_reason, 'forced_non_pool_dealer', true));
    -- A8.3: write a same-tx, single-use override CLAIM (anchored on attendance_id; txid = THIS tx →
    -- replay-proof) so the seat trigger allows THIS authorized seat. Unforgeable by clients
    -- (dealer_override_claims is RLS-no-write; only this postgres DEFINER fn writes it). The trigger
    -- DELETE-consumes it on the STEP 7 INSERT (the override seat fires the trigger exactly once).
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES (p_table_id, v_dealer_id, p_attendance_id, pg_current_xact_id()::text::bigint);
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
  'v4 (Patch 5a-rewrite): v3 atomic-assign + override, profile-first lock removed (the BEFORE INSERT/UPDATE trigger dealer_assignments_pool_enforce is the sole locking enforcer, uniform {da|attendance}→profile); the override branch writes a same-tx single-use claim into dealer_override_claims (no GUC, no REVOKE) so the trigger allows the authorized seat. Inline _assert is a plain-read pre-check only.';

COMMENT ON FUNCTION public.dealer_assignments_pool_enforce() IS
  'Patch 5a-rewrite: BEFORE INSERT OR UPDATE enforcement on dealer_assignments. Blocks a non-pool dealer from a feature/final table (errcode DT006) under dealer_table_profiles FOR UPDATE (A8.2 TOCTOU). Inert when app_settings.dealer_feature_tables_enabled is off. Authorized override = a same-tx single-use claim in dealer_override_claims (anchored on attendance_id + txid=pg_current_xact_id()); the trigger DELETE-consumes it. No REVOKE, no GUC.';

COMMIT;
