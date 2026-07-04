-- ============================================================================
-- Accounting Control W3-B — Tournament Prize Payout Liability
-- tournament_prize_payments ledger + get_club_payout_liability (read) +
-- record_tournament_prize_payment (write). SOURCE-ONLY, NOT APPLIED.
-- Controlled apply only (owner-gated Management API). NO supabase db push, NO
-- deploy_db, NO schema_migrations write.
-- ============================================================================
-- Money doctrine (VBacker 09-ACCOUNTING-CONTROL):
--   • prize pool / prize owed = player money PASS-THROUGH (liability), never revenue;
--   • liability = owed − paid; every number is Tạm tính until reconciled;
--   • a paid=0 is "chưa ghi nhận trả", NEVER "settled".
--
-- OWED (derived, matches get_member_history byte-for-byte, 20261210000000:188-190):
--   for each finalized finisher, tournament_prizes.amount WHERE position = finished_place.
--   finalize_tournament_results collapses re-entries to ONE finish per distinct player
--   and clears superseded bullets, so Σ over finished_place IS NOT NULL counts each place once.
-- PERIOD: a tournament is in [p_from,p_to] iff its close date is —
--   COALESCE(tournament_close_report.closed_at, tournaments.start_time) — in range.
--   NEVER registration_closed_at (late-reg close ≠ tournament end). Owed shows only when the
--   tournament is finalized (has finished_place); otherwise "chưa chốt", never 0.
-- PAID = paid-to-date (all 'paid' ledger rows for those tournaments up to now, NOT filtered
--   by paid_at ∈ period) — a giải closed this month but paid next month must still count as paid.
--
-- WRITE RPC record_tournament_prize_payment: server DERIVES recipient + amount from
--   (tournament_id + finished_place) — client NEVER supplies amount or player. Owner/cashier only.
--   Append-only, idempotent (one 'paid' per (tournament, place)). v1 creates ONLY status='paid';
--   'returned'/'cancelled' are reserved & UNREACHABLE until B3 reversal semantics.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.record_tournament_prize_payment(uuid, integer, text, text, text);
--   DROP FUNCTION IF EXISTS public.get_club_payout_liability(timestamptz, timestamptz, uuid);
--   DROP TABLE IF EXISTS public.tournament_prize_payments;
--   (companion: docs/emergency_rollbacks/20261216000000_accounting_payout_liability_rollback.sql)
-- ============================================================================

-- 1. Append-only prize-payment ledger ----------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_prize_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id        UUID NOT NULL,                 -- denormalized for RLS + index
  finished_place INTEGER NOT NULL,              -- the payable unit (ITM rank)
  prize_amount   NUMERIC(12,2) NOT NULL,        -- server-derived, matches tournament_prizes.amount
  recipient_ref  UUID,                          -- audit: COALESCE(member_id, player_id); NO FK (two namespaces); NULL for walk-in
  recipient_name TEXT,                          -- audit snapshot (full_name or masked)
  status         TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','returned','cancelled')),
  paid_by        UUID REFERENCES auth.users(id),
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  method         TEXT CHECK (method IN ('cash','bank','app','other')),
  proof_url      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active 'paid' row per (tournament, place). Keyed on place (not player) — post-finalize a
-- place is 1:1 a distinct player, and this stays correct for walk-ins (null recipient).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prize_paid_once
  ON public.tournament_prize_payments(tournament_id, finished_place)
  WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_prize_payments_club
  ON public.tournament_prize_payments(club_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_prize_payments_tour
  ON public.tournament_prize_payments(tournament_id);

ALTER TABLE public.tournament_prize_payments ENABLE ROW LEVEL SECURITY;

-- Read: club owner or club_cashier. Writes ONLY via the SECDEF RPC (no INSERT/UPDATE/DELETE policy).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournament_prize_payments'
      AND policyname = 'prize_payments_read_owner_cashier'
  ) THEN
    CREATE POLICY prize_payments_read_owner_cashier
      ON public.tournament_prize_payments
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clubs c
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = c.id AND cc.user_id = auth.uid()
          WHERE c.id = tournament_prize_payments.club_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;
END $$;

-- 2. READ RPC — get_club_payout_liability ------------------------------------
--    Owner-scoped (super_admin → all clubs, else clubs.owner_id), mirrors get_club_finance_summary.
CREATE OR REPLACE FUNCTION public.get_club_payout_liability(
  p_from timestamptz,
  p_to timestamptz,
  p_club_id uuid default null
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];
  v_club_ids uuid[];
  v_per jsonb;
  v_owed numeric := 0;
  v_paid numeric := 0;
  v_out numeric := 0;
  v_aging jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'super_admin'
  ) INTO v_super;

  IF v_super THEN
    SELECT COALESCE(array_agg(id), '{}') INTO v_all_ids FROM public.clubs;
  ELSE
    SELECT COALESCE(array_agg(id), '{}') INTO v_all_ids FROM public.clubs WHERE owner_id = v_uid;
  END IF;

  IF p_club_id IS NOT NULL THEN
    IF NOT (p_club_id = ANY(v_all_ids)) THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;
    v_club_ids := ARRAY[p_club_id];
  ELSE
    v_club_ids := v_all_ids;
  END IF;

  IF v_all_ids IS NULL OR array_length(v_all_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'periodFrom', p_from, 'periodTo', p_to,
      'owedTotal', 0, 'paidTotal', 0, 'outstandingTotal', 0,
      'perTournament', '[]'::jsonb,
      'aging', jsonb_build_object('d0_1', 0, 'd2_7', 0, 'd8p', 0)
    );
  END IF;

  -- Per-tournament liability. Close date = close-report else start_time (NEVER reg-close).
  WITH scoped AS (
    SELECT
      t.id,
      t.name,
      COALESCE(cr.closed_at, t.start_time) AS close_date,
      (cr.tournament_id IS NOT NULL)       AS is_closed,
      EXISTS (SELECT 1 FROM public.tournament_entries e
              WHERE e.tournament_id = t.id AND e.finished_place IS NOT NULL) AS has_finished_place
    FROM public.tournaments t
    LEFT JOIN public.tournament_close_report cr ON cr.tournament_id = t.id
    WHERE t.club_id = ANY(v_club_ids)
      AND COALESCE(cr.closed_at, t.start_time) >= p_from
      AND COALESCE(cr.closed_at, t.start_time) <= p_to
  ),
  calc AS (
    SELECT
      s.id, s.name, s.close_date, s.is_closed, s.has_finished_place,
      CASE WHEN s.has_finished_place THEN (
        SELECT COALESCE(SUM(
          (SELECT tp.amount FROM public.tournament_prizes tp
           WHERE tp.tournament_id = e.tournament_id AND tp.position = e.finished_place)
        ), 0)
        FROM public.tournament_entries e
        WHERE e.tournament_id = s.id AND e.finished_place IS NOT NULL
      ) ELSE NULL END AS owed,
      (SELECT COALESCE(SUM(pp.prize_amount), 0)
       FROM public.tournament_prize_payments pp
       WHERE pp.tournament_id = s.id AND pp.status = 'paid') AS paid,
      (SELECT COUNT(*) FROM public.tournament_entries e
       WHERE e.tournament_id = s.id AND e.finished_place IS NOT NULL) AS finishers_count
    FROM scoped s
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'tournamentId', c.id, 'name', c.name, 'closeDate', c.close_date,
      'isClosed', c.is_closed, 'hasFinishedPlace', c.has_finished_place,
      'owed', c.owed, 'paid', c.paid,
      'outstanding', CASE WHEN c.owed IS NULL THEN NULL ELSE c.owed - c.paid END,
      'finishersCount', c.finishers_count
    ) ORDER BY c.close_date DESC), '[]'::jsonb),
    COALESCE(SUM(c.owed), 0),
    COALESCE(SUM(c.paid) FILTER (WHERE c.owed IS NOT NULL), 0),
    -- aging of OUTSTANDING (owed − paid) by close date, only for finalized tournaments
    jsonb_build_object(
      'd0_1', COALESCE(SUM(GREATEST(c.owed - c.paid, 0)) FILTER (
                 WHERE c.owed IS NOT NULL AND c.close_date >= now() - interval '1 day'), 0),
      'd2_7', COALESCE(SUM(GREATEST(c.owed - c.paid, 0)) FILTER (
                 WHERE c.owed IS NOT NULL AND c.close_date <  now() - interval '1 day'
                   AND c.close_date >= now() - interval '7 day'), 0),
      'd8p',  COALESCE(SUM(GREATEST(c.owed - c.paid, 0)) FILTER (
                 WHERE c.owed IS NOT NULL AND c.close_date <  now() - interval '7 day'), 0)
    )
  INTO v_per, v_owed, v_paid, v_aging
  FROM calc c;

  v_out := v_owed - v_paid;

  RETURN jsonb_build_object(
    'periodFrom', p_from, 'periodTo', p_to,
    'owedTotal', v_owed, 'paidTotal', v_paid, 'outstandingTotal', v_out,
    'perTournament', v_per, 'aging', v_aging
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_club_payout_liability(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_payout_liability(timestamptz, timestamptz, uuid) TO authenticated;

-- 3. WRITE RPC — record_tournament_prize_payment (for B2; shipped, called only when B2 flag ON) --
--    Server DERIVES recipient + amount. Client supplies ONLY tournament_id + finished_place + meta.
CREATE OR REPLACE FUNCTION public.record_tournament_prize_payment(
  p_tournament_id  uuid,
  p_finished_place integer,
  p_method         text default null,
  p_proof_url      text default null,
  p_notes          text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_tour     RECORD;
  v_authz    boolean;
  v_amount   numeric;
  v_entry    RECORD;
  v_recip    uuid;
  v_name     text;
  v_row      public.tournament_prize_payments;
  v_existing public.tournament_prize_payments;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  -- Authorization: club OWNER or club_cashier ONLY.
  SELECT EXISTS (
    SELECT 1 FROM public.clubs c
    LEFT JOIN public.club_cashiers cc ON cc.club_id = c.id AND cc.user_id = v_actor
    WHERE c.id = v_tour.club_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authz;
  IF NOT v_authz THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Server-derived AMOUNT (client cannot invent it).
  SELECT tp.amount INTO v_amount FROM public.tournament_prizes tp
  WHERE tp.tournament_id = p_tournament_id AND tp.position = p_finished_place;
  IF v_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'place_not_in_money');
  END IF;

  -- Server-derived RECIPIENT from the finalized finisher (place must be finalized).
  SELECT e.member_id, e.player_id INTO v_entry
  FROM public.tournament_entries e
  WHERE e.tournament_id = p_tournament_id AND e.finished_place = p_finished_place
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'place_not_finalized');
  END IF;
  v_recip := COALESCE(v_entry.member_id, v_entry.player_id);
  SELECT full_name INTO v_name FROM public.club_members WHERE id = v_entry.member_id;

  -- Idempotent insert (one 'paid' per tournament+place).
  INSERT INTO public.tournament_prize_payments (
    tournament_id, club_id, finished_place, prize_amount, recipient_ref, recipient_name,
    status, paid_by, method, proof_url, notes
  ) VALUES (
    p_tournament_id, v_tour.club_id, p_finished_place, v_amount, v_recip, v_name,
    'paid', v_actor, p_method, p_proof_url, p_notes
  )
  ON CONFLICT (tournament_id, finished_place) WHERE status = 'paid'
  DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_existing FROM public.tournament_prize_payments
    WHERE tournament_id = p_tournament_id AND finished_place = p_finished_place AND status = 'paid'
    LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_paid',
      'payment_id', v_existing.id, 'prize_amount', v_existing.prize_amount, 'paid_at', v_existing.paid_at);
  END IF;

  RETURN jsonb_build_object('ok', true, 'outcome', 'recorded',
    'payment_id', v_row.id, 'prize_amount', v_row.prize_amount, 'paid_at', v_row.paid_at);
END;
$$;

REVOKE ALL ON FUNCTION public.record_tournament_prize_payment(uuid, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_tournament_prize_payment(uuid, integer, text, text, text) TO authenticated;

-- ============================================================================
-- DRY-RUN (controlled-apply step — run inside a transaction, then ROLLBACK):
--   BEGIN;
--     <everything above>
--     SELECT count(*) FROM public.tournament_prize_payments;                    -- 0
--     SELECT proname FROM pg_proc WHERE proname IN
--       ('get_club_payout_liability','record_tournament_prize_payment');        -- 2 rows
--     SELECT polname FROM pg_policies WHERE tablename='tournament_prize_payments'; -- read policy
--   ROLLBACK;
-- ============================================================================
