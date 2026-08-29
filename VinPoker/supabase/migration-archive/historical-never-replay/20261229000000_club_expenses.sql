-- ═══════════════════════════════════════════════════════════════════════════════
-- Club Expenses (Bước A / Sổ chi phí) — append-only operating-expense ledger.
-- SOURCE-ONLY: NOT applied live.
--
-- Apply is a SEPARATE owner-gated controlled op (Management API -> verify grants/DEFINER/
-- search_path/RLS -> types regen). NO `supabase db push`, NO deploy_db, NO schema_migrations
-- edit here. This migration does NOT touch get_club_finance_summary — folding clubExpenses
-- into the finance summary is a SEPARATE later increment (additive + golden-diff, own PR).
--
-- WHY: today no generic expense table exists (rent, utilities, marketing, supplies…) — the
-- owner cannot record operating costs anywhere. This is the append-only ledger behind the
-- "Sổ chi phí" screen. APPEND-ONLY doctrine: no UPDATE/DELETE policy, no edit/delete RPC;
-- a correction is a NEW row (`adjusts_id` + a signed amount that reverses/adjusts).
--
-- WHAT (additive, idempotent):
--   1. public.expense_category enum.
--   2. public.club_expenses append-only table + RLS (operator-read; NO write policy).
--   3. public.get_club_expenses(club_id, from, to)  — read rollup (Owner+Cashier).
--   4. public.record_club_expense(...)              — append-only insert (Owner+Cashier, auth.uid()).
--
-- The 2 AUTO lines (F&B stock-in cash-out, GTD subsidy) are NOT written here — they stay
-- display-only, computed by their own modules. club_expenses holds only MANUAL entries.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Category enum ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.expense_category AS ENUM
    ('rent', 'utilities', 'salary_topup', 'marketing', 'supplies', 'maintenance', 'tax_fee', 'misc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Append-only ledger table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  category        public.expense_category NOT NULL,
  amount_vnd      bigint NOT NULL CHECK (amount_vnd <> 0),   -- signed: an adjustment row may reverse
  description     text,
  incurred_at     timestamptz NOT NULL,                      -- accounting date of the cost
  tournament_id   uuid REFERENCES public.tournaments(id),    -- optional event attribution
  series_id       uuid,                                      -- optional series attribution (no FK: series is not a single table)
  payment_status  text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid', 'unpaid')),
  payment_source  text CHECK (payment_source IN ('cash', 'bank')),
  entered_by      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  attachment_url  text,
  adjusts_id      uuid REFERENCES public.club_expenses(id),  -- correction points at the row it adjusts
  idempotency_key text
);

CREATE INDEX IF NOT EXISTS idx_club_expenses_club_incurred ON public.club_expenses (club_id, incurred_at);
-- Idempotency guard for record_club_expense (only when a key is supplied).
CREATE UNIQUE INDEX IF NOT EXISTS uq_club_expenses_idem
  ON public.club_expenses (club_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.club_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_expenses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_expenses TO authenticated;

-- Operator read: super_admin / club_admin / club owner / club cashier of the row's club.
-- NO INSERT/UPDATE/DELETE policy → append-only; the only writer is record_club_expense.
DROP POLICY IF EXISTS club_expenses_select_operator ON public.club_expenses;
CREATE POLICY club_expenses_select_operator ON public.club_expenses
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c
               WHERE c.id = club_expenses.club_id AND c.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc
               WHERE cc.club_id = club_expenses.club_id AND cc.user_id = auth.uid())
  );

-- ── 3. get_club_expenses — read rollup ───────────────────────────────────────
-- Returns rows + per-category totals + paid/unpaid split for [p_from, p_to). Owner+Cashier.
CREATE OR REPLACE FUNCTION public.get_club_expenses(
  p_club_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'from', p_from,
    'to', p_to,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'category', e.category, 'amount_vnd', e.amount_vnd,
               'description', e.description, 'incurred_at', e.incurred_at,
               'tournament_id', e.tournament_id, 'series_id', e.series_id,
               'payment_status', e.payment_status, 'payment_source', e.payment_source,
               'attachment_url', e.attachment_url, 'adjusts_id', e.adjusts_id,
               'entered_by', e.entered_by, 'created_at', e.created_at
             ) ORDER BY e.incurred_at DESC)
      FROM public.club_expenses e
      WHERE e.club_id = p_club_id AND e.incurred_at >= p_from AND e.incurred_at < p_to
    ), '[]'::jsonb),
    'total_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to
    ), 0),
    'by_category', COALESCE((
      SELECT jsonb_object_agg(category, cat_total)
      FROM (
        SELECT category, sum(amount_vnd) AS cat_total
        FROM public.club_expenses
        WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to
        GROUP BY category
      ) g
    ), '{}'::jsonb),
    'paid_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to AND payment_status = 'paid'
    ), 0),
    'unpaid_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to AND payment_status = 'unpaid'
    ), 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_club_expenses(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_expenses(uuid, timestamptz, timestamptz) TO authenticated;

-- ── 4. record_club_expense — append-only insert ──────────────────────────────
-- Actor = auth.uid() (NEVER a client id). Owner+Cashier. INSERT only (no update/delete path).
-- Idempotent on (club_id, idempotency_key): a retried call returns the existing row.
CREATE OR REPLACE FUNCTION public.record_club_expense(
  p_club_id         uuid,
  p_category        public.expense_category,
  p_amount_vnd      bigint,
  p_incurred_at     timestamptz,
  p_description     text    DEFAULT NULL,
  p_payment_status  text    DEFAULT 'unpaid',
  p_payment_source  text    DEFAULT NULL,
  p_tournament_id   uuid    DEFAULT NULL,
  p_series_id       uuid    DEFAULT NULL,
  p_attachment_url  text    DEFAULT NULL,
  p_adjusts_id      uuid    DEFAULT NULL,
  p_idempotency_key text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_key   text;
  v_prior record;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_amount_vnd IS NULL OR p_amount_vnd = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'amount_vnd must be non-zero');
  END IF;
  IF p_payment_status NOT IN ('paid', 'unpaid') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'payment_status');
  END IF;

  -- Authz: operator of p_club_id (Owner+Cashier).
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_key := nullif(btrim(p_idempotency_key), '');

  -- Idempotency: a supplied key that already inserted → return the prior row (no 2nd insert).
  IF v_key IS NOT NULL THEN
    SELECT id, amount_vnd, incurred_at INTO v_prior
    FROM public.club_expenses WHERE club_id = p_club_id AND idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'ok', 'idempotent', true, 'expense_id', v_prior.id);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.club_expenses (
      club_id, category, amount_vnd, description, incurred_at,
      tournament_id, series_id, payment_status, payment_source,
      entered_by, attachment_url, adjusts_id, idempotency_key
    ) VALUES (
      p_club_id, p_category, p_amount_vnd, p_description, p_incurred_at,
      p_tournament_id, p_series_id, COALESCE(p_payment_status, 'unpaid'), p_payment_source,
      v_uid, p_attachment_url, p_adjusts_id, v_key
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.club_expenses WHERE club_id = p_club_id AND idempotency_key = v_key LIMIT 1;
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true, 'expense_id', v_id);
  END;

  RETURN jsonb_build_object('status', 'ok', 'idempotent', false, 'expense_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_club_expense(uuid, public.expense_category, bigint, timestamptz, text, text, text, uuid, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_club_expense(uuid, public.expense_category, bigint, timestamptz, text, text, text, uuid, uuid, text, uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Controlled-apply TEST PLAN (tx + ROLLBACK; <owner> owns <club>, <cash> cashier, <other> unrelated).
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.record_club_expense('<club>','rent', 30000000, now(), 'Thuê mặt bằng T7','paid','bank');  -- ok
--   SELECT public.record_club_expense('<club>','marketing', 2000000, now(), 'In poster', 'unpaid', NULL,
--            NULL, NULL, NULL, NULL, 'idem-1');                                                              -- ok
--   SELECT public.record_club_expense('<club>','marketing', 2000000, now(), 'In poster', 'unpaid', NULL,
--            NULL, NULL, NULL, NULL, 'idem-1');                                                              -- idempotent=true (no 2nd row)
--   SET LOCAL request.jwt.claim.sub = '<other>';
--   SELECT public.record_club_expense('<club>','misc', 100000, now());                                      -- forbidden (42501)
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.get_club_expenses('<club>', date_trunc('month', now()), date_trunc('month', now())+interval '1 month'); -- rollup
-- ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.record_club_expense(uuid, public.expense_category, bigint, timestamptz, text, text, text, uuid, uuid, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.get_club_expenses(uuid, timestamptz, timestamptz);
--   DROP TABLE IF EXISTS public.club_expenses;
--   DROP TYPE IF EXISTS public.expense_category;
-- ═══════════════════════════════════════════════════════════════════════════════
