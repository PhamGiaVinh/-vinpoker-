-- ============================================================================
-- Accounting Control W3-B2 — per-place payout recipients (READ, for cashier UI)
-- get_tournament_payout_recipients(p_tournament_id) → jsonb. SOURCE-ONLY, NOT APPLIED.
-- Controlled apply only (owner-gated Management API). NO supabase db push, NO
-- deploy_db, NO schema_migrations write.
-- ============================================================================
-- Feeds the cashier "Đã trả thưởng" section (B2 write UI). Returns, per IN-MONEY
-- finished place, the tuple the operator needs to record a prize payment:
--   { finishedPlace, recipientName, prizeAmount, isPaid, paidAt, method }.
-- The list is DISPLAY-only; the actual money guarantee is in the WRITE RPC
-- record_tournament_prize_payment (already live, 20261216000000) which SERVER-DERIVES
-- amount + recipient from (tournament_id, finished_place). This read is SECURITY
-- DEFINER so it can resolve club_members.full_name (recipient names) exactly as the
-- write RPC does — the same derivation the cashier is about to act on.
--
-- DERIVATION (byte-consistent with get_club_payout_liability / get_member_history):
--   in-money place = tournament_entries.finished_place that has a matching
--   tournament_prizes.position; prizeAmount = tournament_prizes.amount for that place.
--   finalize_tournament_results collapses re-entries → one finish per distinct player,
--   so each place appears once. Out-of-money finishers (no prize row) are excluded.
--   isPaid / paidAt / method come from the tournament_prize_payments ledger (status='paid').
-- AUTHZ: actor = auth.uid(); the tournament's club OWNER or a club_cashier ONLY
--   (mirrors record_tournament_prize_payment). Forbidden → 42501. anon revoked.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_tournament_payout_recipients(uuid);
--   (companion: docs/emergency_rollbacks/20261217000000_get_tournament_payout_recipients_rollback.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_tournament_payout_recipients(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club  uuid;
  v_itm   integer;
  v_authz boolean;
  v_places jsonb;
  v_owed   numeric := 0;
  v_paid   numeric := 0;
  v_paid_count integer := 0;
  v_total_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT club_id, itm_places INTO v_club, v_itm
  FROM public.tournaments WHERE id = p_tournament_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING errcode = 'P0002';
  END IF;

  -- Authorization: club OWNER or club_cashier ONLY (same gate as the write RPC).
  SELECT EXISTS (
    SELECT 1 FROM public.clubs c
    LEFT JOIN public.club_cashiers cc ON cc.club_id = c.id AND cc.user_id = v_actor
    WHERE c.id = v_club
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authz;
  IF NOT v_authz THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- One row per IN-MONEY finished place: recipient (SECDEF-resolved), prize, paid status.
  WITH payable AS (
    SELECT
      e.finished_place                                    AS finished_place,
      tp.amount                                           AS prize_amount,
      COALESCE(cm.full_name, pp.recipient_name, 'Khách')  AS recipient_name,
      (pp.id IS NOT NULL)                                 AS is_paid,
      pp.paid_at                                          AS paid_at,
      pp.method                                           AS method
    FROM public.tournament_entries e
    JOIN public.tournament_prizes tp
      ON tp.tournament_id = e.tournament_id AND tp.position = e.finished_place
    LEFT JOIN public.club_members cm
      ON cm.id = e.member_id
    LEFT JOIN public.tournament_prize_payments pp
      ON pp.tournament_id = e.tournament_id
     AND pp.finished_place = e.finished_place
     AND pp.status = 'paid'
    WHERE e.tournament_id = p_tournament_id
      AND e.finished_place IS NOT NULL
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'finishedPlace', finished_place,
      'recipientName', recipient_name,
      'prizeAmount',   prize_amount,
      'isPaid',        is_paid,
      'paidAt',        paid_at,
      'method',        method
    ) ORDER BY finished_place ASC), '[]'::jsonb),
    COALESCE(SUM(prize_amount), 0),
    COALESCE(SUM(prize_amount) FILTER (WHERE is_paid), 0),
    COALESCE(COUNT(*) FILTER (WHERE is_paid), 0),
    COALESCE(COUNT(*), 0)
  INTO v_places, v_owed, v_paid, v_paid_count, v_total_count
  FROM payable;

  RETURN jsonb_build_object(
    'tournamentId', p_tournament_id,
    'itmPlaces',    v_itm,
    'owedTotal',    v_owed,
    'paidTotal',    v_paid,
    'paidCount',    v_paid_count,
    'totalCount',   v_total_count,
    'places',       v_places
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tournament_payout_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_payout_recipients(uuid) TO authenticated;

-- ============================================================================
-- DRY-RUN (controlled-apply step — run inside a transaction, then ROLLBACK):
--   BEGIN;
--     <everything above>
--     SELECT proname FROM pg_proc WHERE proname = 'get_tournament_payout_recipients'; -- 1 row
--     SELECT has_function_privilege('authenticated',
--       'public.get_tournament_payout_recipients(uuid)', 'EXECUTE');                  -- true
--     SELECT has_function_privilege('anon',
--       'public.get_tournament_payout_recipients(uuid)', 'EXECUTE');                  -- false
--   ROLLBACK;
-- ============================================================================
