-- ============================================================================================
-- FUNCTIONAL DRY-RUN for 20261120000000_payout_engine.sql  — SOURCE-ONLY, ALWAYS ROLLBACKs.
-- ============================================================================================
-- NOT a migration (leading underscore). Writes NOTHING (ROLLBACK at the end). Run in the controlled
-- session AFTER the migration objects exist (apply the migration inside the SAME txn, or run this
-- right after a real apply to verify, then it still rolls back). It builds a throwaway fixture
-- (synthetic club + 2 tournaments + entries) and exercises the trigger, the auth gate, the happy
-- path, and the invariant/idempotency guards — then rolls everything back.
--
-- Fixture note: clubs.owner_id is an FK to auth.users, so the synthetic club is owned by a REAL
-- auth.users id (read-only SELECT … LIMIT 1). tournament_entries.player_id has NO FK → synthetic.
-- Nothing in auth.users is mutated. If auth.uid() cannot be driven via GUC in this session, the
-- auth/happy-path block prints a SKIP note (run those checks via an authenticated app session).
-- ============================================================================================

BEGIN;

DO $$
DECLARE
  v_owner   uuid;
  v_other   uuid := gen_random_uuid();   -- a non-owner principal (random; not the club owner)
  v_club    uuid := gen_random_uuid();
  v_tour1   uuid := gen_random_uuid();    -- trigger tests (closed directly)
  v_tour2   uuid := gen_random_uuid();    -- auth + happy-path (closed via prepare)
  v_cancel  uuid := gen_random_uuid();    -- a cancelled entry's player (for the revive test)
  v_run     uuid;
  v_res     jsonb;
  v_n       integer;
  v_applied integer;
  i         integer;
BEGIN
  SELECT id INTO v_owner FROM auth.users LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'SKIP functional dry-run — no auth.users row available to own the synthetic club';
    RETURN;
  END IF;

  INSERT INTO public.clubs (id, name, region, owner_id)
    VALUES (v_club, 'DRYRUN payout club', 'DRYRUN', v_owner);
  INSERT INTO public.tournaments (id, club_id, name, start_time, buy_in, starting_stack, rake_amount)
    VALUES (v_tour1, v_club, 'DRYRUN tour 1', now(), 1000000, 20000, 200000),
           (v_tour2, v_club, 'DRYRUN tour 2', now(), 1000000, 20000, 200000);

  -- ===== TRIGGER GUARD (tour1; no auth needed — trigger ignores auth.uid) =====
  FOR i IN 1..10 LOOP
    INSERT INTO public.tournament_entries (tournament_id, player_id, entry_no, status)
      VALUES (v_tour1, gen_random_uuid(), 1, 'registered');
  END LOOP;
  INSERT INTO public.tournament_entries (tournament_id, player_id, entry_no, status)
    VALUES (v_tour1, v_cancel, 1, 'cancelled');   -- excluded from the official count
  RAISE NOTICE 'T1 OK — 11 inserts while OPEN (10 counted + 1 cancelled)';

  UPDATE public.tournaments SET registration_closed_at = now() WHERE id = v_tour1;  -- terminal close

  BEGIN
    INSERT INTO public.tournament_entries (tournament_id, player_id, entry_no, status)
      VALUES (v_tour1, gen_random_uuid(), 1, 'registered');
    RAISE EXCEPTION 'FUNC_FAIL T2 — insert after close was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%REGISTRATION_CLOSED%' THEN RAISE; END IF;
    RAISE NOTICE 'T2 OK — insert after close blocked';
  END;

  BEGIN
    UPDATE public.tournament_entries SET status = 'registered'
      WHERE tournament_id = v_tour1 AND player_id = v_cancel;
    RAISE EXCEPTION 'FUNC_FAIL T3 — reviving a cancelled entry after close was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%REGISTRATION_CLOSED%' THEN RAISE; END IF;
    RAISE NOTICE 'T3 OK — reviving a cancelled entry after close blocked';
  END;

  -- a legitimate post-close update (bust) must still pass
  UPDATE public.tournament_entries SET status = 'busted'
    WHERE tournament_id = v_tour1 AND status = 'registered';
  RAISE NOTICE 'T4 OK — legitimate post-close update (bust) allowed';

  -- ===== AUTH GATE + HAPPY PATH + INVARIANTS (tour2; needs auth.uid()) =====
  FOR i IN 1..10 LOOP
    INSERT INTO public.tournament_entries (tournament_id, player_id, entry_no, status)
      VALUES (v_tour2, gen_random_uuid(), 1, 'registered');
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  IF auth.uid() IS DISTINCT FROM v_owner THEN
    RAISE NOTICE 'SKIP auth/happy-path — auth.uid() not drivable via GUC here; run these via an authenticated app session';
    RETURN;  -- outer ROLLBACK still discards the fixture
  END IF;

  -- A1: a non-owner cannot prepare
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.prepare_payout_snapshot(v_tour2, 0.2, 'DAILY', 2, 100000);
    RAISE EXCEPTION 'FUNC_FAIL A1 — non-owner prepare was NOT rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
    RAISE NOTICE 'A1 OK — non-owner prepare rejected (NOT_AUTHORIZED)';
  END;

  -- back to the owner
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- P1: prepare closes registration + freezes the snapshot (pool = 10 × 1,000,000; floor = 2 × 1,200,000)
  v_res := public.prepare_payout_snapshot(v_tour2, 0.2, 'DAILY', 2, 100000);
  v_run := (v_res->>'run_id')::uuid;
  IF v_res->>'status' <> 'prepared'
     OR (v_res->>'prize_pool_snapshot')::bigint <> 10000000
     OR (v_res->>'effective_floor')::bigint <> 2400000 THEN
    RAISE EXCEPTION 'FUNC_FAIL P1 — snapshot wrong: %', v_res;
  END IF;
  RAISE NOTICE 'P1 OK — prepared (pool=10,000,000 floor=2,400,000), registration closed';

  -- AP1: apply a valid 2-row table (Σ = pool, last = floor)
  v_res := public.apply_payout_run(v_run,
    '[{"position":1,"amount":7600000},{"position":2,"amount":2400000}]'::jsonb,
    10000000, 2, 2400000, '[]'::jsonb, 'engine3neo-v1', 'engine3neo-v1');
  IF v_res->>'status' <> 'applied' THEN RAISE EXCEPTION 'FUNC_FAIL AP1 — apply failed: %', v_res; END IF;
  SELECT count(*) INTO v_n FROM public.tournament_prizes WHERE tournament_id = v_tour2;
  PERFORM 1 FROM public.tournaments WHERE id = v_tour2 AND prize_pool = 10000000 AND itm_places = 2;
  IF NOT FOUND OR v_n <> 2 THEN RAISE EXCEPTION 'FUNC_FAIL AP1 — writes wrong (prizes=%)', v_n; END IF;
  SELECT count(*) INTO v_applied FROM public.tournament_payout_runs WHERE tournament_id = v_tour2 AND status = 'applied';
  IF v_applied <> 1 THEN RAISE EXCEPTION 'FUNC_FAIL AP1 — applied runs=% (want 1)', v_applied; END IF;
  RAISE NOTICE 'AP1 OK — official payout written (2 prizes, pool+itm set, exactly 1 applied run)';

  -- AP2: re-applying the now-applied run is rejected
  BEGIN
    PERFORM public.apply_payout_run(v_run,
      '[{"position":1,"amount":7600000},{"position":2,"amount":2400000}]'::jsonb, 10000000, 2, 2400000);
    RAISE EXCEPTION 'FUNC_FAIL AP2 — re-apply was NOT rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%RUN_NOT_DRAFT%' AND SQLERRM NOT LIKE '%RUN_NOT_FOUND%' THEN RAISE; END IF;
    RAISE NOTICE 'AP2 OK — re-applying an applied run rejected';
  END;

  -- INV1: regenerate draft + a bad apply (sum mismatch) → reject; the OLD applied must survive
  v_res := public.prepare_payout_snapshot(v_tour2, 0.2, 'DAILY', 2, 100000, NULL, NULL, true, 'dryrun regenerate');
  v_run := (v_res->>'run_id')::uuid;
  BEGIN
    PERFORM public.apply_payout_run(v_run,
      '[{"position":1,"amount":9999999},{"position":2,"amount":2400000}]'::jsonb, 10000000, 2, 2400000);
    RAISE EXCEPTION 'FUNC_FAIL INV1 — sum-mismatch apply was NOT rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%SUM_MISMATCH%' THEN RAISE; END IF;
    RAISE NOTICE 'INV1 OK — sum mismatch rejected';
  END;
  SELECT count(*) INTO v_applied FROM public.tournament_payout_runs WHERE tournament_id = v_tour2 AND status = 'applied';
  IF v_applied <> 1 THEN RAISE EXCEPTION 'FUNC_FAIL INV1 — old applied did not survive a failed regenerate (applied=%)', v_applied; END IF;
  RAISE NOTICE 'INV1b OK — old applied payout survived the failed regenerate (supersede only on success)';

  RAISE NOTICE 'FUNCTIONAL DRY-RUN PASS — trigger + auth gate + happy path + invariants all OK';
END
$$;

ROLLBACK;
-- ============================================================================================
-- Expected NOTICEs (in order): T1, T2, T3, T4 OK; then A1, P1, AP1, AP2, INV1, INV1b OK; then
-- "FUNCTIONAL DRY-RUN PASS". Any "FUNC_FAIL …" EXCEPTION = a real defect. Nothing persisted.
-- (If the env can't drive auth.uid(), you'll see T1–T4 OK then a SKIP note — verify A1/P1/AP*/INV*
--  via an authenticated app session instead.)
-- ============================================================================================
