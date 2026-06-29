-- ============================================================================================
-- DRY-RUN / DIAGNOSTIC for 20261120000000_payout_engine.sql   — SOURCE-ONLY, NEVER APPLIED.
-- ============================================================================================
-- This is NOT a migration (leading underscore → ignored by the migration runner; mirrors the
-- existing _dry_run_june_2026.sql convention). It ALWAYS ROLLBACKs and writes nothing.
--
-- HOW THE CONTROLLED RUNBOOK USES IT (owner-gated; not run now):
--   Phase "dry-run" — send ONE statement to the Management API:
--       BEGIN;
--         <contents of 20261120000000_payout_engine.sql>   -- creates objects in this txn
--         <contents of THIS file (the DO assertion blocks below, without the BEGIN/ROLLBACK here)>
--       ROLLBACK;                                           -- nothing persists
--   If every NOTICE prints OK and no EXCEPTION is raised, the migration is structurally sound and
--   the guards fire. Then (and only then) the owner gives the exact phrase for the COMMIT phase.
--
-- Standalone (this file as-is) wraps its own BEGIN..ROLLBACK and assumes the migration objects
-- already exist in the session (i.e. run it right after applying, to verify a real apply); if the
-- objects do not exist yet it will fail loudly — which correctly means "not applied".
-- ============================================================================================

BEGIN;

-- 0) PREFLIGHT: live role helpers the new RLS + functions depend on. These are referenced inside
--    plpgsql bodies (not validated at CREATE time, only at runtime), so verify the exact
--    (uuid,uuid) signatures exist on the live DB BEFORE trusting a COMMIT. to_regprocedure returns
--    NULL (no error) when the function is absent. Standalone form for preflight is in the review doc.
DO $$
BEGIN
  IF to_regprocedure('public.is_club_owner(uuid,uuid)')   IS NULL
  OR to_regprocedure('public.is_club_admin(uuid,uuid)')   IS NULL
  OR to_regprocedure('public.is_club_cashier(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: a required is_club_*(uuid,uuid) helper is missing on this DB';
  END IF;
  RAISE NOTICE 'OK 0 — is_club_owner/admin/cashier(uuid,uuid) all present';
END$$;

-- 1) object existence -----------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  -- columns
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tournaments'
     AND column_name IN ('registration_closed_at','planned_itm_percent','planned_payout_archetype','planned_min_cash_x','planned_rounding_unit');
  IF n <> 5 THEN RAISE EXCEPTION 'DRYRUN_FAIL: tournaments planned/closed columns = % (want 5)', n; END IF;

  -- tables
  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tournament_payout_runs';
  IF NOT FOUND THEN RAISE EXCEPTION 'DRYRUN_FAIL: tournament_payout_runs missing'; END IF;
  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payout_templates';
  IF NOT FOUND THEN RAISE EXCEPTION 'DRYRUN_FAIL: payout_templates missing'; END IF;

  -- partial unique index
  PERFORM 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_payout_applied';
  IF NOT FOUND THEN RAISE EXCEPTION 'DRYRUN_FAIL: uq_payout_applied missing'; END IF;

  -- functions
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN
     ('is_tournament_registration_closed','assert_tournament_registration_open',
      'prepare_payout_snapshot','apply_payout_run','save_tournament_prizes_v2');
  IF n <> 5 THEN RAISE EXCEPTION 'DRYRUN_FAIL: payout functions = % (want 5)', n; END IF;

  -- trigger
  PERFORM 1 FROM pg_trigger WHERE tgname='trg_entries_registration_open' AND NOT tgisinternal;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRYRUN_FAIL: trg_entries_registration_open missing'; END IF;

  -- RLS enabled + policies
  PERFORM 1 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_payout_runs' AND policyname='payout_runs_select';
  IF NOT FOUND THEN RAISE EXCEPTION 'DRYRUN_FAIL: payout_runs_select policy missing'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='payout_templates';
  IF n < 2 THEN RAISE EXCEPTION 'DRYRUN_FAIL: payout_templates policies = % (want >=2)', n; END IF;

  RAISE NOTICE 'OK 1/4 — all objects present';
END$$;

-- 2) is_tournament_registration_closed: unknown tournament → false ---------------------------
DO $$
BEGIN
  IF public.is_tournament_registration_closed('00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'DRYRUN_FAIL: closed() should be false for an unknown tournament';
  END IF;
  RAISE NOTICE 'OK 2/4 — is_tournament_registration_closed(unknown)=false';
END$$;

-- 3) write functions parse + their guards fire (auth.uid() is NULL here, or the tournament is
--    absent) → they MUST raise, proving the bodies compile and the early guards run. -----------
DO $$
BEGIN
  BEGIN
    PERFORM public.prepare_payout_snapshot('00000000-0000-0000-0000-000000000000'::uuid, 0.125, 'DAILY', 2, 100000);
    RAISE EXCEPTION 'DRYRUN_FAIL: prepare_payout_snapshot did not raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%AUTH_REQUIRED%' AND SQLERRM NOT LIKE '%TOURNAMENT_NOT_FOUND%' AND SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN
      RAISE EXCEPTION 'DRYRUN_FAIL: prepare unexpected error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.apply_payout_run('00000000-0000-0000-0000-000000000000'::uuid, '[]'::jsonb, 0, 0, 0);
    RAISE EXCEPTION 'DRYRUN_FAIL: apply_payout_run did not raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%AUTH_REQUIRED%' AND SQLERRM NOT LIKE '%RUN_NOT_FOUND%' THEN
      RAISE EXCEPTION 'DRYRUN_FAIL: apply unexpected error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.save_tournament_prizes_v2('00000000-0000-0000-0000-000000000000'::uuid, '[]'::jsonb, '');
    RAISE EXCEPTION 'DRYRUN_FAIL: save_tournament_prizes_v2 did not raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%AUTH_REQUIRED%' AND SQLERRM NOT LIKE '%MANUAL_EDIT_REASON_REQUIRED%' AND SQLERRM NOT LIKE '%TOURNAMENT_NOT_FOUND%' THEN
      RAISE EXCEPTION 'DRYRUN_FAIL: save unexpected error: %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'OK 3/4 — write-function guards fire (parse + early checks)';
END$$;

-- 4) row-validation logic via a local mirror of apply's CTE (proves the invariant SQL is sound):
--    a contiguous monotone set sums correctly; a gap/dup or inversion is detected. --------------
DO $$
DECLARE
  good jsonb := '[{"position":1,"amount":27000000},{"position":2,"amount":13700000},{"position":3,"amount":2400000}]';
  gap  jsonb := '[{"position":1,"amount":27000000},{"position":3,"amount":13700000}]';
  inv  jsonb := '[{"position":1,"amount":10000000},{"position":2,"amount":13700000}]';
  v_count int; v_sum numeric; v_contig boolean; v_monotone boolean;
BEGIN
  WITH r AS (SELECT (e.value->>'position')::int AS position, (e.value->>'amount')::numeric AS amount FROM jsonb_array_elements(good) e),
       ord AS (SELECT position, amount, row_number() OVER (ORDER BY position) rn, lag(amount) OVER (ORDER BY position) prev FROM r)
  SELECT count(*), sum(amount), bool_and(position=rn), bool_and(prev IS NULL OR amount<=prev) INTO v_count,v_sum,v_contig,v_monotone FROM ord;
  IF NOT (v_count=3 AND v_sum=43100000 AND v_contig AND v_monotone) THEN RAISE EXCEPTION 'DRYRUN_FAIL: good-set validation wrong'; END IF;

  WITH r AS (SELECT (e.value->>'position')::int AS position, (e.value->>'amount')::numeric AS amount FROM jsonb_array_elements(gap) e),
       ord AS (SELECT position, amount, row_number() OVER (ORDER BY position) rn FROM r)
  SELECT bool_and(position=rn) INTO v_contig FROM ord;
  IF v_contig THEN RAISE EXCEPTION 'DRYRUN_FAIL: gap not detected'; END IF;

  WITH r AS (SELECT (e.value->>'position')::int AS position, (e.value->>'amount')::numeric AS amount FROM jsonb_array_elements(inv) e),
       ord AS (SELECT position, amount, lag(amount) OVER (ORDER BY position) prev FROM r)
  SELECT bool_and(prev IS NULL OR amount<=prev) INTO v_monotone FROM ord;
  IF v_monotone THEN RAISE EXCEPTION 'DRYRUN_FAIL: inversion not detected'; END IF;

  RAISE NOTICE 'OK 4/4 — row-invariant SQL detects good / gap / inversion correctly';
END$$;

ROLLBACK;
-- ============================================================================================
-- Expected output: "OK 0" (helpers) + "OK 1/4".."OK 4/4" NOTICEs and NO error. Nothing persisted.
-- ============================================================================================
