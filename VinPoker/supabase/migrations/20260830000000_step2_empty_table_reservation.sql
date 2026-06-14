-- ============================================================================
-- Step 2 — empty-table predictive pre-assign: reservation primitives
-- ============================================================================
-- Authored SOURCE-ONLY (owner policy 2026-06-15). NOT applied. Apply later as a
-- controlled single Management-API op in an owner-gated window — do NOT use
-- `supabase db push` / deploy_db=true; the 20260801→20260813 chain + perform_swing
-- overload are still pending reconciliation.
--
-- Design: docs/agent-handoffs/scheduler-step2-empty-table-preassign-design.md
--
-- Purpose: let the scheduler reserve a soon-free dealer for an EMPTY active table
-- (a table that has no current dealer), represented as a dedicated
-- `dealer_assignments` row with the NEW status 'reserved'. The reserved dealer's
-- `dealer_attendance.current_state` is NOT changed (stays on_break) — the
-- reservation lives entirely in this row, which avoids the illegal
-- `on_break -> pre_assigned` FSM transition. When the dealer's break ends (their
-- attendance flips to 'available' via Pass 0e) the edge executes the reservation
-- (promote 'reserved' -> 'assigned') only after passing the 13-min execute rest
-- gate (kept in the edge, same as the existing pre-assigned swing path).
--
-- This migration is ADDITIVE and creates NO production behavior on its own:
--   * the status CHECK gains one allowed value ('reserved') — existing rows all
--     still satisfy it (current values: assigned/on_break/completed/swing_skipped);
--   * the RPCs are only CALLED by the Step-2 edge path, which stays behind a
--     per-club flag default OFF (PR 2B). Until that flag is enabled for a club,
--     nothing calls these functions.
-- ============================================================================

BEGIN;

-- ── 1. Allow the new 'reserved' assignment status ───────────────────────────
ALTER TABLE public.dealer_assignments
  DROP CONSTRAINT IF EXISTS dealer_assignments_status_check;

ALTER TABLE public.dealer_assignments
  ADD CONSTRAINT dealer_assignments_status_check
  CHECK (status = ANY (ARRAY['assigned'::text, 'on_break'::text, 'completed'::text, 'swing_skipped'::text, 'reserved'::text]));

-- ── 2. At most ONE live reservation per table and per dealer (race guard) ────
-- Partial unique indexes enforce acceptance #6 (no double-reserve) at the DB
-- level: a table can hold at most one un-released 'reserved' row, and a dealer
-- can hold at most one un-released 'reserved' row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reserved_one_per_table
  ON public.dealer_assignments (table_id)
  WHERE status = 'reserved' AND released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reserved_one_per_dealer
  ON public.dealer_assignments (attendance_id)
  WHERE status = 'reserved' AND released_at IS NULL;

-- ── 3. reserve_empty_table_for_dealer ───────────────────────────────────────
-- Create a reservation row for an EMPTY active table. Idempotent + guarded.
-- Reserves a RESTING (on_break) dealer only. Returns jsonb {ok, outcome,
-- reservation_id}. Outcomes:
--   ok | already_reserved (idempotent, returns existing id) | table_not_active
--   | table_occupied | dealer_not_found | dealer_not_on_break | dealer_busy
--   | race_lost
CREATE OR REPLACE FUNCTION public.reserve_empty_table_for_dealer(
  p_table_id        uuid,
  p_attendance_id   uuid,
  p_predicted_arrival timestamptz,
  p_club_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dealer_id    uuid;
  v_dealer_state text;
  v_existing     uuid;
  v_new_id       uuid;
BEGIN
  -- Idempotent: an existing live reservation for this exact (table, dealer) pair
  -- is a success, returning that id.
  SELECT id INTO v_existing
  FROM dealer_assignments
  WHERE table_id = p_table_id AND attendance_id = p_attendance_id
    AND status = 'reserved' AND released_at IS NULL
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_reserved', 'reservation_id', v_existing);
  END IF;

  -- Table must be active and belong to the club.
  IF NOT EXISTS (
    SELECT 1 FROM game_tables
    WHERE id = p_table_id AND status = 'active' AND club_id = p_club_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'table_not_active');
  END IF;

  -- Table must be EMPTY: no live assignment/break/reservation row on it.
  IF EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break', 'reserved')
      AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'table_occupied');
  END IF;

  -- Dealer must be checked in AND belong to this club.
  SELECT da.dealer_id, da.current_state INTO v_dealer_id, v_dealer_state
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.id = p_attendance_id AND da.status = 'checked_in' AND d.club_id = p_club_id;
  IF v_dealer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'dealer_not_found');
  END IF;

  -- Step 2 reserves a RESTING dealer (predictive: soon-free). Require on_break.
  -- (Genuinely-available dealers are handled by Step 1 immediate fill, not here.)
  IF v_dealer_state IS DISTINCT FROM 'on_break' THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'dealer_not_on_break', 'state', v_dealer_state);
  END IF;

  -- Dealer must not already hold a live ACTIVE assignment or another reservation.
  -- NOTE: we intentionally do NOT block on a live 'on_break' assignment row —
  -- that is the dealer's own rest and is the eligible state to reserve from.
  -- (On this DB an on_break dealer has no released_at-NULL row at all; this is
  --  future-proofing per the owner review.)
  IF EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE attendance_id = p_attendance_id
      AND status IN ('assigned', 'reserved')
      AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'dealer_busy');
  END IF;

  -- Create the reservation row. status='reserved' marks it as NOT an active
  -- assignment (won't be picked up by Pass 3's status='assigned' executor scan,
  -- and the dealer is excluded from the pool by PR 2B's pickNextDealer change).
  INSERT INTO dealer_assignments (
    table_id, attendance_id, dealer_id, club_id,
    status, assigned_at, swing_due_at, pre_assigned_at, pre_announce_due_at
  ) VALUES (
    p_table_id, p_attendance_id, v_dealer_id, p_club_id,
    'reserved', now(), COALESCE(p_predicted_arrival, now() + interval '5 minutes'), now(), now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'outcome', 'ok', 'reservation_id', v_new_id);
EXCEPTION WHEN unique_violation THEN
  -- Lost a concurrent race against uq_reserved_one_per_table/_dealer.
  RETURN jsonb_build_object('ok', false, 'outcome', 'race_lost');
END;
$$;

-- ── 4. execute_empty_table_reservation ──────────────────────────────────────
-- Promote a 'reserved' row to an active 'assigned' row ONCE the reserved dealer
-- is back in the pool (current_state='available'). The caller (edge) must have
-- already enforced the 13-min execute rest gate. Sets the swing clock from
-- p_swing_due_at (null-guarded). Re-checks table/dealer conflicts under the row
-- lock before promoting. Returns jsonb {ok, outcome}. Outcomes:
--   ok | reservation_not_found | dealer_not_ready (still on_break → no-op, retry)
--   | table_not_active | table_occupied | dealer_busy (stale → edge cancels)
CREATE OR REPLACE FUNCTION public.execute_empty_table_reservation(
  p_reservation_id uuid,
  p_swing_due_at   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_table_id      uuid;
  v_state         text;
  v_tx            jsonb;
BEGIN
  SELECT attendance_id, table_id INTO v_attendance_id, v_table_id
  FROM dealer_assignments
  WHERE id = p_reservation_id AND status = 'reserved' AND released_at IS NULL
  FOR UPDATE;
  IF v_attendance_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'reservation_not_found');
  END IF;

  -- Dealer must be back in the pool (break ended). If still on_break, no-op so
  -- the edge retries on a later tick — we NEVER pull a dealer off break early.
  SELECT current_state INTO v_state
  FROM dealer_attendance
  WHERE id = v_attendance_id AND status = 'checked_in'
  FOR UPDATE;
  IF v_state IS DISTINCT FROM 'available' THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'dealer_not_ready', 'state', v_state);
  END IF;

  -- Conflict re-check (the reservation may be stale: between reserve and execute,
  -- a manual/Step-1 assign could have staffed the table or the dealer). Re-verify
  -- under the row lock before promoting; the reservation row itself is excluded
  -- by id. On conflict, do NOT promote — return the conflict so the edge cancels.
  IF NOT EXISTS (SELECT 1 FROM game_tables WHERE id = v_table_id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'table_not_active');
  END IF;
  IF EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE table_id = v_table_id AND id <> p_reservation_id
      AND status IN ('assigned', 'on_break', 'reserved') AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'table_occupied');
  END IF;
  IF EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE attendance_id = v_attendance_id AND id <> p_reservation_id
      AND status IN ('assigned', 'reserved') AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'dealer_busy');
  END IF;

  -- Promote the reservation in place → active assignment, start the swing clock.
  -- Null-guard swing_due_at so a missing caller value can't violate NOT NULL.
  UPDATE dealer_assignments
  SET status = 'assigned',
      assigned_at = now(),
      swing_due_at = COALESCE(p_swing_due_at, now() + interval '45 minutes'),
      pre_assigned_at = NULL,
      pre_announce_due_at = NULL
  WHERE id = p_reservation_id;

  -- available -> assigned is a legal FSM transition; use the validated path for
  -- audit. If it fails, abort (the row update rolls back with the transaction).
  v_tx := transition_dealer_state(v_attendance_id, 'assigned', 'execute_empty_table_reservation');
  IF (v_tx->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'transition_dealer_state failed: %', v_tx::text;
  END IF;

  RETURN jsonb_build_object('ok', true, 'outcome', 'ok');
END;
$$;

-- ── 5. cancel_empty_table_reservation ───────────────────────────────────────
-- Idempotent cancel/expire of a reservation (stale, table closed, dealer gone).
-- Does NOT touch the dealer's state (they stay on_break / wherever they are).
-- Terminal status is 'swing_skipped' (NOT 'completed') — a reservation that
-- never materialised was never a real dealing session, so it must NOT look like
-- a completed assignment to payroll / "completed" reports. release_reason tags it.
-- Returns jsonb {ok, outcome}. Outcomes: ok | not_reserved (idempotent no-op).
CREATE OR REPLACE FUNCTION public.cancel_empty_table_reservation(
  p_reservation_id uuid,
  p_reason         text DEFAULT 'reservation_cancelled'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE dealer_assignments
  SET status = 'swing_skipped', released_at = now(), release_reason = p_reason
  WHERE id = p_reservation_id AND status = 'reserved' AND released_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'not_reserved');
  END IF;
  RETURN jsonb_build_object('ok', true, 'outcome', 'ok');
END;
$$;

-- ── 6. Grants — service_role ONLY ───────────────────────────────────────────
-- These are SECURITY DEFINER and have NO in-body actor/authorization guard, so
-- they must NOT be callable by ordinary `authenticated` users (any logged-in
-- user knowing the ids could otherwise reserve/execute/cancel — RLS does not
-- protect SECURITY DEFINER bodies). They are INTERNAL swing automation invoked
-- only by the process-swing Edge function via the service role. Grant
-- service_role only; revoke everyone else. (If an authenticated admin ever needs
-- to call these directly, add an explicit auth.uid()-is-dealer-control-for-club
-- guard inside each body FIRST, then widen the grant.)
REVOKE ALL ON FUNCTION public.reserve_empty_table_for_dealer(uuid, uuid, timestamptz, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_empty_table_reservation(uuid, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_empty_table_reservation(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_empty_table_for_dealer(uuid, uuid, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_empty_table_reservation(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_empty_table_reservation(uuid, text) TO service_role;

COMMIT;

-- ============================================================================
-- VERIFICATION (run AFTER a controlled apply; read-only):
-- ----------------------------------------------------------------------------
-- 1) Constraint now lists 'reserved':
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname='dealer_assignments_status_check';
-- 2) Functions exist + are SECURITY DEFINER + search_path=public:
--    SELECT proname, prosecdef, proconfig FROM pg_proc
--    WHERE proname IN ('reserve_empty_table_for_dealer','execute_empty_table_reservation','cancel_empty_table_reservation');
-- 3) anon cannot execute (should be empty):
--    SELECT routine_name FROM information_schema.role_routine_grants
--    WHERE grantee='anon' AND routine_name LIKE '%empty_table_reservation%';
-- 4) Smoke (on a DISPOSABLE empty active table + a checked-in dealer):
--    SELECT reserve_empty_table_for_dealer('<table>','<attendance>', now()+interval '6 min','<club>');
--    -- dealer still on_break here → execute is a no-op:
--    SELECT execute_empty_table_reservation('<reservation_id>', now()+interval '45 min'); -- {dealer_not_ready}
--    SELECT cancel_empty_table_reservation('<reservation_id>','smoke');                   -- {ok}
--
-- ROLLBACK (if needed after apply):
-- ----------------------------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.reserve_empty_table_for_dealer(uuid, uuid, timestamptz, uuid);
--   DROP FUNCTION IF EXISTS public.execute_empty_table_reservation(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.cancel_empty_table_reservation(uuid, text);
--   DROP INDEX IF EXISTS public.uq_reserved_one_per_table;
--   DROP INDEX IF EXISTS public.uq_reserved_one_per_dealer;
--   -- only after ensuring no rows have status='reserved':
--   UPDATE public.dealer_assignments SET status='completed', released_at=now()
--     WHERE status='reserved' AND released_at IS NULL;
--   ALTER TABLE public.dealer_assignments DROP CONSTRAINT IF EXISTS dealer_assignments_status_check;
--   ALTER TABLE public.dealer_assignments ADD CONSTRAINT dealer_assignments_status_check
--     CHECK (status = ANY (ARRAY['assigned','on_break','completed','swing_skipped']));
-- ============================================================================
