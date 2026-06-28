-- ════════════════════════════════════════════════════════════════════════════
-- tests/dealer_teardown_invariants.sql
--
-- §7 regression harness for the Dealer Swing orphaned-assignment freeze class.
-- Contract: docs/dealer-swing/ASSIGNMENT_TEARDOWN_ROOT_CAUSE.md (§7 INV-1..INV-7,
-- V1..V10). Locks the ALREADY-LIVE teardown so it cannot silently regress:
--   • release_dealer_assignments()          (migration 20260922000000, #299)
--   • reconcile_ghost_assignments() Pass A   (20260922000000, #299)
--   • cleanup_stale_attendance() + guard     (20260922000000 + 20260926000000, #299/#926)
--   • perform_swing() race-loss identity      (20260924000000 + 20260925000000, #312/#925)
--
-- HOW TO RUN (no prod — local PG / shadow DB with ALL migrations applied):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/dealer_teardown_invariants.sql
-- Expected: a stream of "PASS Tn …" NOTICEs and a final "ALL TEARDOWN INVARIANTS
-- PASSED". ANY assertion failure RAISEs EXCEPTION → psql aborts with that message.
--
-- SAFETY:
--   • Hermetic — seeds its OWN throwaway club/dealers/tables/attendance (fixed
--     de50… test UUIDs); never depends on real data.
--   • Self-rolling-back — everything runs inside ONE BEGIN; each test in its own
--     SAVEPOINT (ROLLBACK TO between tests for isolation); final ROLLBACK ⇒ ZERO
--     rows persist. Safe to run repeatedly.
--   • Privilege: release_dealer_assignments is REVOKEd to server-side only, so run
--     as the DB owner / superuser (local psql) or service_role.
--   • DO NOT run against production. (It writes-then-rolls-back, which still takes
--     locks + WAL on the live cluster. Owner policy: no prod. Local PG only.)
--
-- NOTE: authored against the live schema (src/integrations/supabase/types.ts) and
-- the migration bodies; NOT executed in the authoring session (no local PG there).
-- First run on a local PG may surface a column/CHECK drift — fix the seed, not the
-- assertions. The always-on guard for the freeze logic is the pure-Deno INV-2 test
-- (supabase/functions/_shared/__tests__/pickNextDealer.test.ts), which IS run.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ── Shared hermetic fixture (persists across savepoints; gone at final ROLLBACK)
INSERT INTO public.clubs (id, name, region)
VALUES ('de500000-0000-0000-0000-000000000001', '__teardown_test__', 'test');

INSERT INTO public.game_tables (id, club_id, table_name, status, table_type) VALUES
  ('de500000-0000-0000-0000-0000000000b1', 'de500000-0000-0000-0000-000000000001', 'TT-B1', 'active', 'cash'),
  ('de500000-0000-0000-0000-0000000000b2', 'de500000-0000-0000-0000-000000000001', 'TT-B2', 'active', 'cash'),
  ('de500000-0000-0000-0000-0000000000b3', 'de500000-0000-0000-0000-000000000001', 'TT-B3', 'active', 'cash');

INSERT INTO public.dealers (id, club_id, full_name, tier) VALUES
  ('de500000-0000-0000-0000-0000000000a1', 'de500000-0000-0000-0000-000000000001', 'TD-A1', 'C'),
  ('de500000-0000-0000-0000-0000000000a2', 'de500000-0000-0000-0000-000000000001', 'TD-A2', 'C'),
  ('de500000-0000-0000-0000-0000000000a3', 'de500000-0000-0000-0000-000000000001', 'TD-A3', 'C'),
  ('de500000-0000-0000-0000-0000000000a4', 'de500000-0000-0000-0000-000000000001', 'TD-A4', 'C'),
  ('de500000-0000-0000-0000-0000000000a5', 'de500000-0000-0000-0000-000000000001', 'TD-A5', 'C');

\echo '═══ Dealer Swing teardown invariants (§7) ═══'

-- ════════════════════════════════════════════════════════════════════════════
-- T1 — INV-1 / V1: release_dealer_assignments releases an 'assigned' row (by attendance)
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t1;
DO $t1$
DECLARE v_res jsonb; v_open int;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time)
  VALUES ('de500000-0000-0000-0000-0000000000c1', 'de500000-0000-0000-0000-0000000000a1', 'checked_in', 'assigned', now());
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at)
  VALUES ('de500000-0000-0000-0000-0000000000e1', 'de500000-0000-0000-0000-0000000000c1',
          'de500000-0000-0000-0000-0000000000a1', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'assigned', now() + interval '30 min');

  v_res := public.release_dealer_assignments(
    p_attendance_id := 'de500000-0000-0000-0000-0000000000c1', p_reason := 'test_t1');

  IF (v_res->>'released_count')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL T1 (INV-1): released_count=% expected 1', v_res->>'released_count';
  END IF;
  SELECT count(*) INTO v_open FROM public.dealer_assignments
    WHERE attendance_id = 'de500000-0000-0000-0000-0000000000c1' AND released_at IS NULL;
  IF v_open <> 0 THEN RAISE EXCEPTION 'FAIL T1 (INV-1): % active rows remain', v_open; END IF;
  PERFORM 1 FROM public.dealer_assignments
    WHERE id = 'de500000-0000-0000-0000-0000000000e1'
      AND status = 'completed' AND released_at IS NOT NULL AND release_reason = 'test_t1';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL T1 (INV-1): row not stamped completed/released_at/reason'; END IF;
  RAISE NOTICE 'PASS T1 — INV-1/V1: assigned row released by attendance_id';
END $t1$;
ROLLBACK TO SAVEPOINT t1;

-- ════════════════════════════════════════════════════════════════════════════
-- T2 — INV-1 / V2: release an 'on_break' row (the exact pgv freeze case)
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t2;
DO $t2$
DECLARE v_res jsonb; v_open int;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time)
  VALUES ('de500000-0000-0000-0000-0000000000c2', 'de500000-0000-0000-0000-0000000000a1', 'checked_in', 'on_break', now());
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at)
  VALUES ('de500000-0000-0000-0000-0000000000e2', 'de500000-0000-0000-0000-0000000000c2',
          'de500000-0000-0000-0000-0000000000a1', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'on_break', now() + interval '30 min');

  v_res := public.release_dealer_assignments(p_attendance_id := 'de500000-0000-0000-0000-0000000000c2', p_reason := 'test_t2');

  IF (v_res->>'released_count')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL T2 (INV-1/on_break): released_count=% expected 1', v_res->>'released_count';
  END IF;
  SELECT count(*) INTO v_open FROM public.dealer_assignments
    WHERE attendance_id = 'de500000-0000-0000-0000-0000000000c2' AND released_at IS NULL;
  IF v_open <> 0 THEN RAISE EXCEPTION 'FAIL T2: on_break orphan not released (% remain)', v_open; END IF;
  RAISE NOTICE 'PASS T2 — INV-1/V2: on_break orphan released (pgv case)';
END $t2$;
ROLLBACK TO SAVEPOINT t2;

-- ════════════════════════════════════════════════════════════════════════════
-- T3 — INV-1 / V3: release a 'pre_assigned' row AND clear pre_assigned_* fields
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t3;
DO $t3$
DECLARE v_open int; v_uncleared int;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time)
  VALUES ('de500000-0000-0000-0000-0000000000c3', 'de500000-0000-0000-0000-0000000000a1', 'checked_in', 'pre_assigned', now());
  INSERT INTO public.dealer_assignments
    (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at, pre_assigned_attendance_id, pre_assigned_at)
  VALUES ('de500000-0000-0000-0000-0000000000e3', 'de500000-0000-0000-0000-0000000000c3',
          'de500000-0000-0000-0000-0000000000a1', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'pre_assigned', now() + interval '30 min',
          'de500000-0000-0000-0000-0000000000c3', now());

  PERFORM public.release_dealer_assignments(p_attendance_id := 'de500000-0000-0000-0000-0000000000c3', p_reason := 'test_t3');

  SELECT count(*) INTO v_open FROM public.dealer_assignments
    WHERE attendance_id = 'de500000-0000-0000-0000-0000000000c3' AND released_at IS NULL;
  IF v_open <> 0 THEN RAISE EXCEPTION 'FAIL T3 (INV-1/pre_assigned): % active rows remain', v_open; END IF;
  SELECT count(*) INTO v_uncleared FROM public.dealer_assignments
    WHERE id = 'de500000-0000-0000-0000-0000000000e3'
      AND (pre_assigned_attendance_id IS NOT NULL OR pre_assigned_at IS NOT NULL);
  IF v_uncleared <> 0 THEN RAISE EXCEPTION 'FAIL T3: pre_assigned_* not cleared'; END IF;
  RAISE NOTICE 'PASS T3 — INV-1/V3: pre_assigned released + pre_assigned_* cleared';
END $t3$;
ROLLBACK TO SAVEPOINT t3;

-- ════════════════════════════════════════════════════════════════════════════
-- T4 — INV-1: idempotent (2nd call on an already-released dealer → 0)
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t4;
DO $t4$
DECLARE v_res jsonb;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time)
  VALUES ('de500000-0000-0000-0000-0000000000c4', 'de500000-0000-0000-0000-0000000000a1', 'checked_in', 'assigned', now());
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at)
  VALUES ('de500000-0000-0000-0000-0000000000e4', 'de500000-0000-0000-0000-0000000000c4',
          'de500000-0000-0000-0000-0000000000a1', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'assigned', now() + interval '30 min');

  PERFORM public.release_dealer_assignments(p_attendance_id := 'de500000-0000-0000-0000-0000000000c4', p_reason := 'test_t4');
  v_res := public.release_dealer_assignments(p_attendance_id := 'de500000-0000-0000-0000-0000000000c4', p_reason := 'test_t4_again');

  IF (v_res->>'released_count')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL T4 (idempotent): 2nd call released_count=% expected 0', v_res->>'released_count';
  END IF;
  RAISE NOTICE 'PASS T4 — INV-1: release is idempotent (2nd call = 0)';
END $t4$;
ROLLBACK TO SAVEPOINT t4;

-- ════════════════════════════════════════════════════════════════════════════
-- T5 — INV-4 / V10: release by dealer_id catches active rows ACROSS attendances
--      (the pivotal property: an orphan tied to an OLD attendance is caught by
--       the dealer's NEW pool entry — ≤1 active per dealer_id afterwards = 0)
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t5;
DO $t5$
DECLARE v_active int;
BEGIN
  -- old attendance (checked out) with a lingering orphan + new attendance with an active row
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time, check_out_time) VALUES
    ('de500000-0000-0000-0000-0000000000c5', 'de500000-0000-0000-0000-0000000000a2', 'checked_out', 'checked_out', now() - interval '6 h', now() - interval '1 h'),
    ('de500000-0000-0000-0000-0000000000c6', 'de500000-0000-0000-0000-0000000000a2', 'checked_in',  'assigned',    now(), NULL);
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at) VALUES
    ('de500000-0000-0000-0000-0000000000e5', 'de500000-0000-0000-0000-0000000000c5', 'de500000-0000-0000-0000-0000000000a2', 'de500000-0000-0000-0000-000000000001', 'de500000-0000-0000-0000-0000000000b1', 'on_break', now() + interval '30 min'),
    ('de500000-0000-0000-0000-0000000000e6', 'de500000-0000-0000-0000-0000000000c6', 'de500000-0000-0000-0000-0000000000a2', 'de500000-0000-0000-0000-000000000001', 'de500000-0000-0000-0000-0000000000b2', 'assigned', now() + interval '30 min');

  PERFORM public.release_dealer_assignments(p_dealer_id := 'de500000-0000-0000-0000-0000000000a2', p_reason := 'test_t5');

  SELECT count(*) INTO v_active FROM public.dealer_assignments
    WHERE dealer_id = 'de500000-0000-0000-0000-0000000000a2' AND released_at IS NULL;
  IF v_active <> 0 THEN RAISE EXCEPTION 'FAIL T5 (INV-4): % active rows remain for dealer_id (expected 0)', v_active; END IF;
  RAISE NOTICE 'PASS T5 — INV-4/V10: release by dealer_id catches cross-attendance orphans (0 active)';
END $t5$;
ROLLBACK TO SAVEPOINT t5;

-- ════════════════════════════════════════════════════════════════════════════
-- T6 — INV-7 / V5: reconcile_ghost_assignments Pass A releases a CHECKED-OUT
--      on_break orphan in ONE run (regression for the "~48 runs / 12h" gap)
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t6;
DO $t6$
DECLARE v_open int;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time, check_out_time)
  VALUES ('de500000-0000-0000-0000-0000000000c7', 'de500000-0000-0000-0000-0000000000a3', 'checked_out', 'checked_out', now() - interval '6 h', now() - interval '2 h');
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at)
  VALUES ('de500000-0000-0000-0000-0000000000e7', 'de500000-0000-0000-0000-0000000000c7',
          'de500000-0000-0000-0000-0000000000a3', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'on_break', now() - interval '30 min');

  PERFORM public.reconcile_ghost_assignments('de500000-0000-0000-0000-000000000001');

  SELECT count(*) INTO v_open FROM public.dealer_assignments
    WHERE id = 'de500000-0000-0000-0000-0000000000e7' AND released_at IS NULL;
  IF v_open <> 0 THEN RAISE EXCEPTION 'FAIL T6 (INV-7): checked-out orphan NOT released in one reconcile run'; END IF;
  RAISE NOTICE 'PASS T6 — INV-7/V5: reconcile Pass A released checked-out on_break orphan in one run';
END $t6$;
ROLLBACK TO SAVEPOINT t6;

-- ════════════════════════════════════════════════════════════════════════════
-- T7 — V4: cleanup_stale_attendance releases an on_break assignment for a >24h
--      dealer AND checks the attendance out
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t7;
DO $t7$
DECLARE v_open int; v_state text;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time)
  VALUES ('de500000-0000-0000-0000-0000000000c8', 'de500000-0000-0000-0000-0000000000a4', 'checked_in', 'on_break', now() - interval '25 h');
  -- old/overdue assignment (>2h) so the #926 active-dealer guard does NOT protect it
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at, assigned_at)
  VALUES ('de500000-0000-0000-0000-0000000000e8', 'de500000-0000-0000-0000-0000000000c8',
          'de500000-0000-0000-0000-0000000000a4', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'on_break', now() - interval '24 h', now() - interval '24 h');

  PERFORM public.cleanup_stale_attendance('de500000-0000-0000-0000-000000000001', 24);

  SELECT count(*) INTO v_open FROM public.dealer_assignments
    WHERE id = 'de500000-0000-0000-0000-0000000000e8' AND released_at IS NULL;
  IF v_open <> 0 THEN RAISE EXCEPTION 'FAIL T7 (V4): stale on_break assignment not released by cleanup'; END IF;
  SELECT current_state INTO v_state FROM public.dealer_attendance WHERE id = 'de500000-0000-0000-0000-0000000000c8';
  IF v_state <> 'checked_out' THEN RAISE EXCEPTION 'FAIL T7 (V4): stale attendance not checked_out (state=%)', v_state; END IF;
  RAISE NOTICE 'PASS T7 — V4: cleanup released stale on_break assignment + checked attendance out';
END $t7$;
ROLLBACK TO SAVEPOINT t7;

-- ════════════════════════════════════════════════════════════════════════════
-- T8 — #926 active-dealer guard: cleanup must SKIP a >24h check-in whose
--      assignment is FRESH (<2h) — a healthy actively-rotating dealer
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t8;
DO $t8$
DECLARE v_open int; v_state text;
BEGIN
  INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time)
  VALUES ('de500000-0000-0000-0000-0000000000c9', 'de500000-0000-0000-0000-0000000000a5', 'checked_in', 'assigned', now() - interval '30 h');
  -- FRESH assignment (swing_due_at in the future) → guard protects it
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at, assigned_at)
  VALUES ('de500000-0000-0000-0000-0000000000ea', 'de500000-0000-0000-0000-0000000000c9',
          'de500000-0000-0000-0000-0000000000a5', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b2', 'assigned', now() + interval '20 min', now());

  PERFORM public.cleanup_stale_attendance('de500000-0000-0000-0000-000000000001', 24);

  SELECT count(*) INTO v_open FROM public.dealer_assignments
    WHERE id = 'de500000-0000-0000-0000-0000000000ea' AND released_at IS NULL;
  IF v_open <> 1 THEN RAISE EXCEPTION 'FAIL T8 (#926 guard): fresh active assignment was wrongly released'; END IF;
  SELECT current_state INTO v_state FROM public.dealer_attendance WHERE id = 'de500000-0000-0000-0000-0000000000c9';
  IF v_state = 'checked_out' THEN RAISE EXCEPTION 'FAIL T8 (#926 guard): actively-rotating dealer wrongly checked out'; END IF;
  RAISE NOTICE 'PASS T8 — #926: cleanup skipped an actively-rotating dealer (guard holds)';
END $t8$;
ROLLBACK TO SAVEPOINT t8;

-- ════════════════════════════════════════════════════════════════════════════
-- T9 — INV-3 (partial): perform_swing version mismatch → 'race_lost' AND the
--      OUTGOING attendance markers are byte-identical (early-return identity).
--      NOTE: the full lost-INSERT-race rollback (#312/#925, v_new_assignment_id
--      NULL path) needs a concurrency harness — out of scope for one SQL script;
--      it is verified live (CORE markers has_rollback_identity / orphan_break true).
-- ════════════════════════════════════════════════════════════════════════════
SAVEPOINT t9;
DO $t9$
DECLARE v_res jsonb; v_before public.dealer_attendance; v_after public.dealer_attendance;
BEGIN
  INSERT INTO public.dealer_attendance
    (id, dealer_id, status, current_state, check_in_time, last_released_at, pool_entered_at, worked_minutes_since_last_break, priority_break_flag, overtime_minutes)
  VALUES ('de500000-0000-0000-0000-0000000000cb', 'de500000-0000-0000-0000-0000000000a1', 'checked_in', 'assigned', now(), now() - interval '90 min', now() - interval '90 min', 42, false, 7);
  INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, swing_due_at, version)
  VALUES ('de500000-0000-0000-0000-0000000000eb', 'de500000-0000-0000-0000-0000000000cb',
          'de500000-0000-0000-0000-0000000000a1', 'de500000-0000-0000-0000-000000000001',
          'de500000-0000-0000-0000-0000000000b1', 'assigned', now() + interval '30 min', 1);

  SELECT * INTO v_before FROM public.dealer_attendance WHERE id = 'de500000-0000-0000-0000-0000000000cb';

  -- wrong version (999 ≠ 1) selects the CORE 8-arg overload via named args → race_lost
  v_res := public.perform_swing(
    p_assignment_id          := 'de500000-0000-0000-0000-0000000000eb',
    p_version                := 999,
    p_next_attendance_id     := 'de500000-0000-0000-0000-0000000000cb',
    p_send_to_break          := false,
    p_break_duration_minutes := 15,
    p_swing_duration_minutes := 30,
    p_swing_due_at           := now() + interval '30 min',
    p_rest_deficit_minutes   := 0);

  IF v_res->>'outcome' <> 'race_lost' THEN
    RAISE EXCEPTION 'FAIL T9 (INV-3): outcome=% expected race_lost', v_res->>'outcome';
  END IF;
  SELECT * INTO v_after FROM public.dealer_attendance WHERE id = 'de500000-0000-0000-0000-0000000000cb';
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'FAIL T9 (INV-3): attendance markers mutated on race_lost (identity broken)';
  END IF;
  RAISE NOTICE 'PASS T9 — INV-3 (partial): perform_swing race_lost left attendance byte-identical';
END $t9$;
ROLLBACK TO SAVEPOINT t9;

\echo '═══ ALL TEARDOWN INVARIANTS PASSED (nothing persisted — rolling back) ═══'
ROLLBACK;
