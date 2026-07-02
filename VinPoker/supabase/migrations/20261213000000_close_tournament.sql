-- ============================================================================
-- Close Report (Chốt giải) — tournament_close_report snapshot + close_tournament RPC
-- SOURCE-ONLY, NOT APPLIED. Controlled apply only (owner-gated).
-- ============================================================================
-- Operator settlement + finalize for ONE tournament. Gated by the frontend flag
-- `closeReport` (default OFF): while OFF nothing calls this RPC or reads the table.
--
-- Money doctrine (VBacker 09-ACCOUNTING-CONTROL):
--   • buy-in and prize are PASS-THROUGH (player money), never club revenue;
--   • club revenue = Σ(total_pay − buy_in) over CONFIRMED registrations
--     (= rake + service, already net of free-rake because total_pay reflects the
--     waiver — so no per-row rake/service split is needed);
--   • prize_total = Σ tournament_eliminations.prize (what was actually paid by place);
--   • reconcile_delta = buy_in − prize (0 ⇒ the pass-through pool balances).
--     Cash-game cash-outs (leaderboard_entries) are a SEPARATE daily stream and are
--     intentionally NOT part of a tournament settlement snapshot.
--
-- This RPC:
--   • is SECURITY DEFINER + search_path=public; actor = auth.uid() only;
--   • authorizes club OWNER or club_cashier ONLY (not TD / floor) — owner's choice;
--   • is IDEMPOTENT: a second call on an already-closed tour returns already_closed
--     with the existing snapshot (double-click / retry safe). Serialized by a
--     FOR UPDATE lock on the tournament + a UNIQUE(tournament_id) snapshot guarded
--     with ON CONFLICT DO NOTHING (belt-and-suspenders against any lock bypass);
--   • sets tournaments.status='completed' and audits into tournament_state_transitions
--     with changed_by = the actor (the legacy update_tournament_state leaves it NULL);
--   • writes an IMMUTABLE, server-computed money snapshot (no UPDATE/DELETE policy);
--   • does NOT auto-fire staking release or the dealer "Đóng tour" — those stay
--     EXPLICIT so this can never double-fire the existing auto-finalize paths.
--
-- 'completed' is ALREADY an accepted tournaments.status value on live (the live
--   floorTableOps `close_tournament_table` RPC compares status IN ('completed',…)),
--   so NO enum change is made here (the migration ledger's original 4-value enum
--   was extended out-of-band; an ALTER TYPE here would be redundant/risky).
--
-- PRE-APPLY CHECK (controlled-apply runbook step — RED, do this FIRST):
--   Confirm 'completed' is an accepted tournaments.status value on LIVE before applying:
--       SELECT enum_range(NULL::tournament_status);   -- if status is an enum type
--       -- or: SELECT data_type FROM information_schema.columns
--       --     WHERE table_name='tournaments' AND column_name='status';
--   Live floorTableOps (close_tournament_table) + update_tournament_state already
--   read/write 'completed', so the live column almost certainly accepts it. IF and only
--   if status is an enum that is MISSING 'completed', first run — as its OWN committed
--   statement, NOT in this migration's transaction (ADD VALUE cannot be used same-tx):
--       ALTER TYPE public.tournament_status ADD VALUE IF NOT EXISTS 'completed';
--   Skipping this is not corrupting: a missing value makes the first real call fail with
--   a clean atomic rollback (tournament stays un-closed, retry-safe) — never partial data.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.close_tournament(uuid, text);
--   DROP TABLE IF EXISTS public.tournament_close_report;
-- NO supabase db push, NO deploy_db, NO schema_migrations write. Controlled apply only.
-- ============================================================================

-- 1. Immutable per-tournament settlement snapshot -----------------------------
CREATE TABLE IF NOT EXISTS public.tournament_close_report (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL UNIQUE REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id         UUID,
  closed_by       UUID REFERENCES auth.users(id),
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  entry_count     INTEGER NOT NULL DEFAULT 0,
  buy_in_total    BIGINT  NOT NULL DEFAULT 0,  -- pass-through
  cash_in_total   BIGINT  NOT NULL DEFAULT 0,  -- Σ total_pay
  club_revenue    BIGINT  NOT NULL DEFAULT 0,  -- = cash_in − buy_in (rake + service)
  prize_total     BIGINT  NOT NULL DEFAULT 0,  -- Σ eliminations.prize (pass-through)
  cashier_balance BIGINT  NOT NULL DEFAULT 0,  -- = cash_in − prize
  reconcile_delta BIGINT  NOT NULL DEFAULT 0,  -- = buy_in − prize (0 = balances)
  reconciled      BOOLEAN NOT NULL DEFAULT false,
  detail          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_tournament_close_report_club
  ON public.tournament_close_report(club_id, closed_at DESC);

ALTER TABLE public.tournament_close_report ENABLE ROW LEVEL SECURITY;

-- Read: club owner or club_cashier only. Writes go ONLY through the SECDEF RPC
-- below (which runs as owner and bypasses RLS); there is deliberately NO
-- INSERT/UPDATE/DELETE policy, so the snapshot is append-only from any client.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournament_close_report'
      AND policyname = 'close_report_read_owner_cashier'
  ) THEN
    CREATE POLICY close_report_read_owner_cashier
      ON public.tournament_close_report
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.clubs c
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = c.id AND cc.user_id = auth.uid()
          WHERE c.id = tournament_close_report.club_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;
END $$;

-- 2. close_tournament RPC -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_tournament(
  p_tournament_id UUID,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       UUID := auth.uid();
  v_tour        RECORD;
  v_authorized  BOOLEAN;
  v_existing    public.tournament_close_report;
  v_report      public.tournament_close_report;
  v_entry_count INTEGER;
  v_buy_in      BIGINT;
  v_cash_in     BIGINT;
  v_prize       BIGINT;
  v_club_rev    BIGINT;
  v_balance     BIGINT;
  v_delta       BIGINT;
  v_reconciled  BOOLEAN;
  v_detail      JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Serialize concurrent close attempts on this tournament.
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
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Idempotency: already closed → return the existing snapshot unchanged.
  SELECT * INTO v_existing
  FROM public.tournament_close_report WHERE tournament_id = p_tournament_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'already_closed',
      'report_id', v_existing.id, 'closed_at', v_existing.closed_at,
      'club_revenue', v_existing.club_revenue, 'reconciled', v_existing.reconciled
    );
  END IF;

  -- A cancelled tournament cannot be closed/settled.
  IF v_tour.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_cancelled');
  END IF;

  -- Server-authoritative money aggregation from immutable sources.
  SELECT COUNT(*)::int,
         COALESCE(SUM(buy_in), 0)::bigint,
         COALESCE(SUM(total_pay), 0)::bigint
    INTO v_entry_count, v_buy_in, v_cash_in
  FROM public.tournament_registrations
  WHERE tournament_id = p_tournament_id AND status = 'confirmed';

  SELECT COALESCE(SUM(prize), 0)::bigint INTO v_prize
  FROM public.tournament_eliminations
  WHERE tournament_id = p_tournament_id;

  v_club_rev   := v_cash_in - v_buy_in;  -- rake + service (net of free-rake)
  v_balance    := v_cash_in - v_prize;   -- what should remain in the drawer
  v_delta      := v_buy_in - v_prize;    -- pass-through pool balance (0 = clean)
  v_reconciled := (v_delta = 0);

  v_detail := jsonb_build_object(
    'rake_amount', v_tour.rake_amount,
    'service_fee_amount', v_tour.service_fee_amount,
    'prize_pool_config', v_tour.prize_pool,
    'status_before', v_tour.status
  );

  -- Write the immutable snapshot; ON CONFLICT guards any race that bypassed the lock.
  INSERT INTO public.tournament_close_report (
    tournament_id, club_id, closed_by, entry_count, buy_in_total, cash_in_total,
    club_revenue, prize_total, cashier_balance, reconcile_delta, reconciled, detail, reason
  ) VALUES (
    p_tournament_id, v_tour.club_id, v_actor, v_entry_count, v_buy_in, v_cash_in,
    v_club_rev, v_prize, v_balance, v_delta, v_reconciled, v_detail, p_reason
  )
  ON CONFLICT (tournament_id) DO NOTHING
  RETURNING * INTO v_report;

  IF v_report.id IS NULL THEN
    -- Lost the race: return the winner's snapshot; do NOT re-flip status or re-audit.
    SELECT * INTO v_report
    FROM public.tournament_close_report WHERE tournament_id = p_tournament_id;
    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'already_closed',
      'report_id', v_report.id, 'club_revenue', v_report.club_revenue,
      'reconciled', v_report.reconciled
    );
  END IF;

  -- Only the insert winner finalizes status + audits with the actor.
  IF v_tour.status <> 'completed' THEN
    UPDATE public.tournaments SET status = 'completed', updated_at = now()
    WHERE id = p_tournament_id;
    INSERT INTO public.tournament_state_transitions
      (tournament_id, previous_state, new_state, changed_by, reason)
    VALUES
      (p_tournament_id, v_tour.status, 'completed', v_actor, COALESCE(p_reason, 'close_report'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'outcome', 'closed',
    'report_id', v_report.id,
    'entry_count', v_entry_count,
    'buy_in_total', v_buy_in,
    'cash_in_total', v_cash_in,
    'club_revenue', v_club_rev,
    'prize_total', v_prize,
    'cashier_balance', v_balance,
    'reconcile_delta', v_delta,
    'reconciled', v_reconciled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_tournament(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tournament(UUID, TEXT) TO authenticated;
