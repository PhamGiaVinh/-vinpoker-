-- ============================================================================================
-- Payout "Engine 3-neo" — NATIVE CUSTOM mode (PR-C). ADDITIVE on top of 20261120000000.
-- ============================================================================================
-- A club may dictate the exact payout split as basis points (percent_bp; Σ = 10000). CUSTOM is a
-- first-class archetype: one official run, source='close', archetype='CUSTOM' — NO temporary preset
-- close, NO superseded throwaway. Server is authoritative: prepare freezes the percents, the Edge
-- computes amounts from the frozen snapshot, apply re-verifies (Σ=pool, contiguous, descending, >0).
-- CUSTOM BYPASSES the preset min-cash floor (effective_floor = 0) by design; protection is structural.
--
-- Changes (all additive / replace-in-place):
--   1. widen tournament_payout_runs.archetype CHECK to include 'CUSTOM'
--   2. add nullable tournament_payout_runs.custom_percents jsonb (frozen percents for CUSTOM runs)
--   3. DROP the OLD prepare_payout_snapshot(9-arg) exact signature, recreate with p_custom_percents,
--      re-issue REVOKE/GRANT, and verify the old overload is gone
--   4. CREATE OR REPLACE apply_payout_run with an ISOLATED CUSTOM branch (preset path byte-behaviour-
--      identical)
-- save_tournament_prizes_v2 is UNCHANGED — it copies v_applied.archetype, so manual edit after a
-- CUSTOM close works once the CHECK allows 'CUSTOM'.
--
-- DO NOT db push / write schema_migrations — controlled Management-API apply only.
-- ============================================================================================

-- 1+2. schema: widen archetype CHECK + add custom_percents -----------------------------------
ALTER TABLE public.tournament_payout_runs DROP CONSTRAINT IF EXISTS tournament_payout_runs_archetype_check;
ALTER TABLE public.tournament_payout_runs
  ADD CONSTRAINT tournament_payout_runs_archetype_check
  CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON','CUSTOM'));

ALTER TABLE public.tournament_payout_runs ADD COLUMN IF NOT EXISTS custom_percents jsonb;
COMMENT ON COLUMN public.tournament_payout_runs.custom_percents IS
  'CUSTOM runs only: frozen [{position, percent_bp}] basis points (Σ=10000). NULL for preset archetypes.';

-- 3. prepare_payout_snapshot — DROP old exact signature, recreate with p_custom_percents ------
DROP FUNCTION IF EXISTS public.prepare_payout_snapshot(
  uuid, numeric, text, numeric, bigint, bigint, text, boolean, text);

CREATE FUNCTION public.prepare_payout_snapshot(
  p_tournament_id      uuid,
  p_itm_percent        numeric,
  p_archetype          text,
  p_min_cash_x         numeric,
  p_rounding_unit      bigint,
  p_prize_pool_override bigint  DEFAULT NULL,
  p_override_reason    text     DEFAULT NULL,
  p_regenerate         boolean  DEFAULT false,
  p_reason             text     DEFAULT NULL,
  p_custom_percents    jsonb    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_t            public.tournaments%ROWTYPE;
  v_paid         integer;
  v_default_pool bigint;
  v_pool         bigint;
  v_floor        bigint;
  v_itm          numeric;
  v_overridden   boolean := false;
  v_applied      public.tournament_payout_runs%ROWTYPE;
  v_draft        public.tournament_payout_runs%ROWTYPE;
  v_supersedes   uuid := NULL;
  v_run          public.tournament_payout_runs%ROWTYPE;
  v_bp_count     integer;
  v_bp_sum       integer;
  v_bp_contig    boolean;
  v_bp_pos       boolean;
  v_bp_desc      boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- lock tournament (serialises vs the entry-insert trigger's FOR SHARE)
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_t.event_id IS NOT NULL THEN RAISE EXCEPTION 'MULTIDAY_UNSUPPORTED'; END IF;

  IF p_archetype NOT IN ('DAILY','INTL','MULTI','TRITON','CUSTOM') THEN RAISE EXCEPTION 'BAD_ARCHETYPE'; END IF;

  IF p_archetype = 'CUSTOM' THEN
    -- validate frozen custom percents (basis points): contiguous 1..K, each>0, non-increasing, Σ=10000
    IF p_custom_percents IS NULL OR jsonb_typeof(p_custom_percents) <> 'array' THEN
      RAISE EXCEPTION 'CUSTOM_PERCENTS_REQUIRED';
    END IF;
    WITH p AS (
      SELECT (e.value->>'position')::int AS position, (e.value->>'percent_bp')::int AS bp
      FROM jsonb_array_elements(p_custom_percents) e
    ), ord AS (
      SELECT position, bp, row_number() OVER (ORDER BY position) AS rn,
             lag(bp) OVER (ORDER BY position) AS prev_bp
      FROM p
    )
    SELECT count(*), COALESCE(sum(bp), 0),
           COALESCE(bool_and(position = rn), true),
           COALESCE(bool_and(bp > 0), true),
           COALESCE(bool_and(prev_bp IS NULL OR bp <= prev_bp), true)
      INTO v_bp_count, v_bp_sum, v_bp_contig, v_bp_pos, v_bp_desc
    FROM ord;
    IF v_bp_count < 1    THEN RAISE EXCEPTION 'CUSTOM_EMPTY'; END IF;
    IF NOT v_bp_contig   THEN RAISE EXCEPTION 'CUSTOM_RANK_GAP'; END IF;
    IF NOT v_bp_pos      THEN RAISE EXCEPTION 'CUSTOM_BP_NONPOS'; END IF;
    IF NOT v_bp_desc     THEN RAISE EXCEPTION 'CUSTOM_BP_NOT_DESC'; END IF;
    IF v_bp_sum <> 10000 THEN RAISE EXCEPTION 'CUSTOM_BP_SUM'; END IF;
  ELSE
    IF p_custom_percents IS NOT NULL THEN RAISE EXCEPTION 'CUSTOM_PERCENTS_NOT_ALLOWED'; END IF;
    IF p_itm_percent IS NULL OR p_itm_percent <= 0 OR p_itm_percent >= 1 THEN RAISE EXCEPTION 'BAD_ITM_PERCENT'; END IF;
  END IF;

  IF p_min_cash_x IS NULL OR p_min_cash_x <= 0 THEN RAISE EXCEPTION 'BAD_MIN_CASH_X'; END IF;
  IF p_rounding_unit IS NULL OR p_rounding_unit <= 0 THEN RAISE EXCEPTION 'BAD_ROUNDING_UNIT'; END IF;

  -- terminal close (one-way; idempotent)
  IF v_t.registration_closed_at IS NULL THEN
    UPDATE public.tournaments SET registration_closed_at = now() WHERE id = p_tournament_id;
  END IF;

  -- official paid entries (re-entries each count). Defensive exclusion of void/cancel statuses if any.
  SELECT count(*) INTO v_paid
    FROM public.tournament_entries
    WHERE tournament_id = p_tournament_id
      AND COALESCE(status, '') NOT IN ('void','voided','cancelled','canceled','refunded','rejected');
  IF v_paid < 1 THEN RAISE EXCEPTION 'NO_PAID_ENTRIES'; END IF;

  IF p_archetype = 'CUSTOM' AND v_bp_count > v_paid THEN RAISE EXCEPTION 'CUSTOM_MORE_PLACES_THAN_ENTRIES'; END IF;

  -- pool: default = paid x buy_in; override allowed but must differ-with-reason
  v_default_pool := v_paid::bigint * v_t.buy_in::bigint;
  IF p_prize_pool_override IS NOT NULL AND p_prize_pool_override <> v_default_pool THEN
    IF p_prize_pool_override <= 0 THEN RAISE EXCEPTION 'BAD_PRIZE_POOL_OVERRIDE'; END IF;
    IF p_override_reason IS NULL OR length(btrim(p_override_reason)) = 0 THEN
      RAISE EXCEPTION 'PRIZE_POOL_OVERRIDE_REASON_REQUIRED';
    END IF;
    v_pool := p_prize_pool_override;
    v_overridden := true;
  ELSE
    v_pool := v_default_pool;
  END IF;

  -- CUSTOM bypasses the min-cash floor (effective_floor = 0); itm_percent stored as K/paid (metadata)
  IF p_archetype = 'CUSTOM' THEN
    v_floor := 0;
    v_itm   := v_bp_count::numeric / v_paid;
  ELSE
    v_floor := floor(p_min_cash_x * (v_t.buy_in::numeric + COALESCE(v_t.rake_amount, 0)::numeric))::bigint;
    v_itm   := p_itm_percent;
  END IF;

  -- single-applied resume / regenerate (never supersede here)
  SELECT * INTO v_applied FROM public.tournament_payout_runs
    WHERE tournament_id = p_tournament_id AND status = 'applied' LIMIT 1;

  IF v_applied.id IS NOT NULL AND NOT p_regenerate THEN
    RETURN jsonb_build_object('status','already_applied','run_id', v_applied.id,
      'entries_snapshot', v_applied.entries_snapshot, 'buy_in_snapshot', v_applied.buy_in_snapshot,
      'rake_snapshot', v_applied.rake_snapshot, 'prize_pool_snapshot', v_applied.prize_pool_snapshot,
      'effective_floor', v_applied.effective_floor, 'itm_percent', v_applied.itm_percent,
      'archetype', v_applied.archetype, 'min_cash_x', v_applied.min_cash_x, 'rounding_unit', v_applied.rounding_unit);
  END IF;

  IF p_regenerate THEN
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'REGENERATE_REASON_REQUIRED'; END IF;
    v_supersedes := v_applied.id;  -- recorded on the draft; applied is touched ONLY in apply_payout_run
    DELETE FROM public.tournament_payout_runs
      WHERE tournament_id = p_tournament_id AND status = 'draft_snapshot';  -- clear stale drafts
  ELSE
    -- resume an existing draft instead of creating a duplicate (concurrent prepare)
    SELECT * INTO v_draft FROM public.tournament_payout_runs
      WHERE tournament_id = p_tournament_id AND status = 'draft_snapshot'
      ORDER BY generated_at DESC LIMIT 1;
    IF v_draft.id IS NOT NULL THEN
      RETURN jsonb_build_object('status','resumed','run_id', v_draft.id,
        'entries_snapshot', v_draft.entries_snapshot, 'buy_in_snapshot', v_draft.buy_in_snapshot,
        'rake_snapshot', v_draft.rake_snapshot, 'prize_pool_snapshot', v_draft.prize_pool_snapshot,
        'effective_floor', v_draft.effective_floor, 'itm_percent', v_draft.itm_percent,
        'archetype', v_draft.archetype, 'min_cash_x', v_draft.min_cash_x, 'rounding_unit', v_draft.rounding_unit);
    END IF;
  END IF;

  INSERT INTO public.tournament_payout_runs(
    tournament_id, status, supersedes_run_id, entries_snapshot, buy_in_snapshot, rake_snapshot,
    prize_pool_snapshot, prize_pool_overridden, override_reason, effective_floor,
    itm_percent, archetype, min_cash_x, rounding_unit, custom_percents, source, reason, generated_by)
  VALUES (
    p_tournament_id, 'draft_snapshot', v_supersedes, v_paid, v_t.buy_in, COALESCE(v_t.rake_amount,0),
    v_pool, v_overridden, CASE WHEN v_overridden THEN p_override_reason END, v_floor,
    v_itm, p_archetype, p_min_cash_x, p_rounding_unit,
    CASE WHEN p_archetype = 'CUSTOM' THEN p_custom_percents ELSE NULL END,
    CASE WHEN p_regenerate THEN 'regenerate' ELSE 'close' END,
    CASE WHEN p_archetype = 'CUSTOM' THEN COALESCE(p_reason, 'CUSTOM_PERCENT') ELSE p_reason END,
    v_uid)
  RETURNING * INTO v_run;

  RETURN jsonb_build_object('status','prepared','run_id', v_run.id,
    'entries_snapshot', v_run.entries_snapshot, 'buy_in_snapshot', v_run.buy_in_snapshot,
    'rake_snapshot', v_run.rake_snapshot, 'prize_pool_snapshot', v_run.prize_pool_snapshot,
    'effective_floor', v_run.effective_floor, 'itm_percent', v_run.itm_percent,
    'archetype', v_run.archetype, 'min_cash_x', v_run.min_cash_x, 'rounding_unit', v_run.rounding_unit);
END;
$$;

-- re-issue grants for the recreated function (DROP removed the old grants)
REVOKE ALL ON FUNCTION public.prepare_payout_snapshot(
  uuid, numeric, text, numeric, bigint, bigint, text, boolean, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prepare_payout_snapshot(
  uuid, numeric, text, numeric, bigint, bigint, text, boolean, text, jsonb) TO authenticated;

-- verify the OLD 9-arg overload is gone (mandatory correction #1)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'prepare_payout_snapshot'
      AND pg_get_function_identity_arguments(p.oid) =
          'p_tournament_id uuid, p_itm_percent numeric, p_archetype text, p_min_cash_x numeric, p_rounding_unit bigint, p_prize_pool_override bigint, p_override_reason text, p_regenerate boolean, p_reason text'
  ) THEN
    RAISE EXCEPTION 'OLD prepare_payout_snapshot 9-arg overload still present after recreate';
  END IF;
END $$;

-- 4. apply_payout_run — add an ISOLATED CUSTOM branch; preset path byte-behaviour-identical -----
CREATE OR REPLACE FUNCTION public.apply_payout_run(
  p_run_id         uuid,
  p_rows           jsonb,
  p_prize_pool     bigint,
  p_itm_places     integer,
  p_effective_floor bigint,
  p_warnings       jsonb DEFAULT '[]'::jsonb,
  p_engine_version text  DEFAULT NULL,
  p_alpha_version  text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_run        public.tournament_payout_runs%ROWTYPE;
  v_t          public.tournaments%ROWTYPE;
  v_count      integer;
  v_sum        numeric;
  v_contig     boolean;
  v_nonneg     boolean;
  v_monotone   boolean;
  v_last       numeric;
  v_max        numeric;
  v_pool_below boolean := (p_warnings @> '["POOL_BELOW_MIN_CASH"]'::jsonb);
  v_is_custom  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_run FROM public.tournament_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RUN_NOT_FOUND'; END IF;
  IF v_run.status <> 'draft_snapshot' THEN RAISE EXCEPTION 'RUN_NOT_DRAFT'; END IF;
  v_is_custom := (v_run.archetype = 'CUSTOM');

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_run.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT public.is_tournament_registration_closed(v_run.tournament_id) THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_CLOSED';
  END IF;

  -- snapshot binding
  IF p_prize_pool <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'POOL_MISMATCH'; END IF;
  IF p_effective_floor < 0 OR p_effective_floor > v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'FLOOR_RANGE'; END IF;
  -- preset floor binding (CUSTOM bypasses: effective_floor = 0, no min-cash pin)
  IF NOT v_is_custom AND NOT v_pool_below AND p_effective_floor <> v_run.effective_floor THEN RAISE EXCEPTION 'FLOOR_MISMATCH'; END IF;

  -- structural validation of p_rows (set-based) — applies to ALL archetypes incl. CUSTOM
  WITH r AS (
    SELECT (e.value->>'position')::int AS position, (e.value->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_rows) e
  ), ord AS (
    SELECT position, amount,
           row_number() OVER (ORDER BY position) AS rn,
           lag(amount)  OVER (ORDER BY position) AS prev_amt
    FROM r
  )
  SELECT count(*),
         COALESCE(sum(amount), 0),
         COALESCE(max(amount), 0),
         COALESCE(bool_and(position = rn), true),
         COALESCE(bool_and(amount >= 0), true),
         COALESCE(bool_and(prev_amt IS NULL OR amount <= prev_amt), true),
         (SELECT amount FROM ord WHERE rn = (SELECT max(rn) FROM ord))
    INTO v_count, v_sum, v_max, v_contig, v_nonneg, v_monotone, v_last
  FROM ord;

  IF v_count < 1                       THEN RAISE EXCEPTION 'EMPTY_ROWS'; END IF;
  IF v_count <> p_itm_places           THEN RAISE EXCEPTION 'ITM_PLACES_MISMATCH'; END IF;
  IF NOT v_contig                      THEN RAISE EXCEPTION 'POSITION_GAP_OR_DUP'; END IF;
  IF NOT v_nonneg                      THEN RAISE EXCEPTION 'NEGATIVE_AMOUNT'; END IF;
  IF NOT v_monotone                    THEN RAISE EXCEPTION 'NOT_MONOTONE'; END IF;
  IF v_sum <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SUM_MISMATCH'; END IF;
  IF v_max > 9999999999.99             THEN RAISE EXCEPTION 'PAYOUT_AMOUNT_EXCEEDS_COLUMN_LIMIT'; END IF;
  -- CUSTOM additionally requires every paid rank > 0 (the engine guarantees this; re-check defensively)
  IF v_is_custom AND v_last <= 0       THEN RAISE EXCEPTION 'CUSTOM_ZERO_AMOUNT'; END IF;

  -- min-cash invariant — PRESET ONLY (CUSTOM bypasses the floor by design)
  IF NOT v_is_custom THEN
    IF v_count >= 2 AND NOT v_pool_below THEN
      IF v_last <> p_effective_floor THEN RAISE EXCEPTION 'LAST_NOT_FLOOR'; END IF;
    ELSIF v_count = 1 THEN
      IF v_last <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SINGLE_NOT_WHOLE_POOL'; END IF;
    END IF;
  END IF;

  -- write official payout (percentage recomputed server-side, never trusted from input)
  DELETE FROM public.tournament_prizes WHERE tournament_id = v_run.tournament_id;
  INSERT INTO public.tournament_prizes (tournament_id, position, percentage, amount)
  SELECT v_run.tournament_id,
         (e.value->>'position')::int,
         round(((e.value->>'amount')::numeric / NULLIF(v_run.prize_pool_snapshot, 0)) * 100, 2),
         (e.value->>'amount')::numeric
  FROM jsonb_array_elements(p_rows) e;

  UPDATE public.tournaments
     SET prize_pool = v_run.prize_pool_snapshot, itm_places = p_itm_places
   WHERE id = v_run.tournament_id;

  IF v_run.supersedes_run_id IS NOT NULL THEN
    UPDATE public.tournament_payout_runs SET status = 'superseded'
      WHERE id = v_run.supersedes_run_id AND status = 'applied';
  END IF;

  UPDATE public.tournament_payout_runs
     SET status = 'applied', itm_places = p_itm_places, warnings = COALESCE(p_warnings, '[]'::jsonb),
         engine_version = p_engine_version, alpha_version = p_alpha_version, generated_at = now()
   WHERE id = p_run_id;

  RETURN jsonb_build_object('status','applied','run_id', p_run_id, 'itm_places', p_itm_places,
    'prize_pool', v_run.prize_pool_snapshot);
END;
$$;

-- apply_payout_run is CREATE OR REPLACE (same signature) → existing REVOKE/GRANT persist.

-- ============================================================================================
-- ROLLBACK (manual, controlled):
--   -- restore the prior function bodies from 20261120000000 (prepare 9-arg + apply without CUSTOM)
--   DROP FUNCTION IF EXISTS public.prepare_payout_snapshot(uuid,numeric,text,numeric,bigint,bigint,text,boolean,text,jsonb);
--   <re-run 20261120000000's prepare_payout_snapshot + apply_payout_run definitions>
--   -- the custom_percents column + widened CHECK are harmless to leave; narrow the CHECK only if no
--   -- CUSTOM run exists:  ... CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON'));
-- Frontend kill-switch (instant, no DB): FEATURES.payoutCustomMode = false → CUSTOM path never invoked.
-- ============================================================================================
