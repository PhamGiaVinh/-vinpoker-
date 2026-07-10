-- =====================================================================================================
-- CONTROLLED DRY-RUN for 20261231000000_series_theory_patch_v2.sql  (SOURCE-ONLY — _-prefixed, NOT a migration)
-- The leading underscore keeps it OUT of the migration sequence (the runner never auto-applies it). It applies
-- the migration body INSIDE a transaction, proves the 5 new columns + 2 named CHECKs + the is_shadow default +
-- idempotency, then ROLLBACKs. NOTHING persists.
--
-- FIXTURE-FREE by design: this migration only ADDS COLUMNS to existing tables, so every proof is a catalog
-- read (information_schema / pg_constraint) — no club/event/owner fixtures, no RLS test (the columns inherit
-- each table's existing owner-scoped RLS, unchanged by this migration).
--
-- WHAT THIS PROVES (one returned result set = a PASS/FAIL matrix):
--   T1..T2  series_forecast_snapshots: rival_major_event_same_day boolean, rival_gtd bigint
--   T3      sfs_rival_gtd_chk exists and is the intended predicate (rival_gtd >= 0)
--   T4      series_forecast_snapshots.capacity integer
--   T5      sfs_capacity_chk exists and is the intended predicate (capacity >= 0)
--   T6      series_decision_logs.hit_capacity boolean
--   T7      series_decision_logs.is_shadow boolean, NOT NULL, DEFAULT false
--   T8      idempotency: re-running the migration body is a clean no-op (no error, no duplicate column/CHECK)
--
-- PREREQUISITE: series_capture_v0 (20261125000000) is already applied (both target tables must exist). If a
-- target table is missing, the pre-flight aborts before DDL.
--
-- HOW TO RUN (only after owner says "Proceed apply series theory patch v2"; this is the DRY-RUN step, pre-apply):
--   1) supabase db query --linked --file VinPoker/supabase/migrations/_dryrun_series_theory_patch_v2.sql
--   2) Read the matrix: EVERY row must say PASS.
--   3) SAFETY RE-CHECK afterwards: re-run the read-only column probe at the foot; the 5 columns MUST be gone
--      (probe returns 0). If any is still present, your client did NOT honor ROLLBACK — STOP and report.
--
-- RUN-MODEL: `supabase db query --file` returns ONLY the LAST statement's rows and ABORTS on the first uncaught
-- error, so every behavioral assertion lives in a plpgsql DO sub-block (BEGIN/EXCEPTION = implicit savepoint)
-- and records PASS/FAIL into a TEMP table; the single final SELECT is the one returned result set. Must be run
-- by a client that honors BEGIN/ROLLBACK (psql, supabase db query, SQL editor).
-- =====================================================================================================

BEGIN;

-- -----------------------------------------------------------------------------------------------------
-- PRE-FLIGHT (read-only): fail-fast (RAISE EXCEPTION aborts BEFORE any DDL) if a target table is missing.
-- -----------------------------------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.series_forecast_snapshots') IS NULL THEN
    RAISE EXCEPTION 'PRE-FLIGHT: series_forecast_snapshots missing — apply series_capture_v0 first.'; END IF;
  IF to_regclass('public.series_decision_logs') IS NULL THEN
    RAISE EXCEPTION 'PRE-FLIGHT: series_decision_logs missing — apply series_capture_v0 first.'; END IF;
  RAISE NOTICE 'PRE-FLIGHT OK: both target tables exist.';
END
$preflight$;

-- =====================================================================================================
-- MIGRATION BODY (verbatim from 20261231000000_series_theory_patch_v2.sql)
-- =====================================================================================================
ALTER TABLE public.series_forecast_snapshots
  ADD COLUMN IF NOT EXISTS rival_major_event_same_day boolean,
  ADD COLUMN IF NOT EXISTS rival_gtd bigint CONSTRAINT sfs_rival_gtd_chk CHECK (rival_gtd IS NULL OR rival_gtd >= 0),
  ADD COLUMN IF NOT EXISTS capacity  integer CONSTRAINT sfs_capacity_chk  CHECK (capacity  IS NULL OR capacity  >= 0);

ALTER TABLE public.series_decision_logs
  ADD COLUMN IF NOT EXISTS hit_capacity boolean,
  ADD COLUMN IF NOT EXISTS is_shadow    boolean NOT NULL DEFAULT false;

-- =====================================================================================================
-- RESULTS SINK (temp, ON COMMIT DROP — moot under ROLLBACK). One row per assertion.
-- =====================================================================================================
CREATE TEMP TABLE _dryrun_results (
  check_name text PRIMARY KEY,
  expected   text,
  got        text,
  pass       boolean
) ON COMMIT DROP;

DO $checks$
DECLARE
  v_type text;
  v_null text;
  v_def  text;
  v_def_txt text;
  v_cnt  int;
BEGIN
  -- T1: series_forecast_snapshots.rival_major_event_same_day boolean
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='series_forecast_snapshots' AND column_name='rival_major_event_same_day';
  INSERT INTO _dryrun_results VALUES ('T1_sfs_rival_flag','boolean', coalesce(v_type,'<missing>'), v_type='boolean');

  -- T2: series_forecast_snapshots.rival_gtd bigint
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='series_forecast_snapshots' AND column_name='rival_gtd';
  INSERT INTO _dryrun_results VALUES ('T2_sfs_rival_gtd','bigint', coalesce(v_type,'<missing>'), v_type='bigint');

  -- T3: sfs_rival_gtd_chk exists + predicate references rival_gtd and >= 0
  SELECT pg_get_constraintdef(oid) INTO v_def_txt FROM pg_constraint
   WHERE conname='sfs_rival_gtd_chk' AND conrelid='public.series_forecast_snapshots'::regclass;
  INSERT INTO _dryrun_results VALUES ('T3_sfs_rival_gtd_chk','CHECK (rival_gtd IS NULL OR rival_gtd >= 0)',
    coalesce(v_def_txt,'<missing>'),
    v_def_txt IS NOT NULL AND position('rival_gtd' in v_def_txt) > 0 AND position('>= 0' in v_def_txt) > 0);

  -- T4: series_forecast_snapshots.capacity integer
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='series_forecast_snapshots' AND column_name='capacity';
  INSERT INTO _dryrun_results VALUES ('T4_sfs_capacity','integer', coalesce(v_type,'<missing>'), v_type='integer');

  -- T5: sfs_capacity_chk exists + predicate references capacity and >= 0
  SELECT pg_get_constraintdef(oid) INTO v_def_txt FROM pg_constraint
   WHERE conname='sfs_capacity_chk' AND conrelid='public.series_forecast_snapshots'::regclass;
  INSERT INTO _dryrun_results VALUES ('T5_sfs_capacity_chk','CHECK (capacity IS NULL OR capacity >= 0)',
    coalesce(v_def_txt,'<missing>'),
    v_def_txt IS NOT NULL AND position('capacity' in v_def_txt) > 0 AND position('>= 0' in v_def_txt) > 0);

  -- T6: series_decision_logs.hit_capacity boolean
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='series_decision_logs' AND column_name='hit_capacity';
  INSERT INTO _dryrun_results VALUES ('T6_sdl_hit_capacity','boolean', coalesce(v_type,'<missing>'), v_type='boolean');

  -- T7: series_decision_logs.is_shadow boolean, NOT NULL, DEFAULT false
  SELECT data_type, is_nullable, column_default INTO v_type, v_null, v_def FROM information_schema.columns
   WHERE table_schema='public' AND table_name='series_decision_logs' AND column_name='is_shadow';
  INSERT INTO _dryrun_results VALUES ('T7_sdl_is_shadow','boolean/NOT NULL/default false',
    coalesce(v_type,'<missing>')||' / null='||coalesce(v_null,'?')||' / default='||coalesce(v_def,'<none>'),
    v_type='boolean' AND v_null='NO' AND coalesce(v_def,'') = 'false');

  -- T8: idempotency — re-run the body; must not error and must not add duplicate columns.
  BEGIN
    ALTER TABLE public.series_forecast_snapshots
      ADD COLUMN IF NOT EXISTS rival_major_event_same_day boolean,
      ADD COLUMN IF NOT EXISTS rival_gtd bigint CONSTRAINT sfs_rival_gtd_chk CHECK (rival_gtd IS NULL OR rival_gtd >= 0),
      ADD COLUMN IF NOT EXISTS capacity  integer CONSTRAINT sfs_capacity_chk  CHECK (capacity  IS NULL OR capacity  >= 0);
    ALTER TABLE public.series_decision_logs
      ADD COLUMN IF NOT EXISTS hit_capacity boolean,
      ADD COLUMN IF NOT EXISTS is_shadow    boolean NOT NULL DEFAULT false;
    SELECT count(*) INTO v_cnt FROM information_schema.columns
     WHERE table_schema='public'
       AND ((table_name='series_forecast_snapshots' AND column_name IN ('rival_major_event_same_day','rival_gtd','capacity'))
         OR (table_name='series_decision_logs'      AND column_name IN ('hit_capacity','is_shadow')));
    INSERT INTO _dryrun_results VALUES ('T8_idempotent_reapply','no error, exactly 5 new columns', v_cnt||' columns', v_cnt=5);
  EXCEPTION WHEN others THEN
    INSERT INTO _dryrun_results VALUES ('T8_idempotent_reapply','no error, exactly 5 new columns', 'ERRORED: '||SQLERRM, false);
  END;
END
$checks$;

-- =====================================================================================================
-- THE ONE RETURNED RESULT SET — full pass/fail matrix. A clean run = every verdict 'PASS'.
-- =====================================================================================================
SELECT
  check_name,
  CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict,
  expected,
  got
FROM _dryrun_results
ORDER BY check_name;

-- =====================================================================================================
-- UNDO EVERYTHING — no column, no CHECK persists. Afterwards run this read-only probe to CONFIRM rollback:
--   SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
--     AND ((table_name='series_forecast_snapshots' AND column_name IN ('rival_major_event_same_day','rival_gtd','capacity'))
--       OR (table_name='series_decision_logs'      AND column_name IN ('hit_capacity','is_shadow')));   -- MUST be 0
-- =====================================================================================================
ROLLBACK;
