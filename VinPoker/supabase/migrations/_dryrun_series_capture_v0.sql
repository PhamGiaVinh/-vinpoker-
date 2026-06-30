-- =====================================================================================================
-- CONTROLLED DRY-RUN for 20261125000000_series_capture_v0.sql  (SOURCE-ONLY — _-prefixed, NOT a migration)
-- Companion to the migration + _series_capture_v0_seed.sql. The leading underscore keeps it OUT of the
-- migration sequence (runner never auto-applies it). It applies the migration body INSIDE a transaction,
-- proves structure + RLS + data-quality, then ROLLBACKs. NOTHING persists — not even the tables.
--
-- WHAT THIS PROVES (one returned result set = a PASS/FAIL matrix):
--   A1..A6  structure: 4 tables exist, RLS on, exactly the 10 policies, NO DELETE grant, grant shape,
--           all 15 named CHECK constraints present.
--   B1..B3  positive RLS (as the owner): snapshot insert, decision insert linked to it, actuals UPDATE.
--   C1..C3  cross-club rejection (as the owner): foreign club, owned-club+foreign-event, foreign snapshot.
--   D1..D5  data-quality CHECK rejection: fc ordering, overlay 0-100, spend>=0, bullet>=1, bad enum.
--   E1..E4  SELECT-side isolation (as the owner): foreign-club rows are INVISIBLE; owned rows visible.
--
-- HOW TO RUN (only after owner says "Proceed apply series capture v0"; this is the DRY-RUN step, pre-apply):
--   1) Edit the 5 UUIDs in the _fix INSERT below (disposable fixtures you own — see FIXTURES).
--   2) supabase db query --linked --file VinPoker/supabase/migrations/_dryrun_series_capture_v0.sql
--   3) Read the matrix: EVERY row must say PASS.
--   4) MANDATORY SAFETY RE-CHECK afterwards: re-run the read-only liveness probe; all 4 tables MUST still
--      be to_regclass = NULL. If any is non-NULL, your client did NOT honor ROLLBACK — STOP and report.
--
-- RUN-MODEL NOTES (verified):
--   * `supabase db query --file` returns ONLY the LAST statement's rows and ABORTS on the first uncaught
--     error. So every assertion lives in a plpgsql DO sub-block (BEGIN/EXCEPTION = an implicit savepoint):
--     an expected failure is CAUGHT and recorded as PASS into a TEMP table; nothing propagates to abort.
--     The single final SELECT over _dryrun_results is the one returned result set.
--   * The connecting login role OWNS the new tables and (with ENABLE — not FORCE — RLS) is RLS-exempt; the
--     tests SET LOCAL ROLE authenticated (not owner, not BYPASSRLS) so policies genuinely apply. Identity is
--     injected via set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')).
--     is_club_owner is SECURITY DEFINER but reads auth.uid() = request.jwt.claims->>'sub', so ownership
--     resolves to the fixture owner. RESET ROLE before every bookkeeping write (authenticated has no rights
--     on the postgres-owned temp tables). SET LOCAL + is_local GUCs are transaction-scoped → ROLLBACK clears.
--   * This script MUST be run by a client that honors BEGIN/ROLLBACK (psql, supabase db query, SQL editor).
--     The explicit BEGIN guarantees a transaction even under autocommit; the final ROLLBACK discards all of
--     it. The post-run liveness re-check (step 4) is the backstop that proves nothing leaked.
--
-- FIXTURES (edit the 5 UUIDs in the _fix INSERT). All-zero UUID = placeholder and is rejected by pre-flight:
--   owner       : auth.users.id of a user for whom is_club_owner(owner, owned) = TRUE (injected as jwt sub)
--   owned       : clubs.id this owner OWNS                          (home club for positive + isolation tests)
--   event_owned : tournaments.id whose club_id = owned             (satisfies the event/club guard)
--   other       : clubs.id this owner does NOT own (!= owned)      (drives cross-club rejection + isolation)
--   event_other : tournaments.id whose club_id = other             (valid foreign event)
-- =====================================================================================================

BEGIN;

-- Fixtures as a pure-SQL temp table (NO psql \set — portable across psql / db query / SQL editor).
CREATE TEMP TABLE _fix (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO _fix (k, v) VALUES
  ('owner',       '00000000-0000-0000-0000-000000000000'),
  ('owned',       '00000000-0000-0000-0000-000000000000'),
  ('event_owned', '00000000-0000-0000-0000-000000000000'),
  ('other',       '00000000-0000-0000-0000-000000000000'),
  ('event_other', '00000000-0000-0000-0000-000000000000');

-- -----------------------------------------------------------------------------------------------------
-- PRE-FLIGHT (read-only): fail-fast (RAISE EXCEPTION aborts BEFORE any DDL) on bad fixtures / bad pivot.
-- -----------------------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_owned uuid := (SELECT v FROM _fix WHERE k='owned');
  v_ev_o  uuid := (SELECT v FROM _fix WHERE k='event_owned');
  v_other uuid := (SELECT v FROM _fix WHERE k='other');
  v_ev_x  uuid := (SELECT v FROM _fix WHERE k='event_other');
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF v_owner = z OR v_owned = z OR v_ev_o = z OR v_other = z OR v_ev_x = z THEN
    RAISE EXCEPTION 'PRE-FLIGHT: a fixture is still the all-zero placeholder — edit the _fix INSERT.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_owner) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: owner % not found in auth.users.', v_owner; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = v_owned) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: owned club % not found.', v_owned; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = v_other) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: other club % not found.', v_other; END IF;
  IF v_owned = v_other THEN
    RAISE EXCEPTION 'PRE-FLIGHT: owned and other must DIFFER.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = v_ev_o AND t.club_id = v_owned) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: event_owned % is not a tournament whose club_id = owned %.', v_ev_o, v_owned; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = v_ev_x AND t.club_id = v_other) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: event_other % is not a tournament whose club_id = other %.', v_ev_x, v_other; END IF;
  IF NOT public.is_club_owner(v_owner, v_owned) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: is_club_owner(owner, owned) is FALSE — pick a club this owner owns.'; END IF;
  IF public.is_club_owner(v_owner, v_other) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: is_club_owner(owner, other) is TRUE — other must be a club the owner does NOT own.'; END IF;
  RAISE NOTICE 'PRE-FLIGHT OK: fixtures valid; owner owns owned and does NOT own other.';
END
$preflight$;

-- =====================================================================================================
-- MIGRATION BODY (verbatim from 20261125000000_series_capture_v0.sql)
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS public.series_forecast_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  horizon          text NOT NULL,
  days_before      integer,
  forecast_base    integer,
  forecast_low     integer,
  forecast_high    integer,
  confidence_tier  text,
  candidate_gtd    bigint,
  overlay_risk_pct numeric,
  source_label     text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT auth.uid(),
  CONSTRAINT sfs_horizon_chk     CHECK (horizon IN ('T-21','T-7','T-1','T-0')),
  CONSTRAINT sfs_tier_chk        CHECK (confidence_tier IS NULL OR confidence_tier IN ('low','medium','high')),
  CONSTRAINT sfs_fc_nonneg       CHECK (
    (forecast_base IS NULL OR forecast_base >= 0)
    AND (forecast_low  IS NULL OR forecast_low  >= 0)
    AND (forecast_high IS NULL OR forecast_high >= 0)),
  CONSTRAINT sfs_fc_ordered      CHECK (
    forecast_low IS NULL OR forecast_base IS NULL OR forecast_high IS NULL
    OR (forecast_low <= forecast_base AND forecast_base <= forecast_high)),
  CONSTRAINT sfs_overlay_pct_chk CHECK (overlay_risk_pct IS NULL OR (overlay_risk_pct >= 0 AND overlay_risk_pct <= 100)),
  CONSTRAINT sfs_gtd_chk         CHECK (candidate_gtd IS NULL OR candidate_gtd >= 0),
  CONSTRAINT sfs_days_chk        CHECK (days_before IS NULL OR days_before >= 0)
);

CREATE TABLE IF NOT EXISTS public.series_decision_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  event_id              uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  forecast_snapshot_id  uuid REFERENCES public.series_forecast_snapshots(id) ON DELETE SET NULL,
  decision_horizon      text NOT NULL,
  recommended_action    text,
  owner_decision        text,
  public_action         text,
  decision_reason       text,
  actual_result         text,
  actual_entries        integer,
  actual_unique_players integer,
  actual_reentries      integer,
  actual_prize_pool     bigint,
  actual_overlay_amount bigint,
  post_event_reason     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid DEFAULT auth.uid(),
  CONSTRAINT sdl_horizon_chk     CHECK (decision_horizon IN ('T-21','T-7','T-1','T-0','post')),
  CONSTRAINT sdl_actuals_nonneg  CHECK (
    (actual_entries        IS NULL OR actual_entries        >= 0)
    AND (actual_unique_players IS NULL OR actual_unique_players >= 0)
    AND (actual_reentries      IS NULL OR actual_reentries      >= 0)
    AND (actual_prize_pool     IS NULL OR actual_prize_pool     >= 0)
    AND (actual_overlay_amount IS NULL OR actual_overlay_amount >= 0))
);

CREATE TABLE IF NOT EXISTS public.series_campaign_logs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                   uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  campaign_id               text,
  event_linked              uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  channel                   text,
  spend                     bigint,
  creative_type             text,
  target_segment            text,
  baseline_expected_entries integer,
  decision_reason           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid DEFAULT auth.uid(),
  CONSTRAINT scl_spend_chk    CHECK (spend IS NULL OR spend >= 0),
  CONSTRAINT scl_baseline_chk CHECK (baseline_expected_entries IS NULL OR baseline_expected_entries >= 0)
);

CREATE TABLE IF NOT EXISTS public.series_registration_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_ref_hash  text,
  player_ref_type  text,
  registered_at    timestamptz NOT NULL DEFAULT now(),
  is_reentry       boolean NOT NULL DEFAULT false,
  bullet           smallint,
  commitment_stage text,
  entry_source     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT auth.uid(),
  CONSTRAINT sre_ref_type_chk CHECK (player_ref_type IS NULL OR player_ref_type IN ('phone','app_user_id','host_label')),
  CONSTRAINT sre_bullet_chk   CHECK (bullet IS NULL OR bullet >= 1),
  CONSTRAINT sre_stage_chk    CHECK (commitment_stage IS NULL OR commitment_stage IN ('interested','reserved','paid','seated','cancelled')),
  CONSTRAINT sre_source_chk   CHECK (entry_source IS NULL OR entry_source IN ('direct','online','floor','satellite','unknown'))
);

CREATE INDEX IF NOT EXISTS idx_sfs_club  ON public.series_forecast_snapshots(club_id);
CREATE INDEX IF NOT EXISTS idx_sfs_event ON public.series_forecast_snapshots(event_id);
CREATE INDEX IF NOT EXISTS idx_sdl_club  ON public.series_decision_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_sdl_event ON public.series_decision_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_sdl_snap  ON public.series_decision_logs(forecast_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_scl_club  ON public.series_campaign_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_scl_event ON public.series_campaign_logs(event_linked);
CREATE INDEX IF NOT EXISTS idx_sre_club  ON public.series_registration_events(club_id);
CREATE INDEX IF NOT EXISTS idx_sre_event ON public.series_registration_events(event_id);

ALTER TABLE public.series_forecast_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_decision_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_campaign_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_registration_events  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.series_forecast_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_decision_logs       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_campaign_logs       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_registration_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT         ON public.series_forecast_snapshots  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.series_decision_logs       TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.series_campaign_logs       TO authenticated;
GRANT SELECT, INSERT         ON public.series_registration_events TO authenticated;

DROP POLICY IF EXISTS sfs_select ON public.series_forecast_snapshots;
CREATE POLICY sfs_select ON public.series_forecast_snapshots
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sfs_insert ON public.series_forecast_snapshots;
CREATE POLICY sfs_insert ON public.series_forecast_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
  );

DROP POLICY IF EXISTS sdl_select ON public.series_decision_logs;
CREATE POLICY sdl_select ON public.series_decision_logs
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sdl_insert ON public.series_decision_logs;
CREATE POLICY sdl_insert ON public.series_decision_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
    AND (forecast_snapshot_id IS NULL
         OR EXISTS (SELECT 1 FROM public.series_forecast_snapshots s WHERE s.id = forecast_snapshot_id AND s.club_id = club_id))
  );

DROP POLICY IF EXISTS sdl_update ON public.series_decision_logs;
CREATE POLICY sdl_update ON public.series_decision_logs
  FOR UPDATE TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id))
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
    AND (forecast_snapshot_id IS NULL
         OR EXISTS (SELECT 1 FROM public.series_forecast_snapshots s WHERE s.id = forecast_snapshot_id AND s.club_id = club_id))
  );

DROP POLICY IF EXISTS scl_select ON public.series_campaign_logs;
CREATE POLICY scl_select ON public.series_campaign_logs
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS scl_insert ON public.series_campaign_logs;
CREATE POLICY scl_insert ON public.series_campaign_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND (event_linked IS NULL
         OR EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_linked AND t.club_id = club_id))
  );

DROP POLICY IF EXISTS scl_update ON public.series_campaign_logs;
CREATE POLICY scl_update ON public.series_campaign_logs
  FOR UPDATE TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id))
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND (event_linked IS NULL
         OR EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_linked AND t.club_id = club_id))
  );

DROP POLICY IF EXISTS sre_select ON public.series_registration_events;
CREATE POLICY sre_select ON public.series_registration_events
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sre_insert ON public.series_registration_events;
CREATE POLICY sre_insert ON public.series_registration_events
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
  );

-- =====================================================================================================
-- RESULTS SINK + id carry (temp, ON COMMIT DROP — moot under ROLLBACK). One row per assertion.
-- =====================================================================================================
CREATE TEMP TABLE _dryrun_results (
  check_name text PRIMARY KEY,
  expected   text,
  got        text,
  pass       boolean
) ON COMMIT DROP;
CREATE TEMP TABLE _dryrun_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

-- =====================================================================================================
-- SECTION A — STRUCTURAL PROOFS (privileged login role; no RLS involved). Pure catalog reads, never abort.
-- =====================================================================================================
DO $struct$
DECLARE
  v_pol_count int;
  v_pol_names text;
  v_rls_all   boolean;
  v_tbl_all   boolean;
BEGIN
  -- A1: all 4 tables exist
  v_tbl_all :=  to_regclass('public.series_forecast_snapshots')  IS NOT NULL
            AND to_regclass('public.series_decision_logs')       IS NOT NULL
            AND to_regclass('public.series_campaign_logs')       IS NOT NULL
            AND to_regclass('public.series_registration_events') IS NOT NULL;
  INSERT INTO _dryrun_results VALUES
    ('A1_tables_exist','all 4 to_regclass NOT NULL', v_tbl_all::text, v_tbl_all);

  -- A2: RLS enabled on all 4
  SELECT bool_and(relrowsecurity) INTO v_rls_all
  FROM pg_class
  WHERE oid IN (
    'public.series_forecast_snapshots'::regclass,
    'public.series_decision_logs'::regclass,
    'public.series_campaign_logs'::regclass,
    'public.series_registration_events'::regclass);
  INSERT INTO _dryrun_results VALUES
    ('A2_rls_enabled','relrowsecurity=true on all 4', coalesce(v_rls_all,false)::text, coalesce(v_rls_all,false));

  -- A3: exactly the 10 expected policies on the 4 NEW tables (IN-list, NOT LIKE — excludes series_posts).
  SELECT count(*), string_agg(policyname, ',' ORDER BY policyname)
    INTO v_pol_count, v_pol_names
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename IN ('series_forecast_snapshots','series_decision_logs',
                      'series_campaign_logs','series_registration_events');
  INSERT INTO _dryrun_results VALUES
    ('A3_policy_set',
     '10 policies: scl_insert,scl_select,scl_update,sdl_insert,sdl_select,sdl_update,sfs_insert,sfs_select,sre_insert,sre_select',
     v_pol_count || ' -> ' || coalesce(v_pol_names,'<none>'),
     v_pol_count = 10
       AND v_pol_names = 'scl_insert,scl_select,scl_update,sdl_insert,sdl_select,sdl_update,sfs_insert,sfs_select,sre_insert,sre_select');

  -- A4: NO DELETE privilege for authenticated on any of the 4
  INSERT INTO _dryrun_results VALUES
    ('A4_no_delete_priv','authenticated has DELETE on none',
     (has_table_privilege('authenticated','public.series_forecast_snapshots','DELETE')::text || '/' ||
      has_table_privilege('authenticated','public.series_decision_logs','DELETE')::text || '/' ||
      has_table_privilege('authenticated','public.series_campaign_logs','DELETE')::text || '/' ||
      has_table_privilege('authenticated','public.series_registration_events','DELETE')::text),
     NOT (has_table_privilege('authenticated','public.series_forecast_snapshots','DELETE')
       OR has_table_privilege('authenticated','public.series_decision_logs','DELETE')
       OR has_table_privilege('authenticated','public.series_campaign_logs','DELETE')
       OR has_table_privilege('authenticated','public.series_registration_events','DELETE')));

  -- A5: grant shape — sfs/sre = SELECT+INSERT only (no UPDATE); sdl/scl = +UPDATE
  INSERT INTO _dryrun_results VALUES
    ('A5_grant_shape','sfs/sre no UPDATE; sdl/scl have UPDATE; all SELECT+INSERT',
     'sfsU='||has_table_privilege('authenticated','public.series_forecast_snapshots','UPDATE')::text||
     ' sreU='||has_table_privilege('authenticated','public.series_registration_events','UPDATE')::text||
     ' sdlU='||has_table_privilege('authenticated','public.series_decision_logs','UPDATE')::text||
     ' sclU='||has_table_privilege('authenticated','public.series_campaign_logs','UPDATE')::text,
     (NOT has_table_privilege('authenticated','public.series_forecast_snapshots','UPDATE'))
     AND (NOT has_table_privilege('authenticated','public.series_registration_events','UPDATE'))
     AND has_table_privilege('authenticated','public.series_decision_logs','UPDATE')
     AND has_table_privilege('authenticated','public.series_campaign_logs','UPDATE')
     AND has_table_privilege('authenticated','public.series_forecast_snapshots','SELECT')
     AND has_table_privilege('authenticated','public.series_forecast_snapshots','INSERT')
     AND has_table_privilege('authenticated','public.series_registration_events','SELECT')
     AND has_table_privilege('authenticated','public.series_registration_events','INSERT'));

  -- A6: all 15 named CHECK constraints exist (sfs=7, sdl=2, scl=2, sre=4).
  INSERT INTO _dryrun_results
  SELECT 'A6_checks_exist',
         '15 named CHECKs present',
         count(*)::text || ' of 15',
         count(*) = 15
  FROM pg_constraint
  WHERE contype='c' AND conname IN (
    'sfs_horizon_chk','sfs_tier_chk','sfs_fc_nonneg','sfs_fc_ordered','sfs_overlay_pct_chk','sfs_gtd_chk','sfs_days_chk',
    'sdl_horizon_chk','sdl_actuals_nonneg',
    'scl_spend_chk','scl_baseline_chk',
    'sre_ref_type_chk','sre_bullet_chk','sre_stage_chk','sre_source_chk');
END
$struct$;

-- =====================================================================================================
-- SECTION B — RLS POSITIVE PATH (as the owner). Captures snapshot/decision ids for later references.
-- =====================================================================================================
DO $pos$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_owned uuid := (SELECT v FROM _fix WHERE k='owned');
  v_ev_o  uuid := (SELECT v FROM _fix WHERE k='event_owned');
  v_snap  uuid;
  v_dec   uuid;
  v_msg   text;
BEGIN
  -- B1: POSITIVE forecast-snapshot insert (owner + matching club/event) must be ACCEPTED.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    INSERT INTO public.series_forecast_snapshots (club_id, event_id, horizon, forecast_low, forecast_base, forecast_high)
    VALUES (v_owned, v_ev_o, 'T-7', 80, 100, 130)
    RETURNING id INTO v_snap;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO _dryrun_ids VALUES ('snap', v_snap);
    INSERT INTO _dryrun_results VALUES ('B1_pos_snapshot_insert','accepted','accepted id='||v_snap, true);
  EXCEPTION WHEN others THEN
    RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO _dryrun_results VALUES ('B1_pos_snapshot_insert','accepted','REJECTED: '||v_msg, false);
  END;

  -- B2: POSITIVE decision-log insert linked to that snapshot must be ACCEPTED.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    INSERT INTO public.series_decision_logs (club_id, event_id, forecast_snapshot_id, decision_horizon, recommended_action)
    VALUES (v_owned, v_ev_o, (SELECT v FROM _dryrun_ids WHERE k='snap'), 'T-7', 'add_overlay')
    RETURNING id INTO v_dec;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO _dryrun_ids VALUES ('dec', v_dec);
    INSERT INTO _dryrun_results VALUES ('B2_pos_decision_insert','accepted','accepted id='||v_dec, true);
  EXCEPTION WHEN others THEN
    RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO _dryrun_results VALUES ('B2_pos_decision_insert','accepted','REJECTED: '||v_msg, false);
  END;

  -- B3: POSITIVE update of that decision's post-event actuals must be ACCEPTED.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    UPDATE public.series_decision_logs
       SET actual_result='ran', actual_entries=118, actual_unique_players=90, actual_reentries=28,
           actual_prize_pool=11800000, actual_overlay_amount=0
     WHERE id = (SELECT v FROM _dryrun_ids WHERE k='dec');
    IF NOT FOUND THEN RAISE EXCEPTION 'update affected 0 rows (RLS hid the row)'; END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO _dryrun_results VALUES ('B3_pos_actuals_update','accepted','accepted', true);
  EXCEPTION WHEN others THEN
    RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO _dryrun_results VALUES ('B3_pos_actuals_update','accepted','REJECTED: '||v_msg, false);
  END;
END
$pos$;

-- =====================================================================================================
-- SECTION C — CROSS-CLUB REJECTION (as the owner). PASS only on insufficient_privilege (RLS WITH CHECK,
-- SQLSTATE 42501). Any OTHER error is recorded FAIL ("wrong-reason reject") so it cannot masquerade as RLS.
-- =====================================================================================================
DO $cross$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_owned uuid := (SELECT v FROM _fix WHERE k='owned');
  v_ev_o  uuid := (SELECT v FROM _fix WHERE k='event_owned');
  v_other uuid := (SELECT v FROM _fix WHERE k='other');
  v_ev_x  uuid := (SELECT v FROM _fix WHERE k='event_other');
  v_msg   text;
BEGIN
  -- C1: club_id = a club the user does NOT own -> rejected by is_club_owner (WITH CHECK).
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    INSERT INTO public.series_forecast_snapshots (club_id, event_id, horizon)
    VALUES (v_other, v_ev_x, 'T-7');
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('C1_foreign_club_insert','rejected (RLS 42501)','ACCEPTED (LEAK!)', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO _dryrun_results VALUES ('C1_foreign_club_insert','rejected (RLS 42501)','rejected: RLS WITH CHECK', true);
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('C1_foreign_club_insert','rejected (RLS 42501)','WRONG-REASON reject: '||v_msg, false);
  END;

  -- C2: owned club_id but event_id from a DIFFERENT club -> rejected by the event/club EXISTS guard.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    INSERT INTO public.series_forecast_snapshots (club_id, event_id, horizon)
    VALUES (v_owned, v_ev_x, 'T-7');
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('C2_cross_event_insert','rejected (RLS 42501)','ACCEPTED (LEAK!)', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO _dryrun_results VALUES ('C2_cross_event_insert','rejected (RLS 42501)','rejected: RLS WITH CHECK', true);
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('C2_cross_event_insert','rejected (RLS 42501)','WRONG-REASON reject: '||v_msg, false);
  END;

  -- C3: decision in owned club but forecast_snapshot_id pointing at a DIFFERENT club's snapshot.
  --     Setup creates the foreign-club snapshot as the privileged role (RLS-bypassing setup, not the test).
  DECLARE v_foreign_snap uuid;
  BEGIN
    INSERT INTO public.series_forecast_snapshots (club_id, event_id, horizon)
    VALUES (v_other, v_ev_x, 'T-7') RETURNING id INTO v_foreign_snap;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    INSERT INTO public.series_decision_logs (club_id, event_id, forecast_snapshot_id, decision_horizon)
    VALUES (v_owned, v_ev_o, v_foreign_snap, 'T-7');
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('C3_cross_snapshot_link','rejected (RLS 42501)','ACCEPTED (LEAK!)', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO _dryrun_results VALUES ('C3_cross_snapshot_link','rejected (RLS 42501)','rejected: RLS WITH CHECK', true);
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('C3_cross_snapshot_link','rejected (RLS 42501)','WRONG-REASON reject: '||v_msg, false);
  END;
END
$cross$;

-- =====================================================================================================
-- SECTION D — DATA-QUALITY (CHECK) REJECTION. As the owner (RLS passes) so the CHECK is what fires.
-- PASS requires GET STACKED DIAGNOSTICS CONSTRAINT_NAME = the intended constraint (right check fired).
-- =====================================================================================================
DO $dq$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_owned uuid := (SELECT v FROM _fix WHERE k='owned');
  v_ev_o  uuid := (SELECT v FROM _fix WHERE k='event_owned');
  v_msg   text;
  v_cons  text;
BEGIN
  -- D1: forecast_low(200) > forecast_base(100) -> sfs_fc_ordered
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
    INSERT INTO public.series_forecast_snapshots (club_id,event_id,horizon,forecast_low,forecast_base,forecast_high)
    VALUES (v_owned,v_ev_o,'T-7',200,100,300);
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('D1_fc_ordered','rejected (sfs_fc_ordered)','ACCEPTED (BAD)', false);
  EXCEPTION
    WHEN check_violation THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      INSERT INTO _dryrun_results VALUES ('D1_fc_ordered','rejected (sfs_fc_ordered)','rejected: '||coalesce(v_cons,'check'), coalesce(v_cons,'')='sfs_fc_ordered');
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('D1_fc_ordered','rejected (sfs_fc_ordered)','OTHER reject: '||v_msg, false);
  END;

  -- D2: overlay_risk_pct=150 (>100) -> sfs_overlay_pct_chk
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
    INSERT INTO public.series_forecast_snapshots (club_id,event_id,horizon,overlay_risk_pct)
    VALUES (v_owned,v_ev_o,'T-7',150);
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('D2_overlay_pct','rejected (sfs_overlay_pct_chk)','ACCEPTED (BAD)', false);
  EXCEPTION
    WHEN check_violation THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      INSERT INTO _dryrun_results VALUES ('D2_overlay_pct','rejected (sfs_overlay_pct_chk)','rejected: '||coalesce(v_cons,'check'), coalesce(v_cons,'')='sfs_overlay_pct_chk');
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('D2_overlay_pct','rejected (sfs_overlay_pct_chk)','OTHER reject: '||v_msg, false);
  END;

  -- D3: spend=-1 (campaign log) -> scl_spend_chk
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
    INSERT INTO public.series_campaign_logs (club_id,spend) VALUES (v_owned,-1);
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('D3_spend_neg','rejected (scl_spend_chk)','ACCEPTED (BAD)', false);
  EXCEPTION
    WHEN check_violation THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      INSERT INTO _dryrun_results VALUES ('D3_spend_neg','rejected (scl_spend_chk)','rejected: '||coalesce(v_cons,'check'), coalesce(v_cons,'')='scl_spend_chk');
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('D3_spend_neg','rejected (scl_spend_chk)','OTHER reject: '||v_msg, false);
  END;

  -- D4: bullet=0 (<1) -> sre_bullet_chk
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
    INSERT INTO public.series_registration_events (club_id,event_id,bullet) VALUES (v_owned,v_ev_o,0);
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('D4_bullet_zero','rejected (sre_bullet_chk)','ACCEPTED (BAD)', false);
  EXCEPTION
    WHEN check_violation THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      INSERT INTO _dryrun_results VALUES ('D4_bullet_zero','rejected (sre_bullet_chk)','rejected: '||coalesce(v_cons,'check'), coalesce(v_cons,'')='sre_bullet_chk');
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('D4_bullet_zero','rejected (sre_bullet_chk)','OTHER reject: '||v_msg, false);
  END;

  -- D5: entry_source='teleport' (bad enum) -> sre_source_chk
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
    INSERT INTO public.series_registration_events (club_id,event_id,entry_source) VALUES (v_owned,v_ev_o,'teleport');
    RESET ROLE;
    INSERT INTO _dryrun_results VALUES ('D5_bad_enum','rejected (sre_source_chk)','ACCEPTED (BAD)', false);
  EXCEPTION
    WHEN check_violation THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      INSERT INTO _dryrun_results VALUES ('D5_bad_enum','rejected (sre_source_chk)','rejected: '||coalesce(v_cons,'check'), coalesce(v_cons,'')='sre_source_chk');
    WHEN others THEN
      RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('D5_bad_enum','rejected (sre_source_chk)','OTHER reject: '||v_msg, false);
  END;
END
$dq$;

-- =====================================================================================================
-- SECTION E — SELECT-side cross-club ISOLATION (read confidentiality). Privileged setup seeds an owned
-- and a foreign row per table (RLS-bypassing); then AS THE OWNER, foreign rows must be INVISIBLE (count=0)
-- while owned rows are visible (count>=1). A SELECT never raises under RLS — it silently filters — so no
-- exception handling is needed; a leak shows up as foreign>0.
-- =====================================================================================================
DO $sel$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_owned uuid := (SELECT v FROM _fix WHERE k='owned');
  v_ev_o  uuid := (SELECT v FROM _fix WHERE k='event_owned');
  v_other uuid := (SELECT v FROM _fix WHERE k='other');
  v_ev_x  uuid := (SELECT v FROM _fix WHERE k='event_other');
  f int; o int;
BEGIN
  -- privileged setup: one owned + one foreign row per table (bypasses RLS as the table owner)
  INSERT INTO public.series_forecast_snapshots (club_id,event_id,horizon) VALUES (v_owned,v_ev_o,'T-7'),(v_other,v_ev_x,'T-7');
  INSERT INTO public.series_decision_logs      (club_id,event_id,decision_horizon) VALUES (v_owned,v_ev_o,'T-7'),(v_other,v_ev_x,'T-7');
  INSERT INTO public.series_campaign_logs      (club_id) VALUES (v_owned),(v_other);
  INSERT INTO public.series_registration_events(club_id,event_id) VALUES (v_owned,v_ev_o),(v_other,v_ev_x);

  -- E1 series_forecast_snapshots
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
  SELECT count(*) INTO f FROM public.series_forecast_snapshots WHERE club_id=v_other;
  SELECT count(*) INTO o FROM public.series_forecast_snapshots WHERE club_id=v_owned;
  RESET ROLE; PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _dryrun_results VALUES ('E1_sfs_select_isolation','foreign=0 & owned>=1','foreign='||f||' owned='||o, f=0 AND o>=1);

  -- E2 series_decision_logs
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
  SELECT count(*) INTO f FROM public.series_decision_logs WHERE club_id=v_other;
  SELECT count(*) INTO o FROM public.series_decision_logs WHERE club_id=v_owned;
  RESET ROLE; PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _dryrun_results VALUES ('E2_sdl_select_isolation','foreign=0 & owned>=1','foreign='||f||' owned='||o, f=0 AND o>=1);

  -- E3 series_campaign_logs
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
  SELECT count(*) INTO f FROM public.series_campaign_logs WHERE club_id=v_other;
  SELECT count(*) INTO o FROM public.series_campaign_logs WHERE club_id=v_owned;
  RESET ROLE; PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _dryrun_results VALUES ('E3_scl_select_isolation','foreign=0 & owned>=1','foreign='||f||' owned='||o, f=0 AND o>=1);

  -- E4 series_registration_events
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
  SELECT count(*) INTO f FROM public.series_registration_events WHERE club_id=v_other;
  SELECT count(*) INTO o FROM public.series_registration_events WHERE club_id=v_owned;
  RESET ROLE; PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _dryrun_results VALUES ('E4_sre_select_isolation','foreign=0 & owned>=1','foreign='||f||' owned='||o, f=0 AND o>=1);
END
$sel$;

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
-- UNDO EVERYTHING — no DDL, no data, no role/claims persist. (Then run the liveness probe to confirm.)
-- =====================================================================================================
ROLLBACK;
