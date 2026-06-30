-- ============================================================================================
-- Payout "Engine 3-neo" — BANDED preset `LIVE_STANDARD` (PR-D). ADDITIVE on top of 20261123 (CUSTOM).
-- ============================================================================================
-- LIVE_STANDARD: final table (ranks 1-9) pays per rank; places 10+ are grouped into equal-amount
-- bands (e.g. N=19 -> 1..9, 10-12, 13-15, 16-19). The Edge computes amounts from a base INTL curve,
-- then bands ranks 10+; the LAST band may sit ABOVE the min-cash floor, so apply BYPASSES only
-- LAST_NOT_FLOOR for LIVE_STANDARD and STILL enforces FLOOR_MISMATCH, SUM_MISMATCH, contiguous,
-- positive, descending. No new DB column (bands derived from N). effective_floor is the real min-cash
-- floor (preset path) so the Edge has the floor for the base curve.
--
-- Built on the POST-CUSTOM functions (20261123): CUSTOM logic is preserved verbatim — this only ADDS
-- 'LIVE_STANDARD' to the archetype CHECK + prepare's archetype list, and a v_is_banded branch in apply.
-- prepare_payout_snapshot keeps the same 10-arg signature -> CREATE OR REPLACE (no DROP, grants persist).
--
-- DO NOT db push / write schema_migrations — controlled Management-API apply only (AFTER 20261123).
-- ============================================================================================

-- 1. widen archetype CHECK to include LIVE_STANDARD (keep CUSTOM) -----------------------------
ALTER TABLE public.tournament_payout_runs DROP CONSTRAINT IF EXISTS tournament_payout_runs_archetype_check;
ALTER TABLE public.tournament_payout_runs
  ADD CONSTRAINT tournament_payout_runs_archetype_check
  CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON','CUSTOM','LIVE_STANDARD'));

-- 2. prepare_payout_snapshot — same 10-arg sig; ONLY widen the archetype list (LIVE_STANDARD uses
--    the preset floor/itm branch, no custom_percents). CUSTOM logic preserved verbatim. ----------
CREATE OR REPLACE FUNCTION public.prepare_payout_snapshot(
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

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_t.event_id IS NOT NULL THEN RAISE EXCEPTION 'MULTIDAY_UNSUPPORTED'; END IF;

  -- LIVE_STANDARD added; it is a preset-shaped archetype (uses itm% + min-cash floor, no custom_percents)
  IF p_archetype NOT IN ('DAILY','INTL','MULTI','TRITON','CUSTOM','LIVE_STANDARD') THEN RAISE EXCEPTION 'BAD_ARCHETYPE'; END IF;

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
    -- DAILY/INTL/MULTI/TRITON/LIVE_STANDARD: itm%-based, never carries custom_percents
    IF p_custom_percents IS NOT NULL THEN RAISE EXCEPTION 'CUSTOM_PERCENTS_NOT_ALLOWED'; END IF;
    IF p_itm_percent IS NULL OR p_itm_percent <= 0 OR p_itm_percent >= 1 THEN RAISE EXCEPTION 'BAD_ITM_PERCENT'; END IF;
  END IF;

  IF p_min_cash_x IS NULL OR p_min_cash_x <= 0 THEN RAISE EXCEPTION 'BAD_MIN_CASH_X'; END IF;
  IF p_rounding_unit IS NULL OR p_rounding_unit <= 0 THEN RAISE EXCEPTION 'BAD_ROUNDING_UNIT'; END IF;

  IF v_t.registration_closed_at IS NULL THEN
    UPDATE public.tournaments SET registration_closed_at = now() WHERE id = p_tournament_id;
  END IF;

  SELECT count(*) INTO v_paid
    FROM public.tournament_entries
    WHERE tournament_id = p_tournament_id
      AND COALESCE(status, '') NOT IN ('void','voided','cancelled','canceled','refunded','rejected');
  IF v_paid < 1 THEN RAISE EXCEPTION 'NO_PAID_ENTRIES'; END IF;

  IF p_archetype = 'CUSTOM' AND v_bp_count > v_paid THEN RAISE EXCEPTION 'CUSTOM_MORE_PLACES_THAN_ENTRIES'; END IF;

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

  -- CUSTOM bypasses the min-cash floor (effective_floor=0). LIVE_STANDARD + presets store the real
  -- min-cash floor (the Edge needs it for the base curve; apply keeps FLOOR_MISMATCH for them).
  IF p_archetype = 'CUSTOM' THEN
    v_floor := 0;
    v_itm   := v_bp_count::numeric / v_paid;
  ELSE
    v_floor := floor(p_min_cash_x * (v_t.buy_in::numeric + COALESCE(v_t.rake_amount, 0)::numeric))::bigint;
    v_itm   := p_itm_percent;
  END IF;

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
    v_supersedes := v_applied.id;
    DELETE FROM public.tournament_payout_runs
      WHERE tournament_id = p_tournament_id AND status = 'draft_snapshot';
  ELSE
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

-- 3. apply_payout_run — add v_is_banded; LIVE_STANDARD skips ONLY LAST_NOT_FLOOR. Everything else
--    (FLOOR_MISMATCH, SUM_MISMATCH, contiguous, positive, descending) STILL enforced. CUSTOM intact. -
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
  v_is_banded  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_run FROM public.tournament_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RUN_NOT_FOUND'; END IF;
  IF v_run.status <> 'draft_snapshot' THEN RAISE EXCEPTION 'RUN_NOT_DRAFT'; END IF;
  v_is_custom := (v_run.archetype = 'CUSTOM');
  v_is_banded := (v_run.archetype = 'LIVE_STANDARD');

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

  -- snapshot binding (CUSTOM bypasses floor=0; LIVE_STANDARD keeps the real min-cash floor → FLOOR_MISMATCH enforced)
  IF p_prize_pool <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'POOL_MISMATCH'; END IF;
  IF p_effective_floor < 0 OR p_effective_floor > v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'FLOOR_RANGE'; END IF;
  IF NOT v_is_custom AND NOT v_pool_below AND p_effective_floor <> v_run.effective_floor THEN RAISE EXCEPTION 'FLOOR_MISMATCH'; END IF;

  -- structural validation of p_rows — applies to ALL archetypes (contiguous, Σ=pool, non-increasing)
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
  -- CUSTOM + LIVE_STANDARD additionally require every paid rank > 0 (monotone ⇒ checking the last/smallest suffices)
  IF v_is_custom AND v_last <= 0       THEN RAISE EXCEPTION 'CUSTOM_ZERO_AMOUNT'; END IF;
  IF v_is_banded AND v_last <= 0       THEN RAISE EXCEPTION 'BANDED_ZERO_AMOUNT'; END IF;

  -- min-cash invariant — PRESET ONLY. CUSTOM bypasses entirely; LIVE_STANDARD's banded last group
  -- sits above the floor, so it skips LAST_NOT_FLOOR (but FLOOR_MISMATCH above still binds its floor).
  IF NOT v_is_custom AND NOT v_is_banded THEN
    IF v_count >= 2 AND NOT v_pool_below THEN
      IF v_last <> p_effective_floor THEN RAISE EXCEPTION 'LAST_NOT_FLOOR'; END IF;
    ELSIF v_count = 1 THEN
      IF v_last <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SINGLE_NOT_WHOLE_POOL'; END IF;
    END IF;
  END IF;

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

-- ============================================================================================
-- ROLLBACK (manual, controlled): restore the 20261123 prepare/apply bodies (CUSTOM, no LIVE_STANDARD)
-- + narrow the CHECK back to ('DAILY','INTL','MULTI','TRITON','CUSTOM') — only if no LIVE_STANDARD run
-- exists. Frontend kill-switch (instant, no DB): FEATURES.payoutBandedMode = false.
-- ============================================================================================
