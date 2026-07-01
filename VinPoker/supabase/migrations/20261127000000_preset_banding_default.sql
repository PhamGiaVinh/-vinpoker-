-- 20261127000000_preset_banding_default.sql
-- ============================================================================================
-- Group payout (banding) is now the DEFAULT for every preset archetype (DAILY/INTL/MULTI/TRITON),
-- not just the separate LIVE_STANDARD choice: `computePayouts` (src/lib/payoutEngine.ts, engine
-- v1.1) groups ranks 10+ into equal-amount bands using each archetype's OWN curve for ranks 1-9
-- (previously LIVE_STANDARD's banding always used a hardcoded INTL base). No new archetype
-- string, no schema change, no new column — this migration ONLY widens the ONE existing
-- `apply_payout_run` check that currently exempts `LIVE_STANDARD` from `LAST_NOT_FLOOR` (the
-- "last paid rank must equal the min-cash floor exactly" check), so it ALSO exempts any run whose
-- itm_places > 9 for ANY archetype, since the last rank of a >9-place run is now legitimately part
-- of a band (sits at/above the floor, not pinned to it exactly) regardless of archetype label.
--
-- Uses p_itm_places (the function PARAMETER, always fresh/authoritative for this call), NOT
-- v_run.itm_places (the ROW COLUMN) — the column is only ever SET at the end of apply_payout_run
-- itself (see the final UPDATE in this same function), so it is NULL for every fresh/draft run and
-- would silently no-op the check if used here instead.
--
-- FLOOR_MISMATCH, SUM_MISMATCH, POSITION_GAP_OR_DUP, and NOT_MONOTONE (which already allows
-- adjacent-rank equality) are UNCHANGED and still fully enforced — this migration only relaxes
-- the single LAST_NOT_FLOOR check, and only for runs where banding actually applies.
--
-- SOURCE-ONLY. Apply via the controlled Management-API BEGIN..COMMIT runbook (NOT db push); do
-- NOT write schema_migrations. No feature flag gates this — owner-approved direct/no-flag rollout
-- (see docs/payout/PR-preset-banding-runbook.md).
-- ============================================================================================

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
  -- Defense-in-depth (audit finding, non-blocking but cheap): p_itm_places is REQUIRED (no DEFAULT)
  -- and the sole real caller (compute-payouts Edge) always supplies it, but fail LOUDLY rather than
  -- silently disabling the LAST_NOT_FLOOR bypass (NULL > 9 → NULL → treated as false) if some future
  -- caller ever omits it.
  IF p_itm_places IS NULL THEN RAISE EXCEPTION 'ITM_PLACES_REQUIRED'; END IF;
  v_is_custom := (v_run.archetype = 'CUSTOM');
  -- WIDENED (was: archetype = 'LIVE_STANDARD' only): ranks 10+ now band by default for EVERY
  -- archetype (engine v1.1), so the LAST_NOT_FLOOR bypass below must key on "did banding actually
  -- apply" (p_itm_places > 9), not on the archetype label. p_itm_places is the fresh call
  -- parameter — v_run.itm_places (the column) is NULL until the UPDATE at the end of this
  -- function, so it cannot be used here.
  v_is_banded := (v_run.archetype = 'LIVE_STANDARD') OR (p_itm_places > 9);

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

  -- snapshot binding (CUSTOM bypasses floor=0; banded runs keep the real min-cash floor → FLOOR_MISMATCH enforced)
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
  -- CUSTOM + banded additionally require every paid rank > 0 (monotone ⇒ checking the last/smallest suffices)
  IF v_is_custom AND v_last <= 0       THEN RAISE EXCEPTION 'CUSTOM_ZERO_AMOUNT'; END IF;
  IF v_is_banded AND v_last <= 0       THEN RAISE EXCEPTION 'BANDED_ZERO_AMOUNT'; END IF;

  -- min-cash invariant — PRESET/INDIVIDUAL ONLY. CUSTOM bypasses entirely; a banded run's last
  -- group sits above (or at) the floor, so it skips LAST_NOT_FLOOR (but FLOOR_MISMATCH above still
  -- binds its floor).
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
-- ROLLBACK (manual, controlled — no feature flag exists for this behavior; per the owner's
-- explicit no-flag choice, reverting requires restoring the prior function body):
--   Re-apply the 20261124000000_payout_banded.sql version of apply_payout_run verbatim (the ONLY
--   difference is the single v_is_banded line above) via another controlled BEGIN..COMMIT, then
--   revert/redeploy the prior compute-payouts Edge + payoutEngine.ts (git revert this PR).
--   Already-applied payout runs made under the new banded math are NOT retroactively changed by
--   this rollback — amounts already paid out stay as paid.
-- ============================================================================================
