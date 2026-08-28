-- F&B A3 — per-shift cash reconciliation: RPCs. DEPENDS ON 000001 (is_club_fnb / is_club_fnb_kind /
-- is_club_owner), 000002 (fnb_orders), 000015 (fnb_cashier_shifts). SOURCE-ONLY.
--
-- Apply AFTER …0015, in a controlled session, owner-gated. NOT `db push` / not deploy_db.
-- schema_migrations untouched. Number 20261111000016 verified FREE on origin/main (2026-07-02).
--
-- WHAT: three RPCs — open a shift, close it (freeze expected/counted/variance), and read a report.
--   ALL: SECURITY DEFINER, SET search_path=public, REVOKE PUBLIC/anon + GRANT authenticated, explicit
--   auth.uid() authz INSIDE (cashier facet OR owner — a shift is a cash task, §7). They WRITE ONLY to
--   fnb_cashier_shifts and READ fnb_orders. They do NOT touch fnb_mark_paid / fnb_create_order /
--   fnb_create_comp_order / get_club_finance_summary / fnb_get_report / any stock or money ledger.
--
-- CASH MATH (event-time, comps excluded — same recognition basis as …0011's finance RPC):
--   expected_cash_vnd (a.k.a. expected sales cash, EXCL float)
--     = Σ subtotal_vnd (o.paid_at ∈ [opened_at, win_end], NOT is_comp)         -- cash IN at paid_at
--     − Σ subtotal_vnd (o.status='cancelled', o.paid_at NOT NULL,              -- cash OUT at cancelled_at
--                       o.cancelled_at ∈ [opened_at, win_end], NOT is_comp)
--   expected_drawer_vnd = opening_float_vnd + expected_cash_vnd
--   variance_vnd        = counted_cash_vnd − expected_drawer_vnd               -- thiếu<0 / khớp=0 / thừa>0
--   NOTE: the SALE leg filters on paid_at ONLY (NO status filter) so a paid-then-cancelled-in-window
--   order nets to 0 (+subtotal sale, −subtotal refund) — identical to the …0011 `sale`/`refund` CTEs.
--   Comps carry subtotal_vnd=0, so they never move cash whether or not they're in the window.

-- ===========================================================================================
-- 1. fnb_open_shift — open THE cash shift for a club. Idempotent on (club_id, client_request_id);
--    a second concurrent open (different crid) hits uq_fnb_cashier_shift_one_open → return the
--    existing open shift ({already_open:true}), never a hard error.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_open_shift(
  p_club_id           uuid,
  p_opening_float_vnd bigint DEFAULT 0,
  p_client_request_id text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_crid     text;
  v_shift_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  -- (7) a shift is a cash task → cashier facet OR owner only.
  IF NOT (public.is_club_fnb_kind(v_uid, p_club_id, 'cashier') OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);

  -- idempotency: same crid → return the existing shift without opening a second.
  SELECT id INTO v_shift_id FROM public.fnb_cashier_shifts
    WHERE club_id = p_club_id AND client_request_id = v_crid;
  IF v_shift_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'shift_id', v_shift_id, 'idempotent', true);
  END IF;

  BEGIN
    INSERT INTO public.fnb_cashier_shifts (club_id, status, opened_by, opening_float_vnd, client_request_id)
    VALUES (p_club_id, 'open', v_uid, GREATEST(COALESCE(p_opening_float_vnd, 0), 0), v_crid)
    RETURNING id INTO v_shift_id;
  EXCEPTION WHEN unique_violation THEN
    -- either the crid raced (idempotent) OR a shift is already open for this club (one-open guard).
    SELECT id INTO v_shift_id FROM public.fnb_cashier_shifts
      WHERE club_id = p_club_id AND client_request_id = v_crid;
    IF v_shift_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'ok', 'shift_id', v_shift_id, 'idempotent', true);
    END IF;
    SELECT id INTO v_shift_id FROM public.fnb_cashier_shifts
      WHERE club_id = p_club_id AND status = 'open';
    RETURN jsonb_build_object('status', 'ok', 'shift_id', v_shift_id, 'already_open', true);
  END;

  RETURN jsonb_build_object('status', 'ok', 'shift_id', v_shift_id, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_open_shift(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_open_shift(uuid, bigint, text) TO authenticated;

-- ===========================================================================================
-- 2. fnb_close_shift — freeze expected/counted/variance and flip to closed. ALWAYS succeeds: a
--    thiếu/thừa is the RECORDED OUTPUT, never an error. Idempotent (already-closed → frozen figures).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_close_shift(
  p_shift_id          uuid,
  p_counted_cash_vnd  bigint,
  p_note              text DEFAULT NULL,
  p_client_request_id text DEFAULT NULL   -- accepted for call-shape symmetry; the FOR UPDATE + status guard IS the idempotency
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_shift    public.fnb_cashier_shifts%ROWTYPE;
  v_sales    bigint;
  v_refunds  bigint;
  v_expected bigint;
  v_variance bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_counted_cash_vnd IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'counted cash required');
  END IF;

  SELECT * INTO v_shift FROM public.fnb_cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SHIFT_NOT_FOUND'); END IF;

  IF NOT (public.is_club_fnb_kind(v_uid, v_shift.club_id, 'cashier') OR public.is_club_owner(v_uid, v_shift.club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- idempotency / state guard: already closed → return the frozen figures.
  IF v_shift.status = 'closed' THEN
    RETURN jsonb_build_object('status', 'ok', 'shift_id', p_shift_id, 'idempotent', true,
      'expected_cash_vnd', v_shift.expected_cash_vnd,
      'counted_cash_vnd',  v_shift.counted_cash_vnd,
      'variance_vnd',      v_shift.variance_vnd);
  END IF;

  -- cash IN: sales recognized at paid_at (NO status filter → paid-then-cancelled nets via the refund leg).
  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_sales
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND now()
    AND NOT COALESCE(o.is_comp, false);

  -- cash OUT: refunds recognized at cancelled_at (only orders that actually collected cash).
  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_refunds
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
    AND o.cancelled_at BETWEEN v_shift.opened_at AND now()
    AND NOT COALESCE(o.is_comp, false);

  v_expected := v_sales - v_refunds;                                          -- expected sales cash (EXCL float)
  v_variance := p_counted_cash_vnd - (v_shift.opening_float_vnd + v_expected); -- counted − drawer

  UPDATE public.fnb_cashier_shifts
    SET status            = 'closed',
        closed_by         = v_uid,
        closed_at         = now(),
        expected_cash_vnd = v_expected,
        counted_cash_vnd  = p_counted_cash_vnd,
        variance_vnd      = v_variance,
        note              = COALESCE(p_note, note),
        updated_at        = now()
    WHERE id = p_shift_id;

  RETURN jsonb_build_object('status', 'ok', 'shift_id', p_shift_id, 'idempotent', false,
    'opening_float_vnd',  v_shift.opening_float_vnd,
    'sales_vnd',          v_sales,
    'refunds_vnd',        v_refunds,
    'expected_cash_vnd',  v_expected,
    'counted_cash_vnd',   p_counted_cash_vnd,
    'variance_vnd',       v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_close_shift(uuid, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_close_shift(uuid, bigint, text, text) TO authenticated;

-- ===========================================================================================
-- 3. fnb_get_shift_report — read a shift (open = "so far" up to now; closed = up to closed_at) with
--    its cash totals + the order list in the window. STABLE, read-only. Authz any F&B facet or owner.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_get_shift_report(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_shift      public.fnb_cashier_shifts%ROWTYPE;
  v_win_end    timestamptz;
  v_sales      bigint;
  v_refunds    bigint;
  v_comp_count int;
  v_orders     jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_shift FROM public.fnb_cashier_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SHIFT_NOT_FOUND'); END IF;

  IF NOT (public.is_club_fnb(v_uid, v_shift.club_id) OR public.is_club_owner(v_uid, v_shift.club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  v_win_end := COALESCE(v_shift.closed_at, now());   -- open shift → live "so far"

  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_sales
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND v_win_end
    AND NOT COALESCE(o.is_comp, false);

  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_refunds
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
    AND o.cancelled_at BETWEEN v_shift.opened_at AND v_win_end
    AND NOT COALESCE(o.is_comp, false);

  SELECT COUNT(*) INTO v_comp_count
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id AND COALESCE(o.is_comp, false)
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND v_win_end;

  -- window order list: sale rows by paid_at (comps included as memo, is_comp flag) + refund rows by cancelled_at.
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.at), '[]'::jsonb) INTO v_orders
  FROM (
    SELECT o.id, o.paid_at AS at, 'sale'::text AS kind, o.subtotal_vnd::bigint AS amount_vnd,
           o.is_comp, o.status::text AS status, o.table_label, o.customer_name
    FROM public.fnb_orders o
    WHERE o.club_id = v_shift.club_id
      AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND v_win_end
    UNION ALL
    SELECT o.id, o.cancelled_at AS at, 'refund'::text AS kind, (-o.subtotal_vnd)::bigint AS amount_vnd,
           o.is_comp, o.status::text AS status, o.table_label, o.customer_name
    FROM public.fnb_orders o
    WHERE o.club_id = v_shift.club_id
      AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN v_shift.opened_at AND v_win_end
      AND NOT COALESCE(o.is_comp, false)
  ) x;

  RETURN jsonb_build_object(
    'status', 'ok',
    'shift', jsonb_build_object(
      'id', v_shift.id, 'club_id', v_shift.club_id, 'status', v_shift.status,
      'opened_by', v_shift.opened_by, 'opened_at', v_shift.opened_at,
      'closed_by', v_shift.closed_by, 'closed_at', v_shift.closed_at,
      'opening_float_vnd', v_shift.opening_float_vnd,
      'expected_cash_vnd', v_shift.expected_cash_vnd,
      'counted_cash_vnd',  v_shift.counted_cash_vnd,
      'variance_vnd',      v_shift.variance_vnd,
      'note', v_shift.note),
    'sales_vnd',           v_sales,
    'refunds_vnd',         v_refunds,
    'expected_cash_vnd',   v_sales - v_refunds,                                 -- live for open; matches frozen for closed
    'expected_drawer_vnd', v_shift.opening_float_vnd + (v_sales - v_refunds),
    'comp_count',          v_comp_count,
    'orders',              v_orders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_get_shift_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_get_shift_report(uuid) TO authenticated;

-- ===========================================================================================
-- Controlled-apply PROOF PLAN (run in a tx + ROLLBACK, after 000000..000015 + this). Fixture:
--   <club> with <owner> owner + <cashier> cashier facet; <other> owns nothing; <M> an active menu
--   item (cheap, tracks_inventory=false OR with stock) so create+pay works.
--
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<cashier>';
--   -- (a) open a shift:
--   SELECT public.fnb_open_shift('<club>', 0, 'open1');           -- {status:ok, shift_id:S, idempotent:false}
--   -- (b) a second open (different crid) returns the SAME shift, not a new one (one-open guard):
--   SELECT public.fnb_open_shift('<club>', 0, 'open2');           -- {status:ok, shift_id:S, already_open:true}
--   -- (c) same crid is idempotent:
--   SELECT public.fnb_open_shift('<club>', 0, 'open1');           -- {status:ok, shift_id:S, idempotent:true}
--   -- take a PAID sale, a COMP, and a paid order that is then refunded (all inside the shift window):
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,'[{"menu_item_id":"<M>","qty":1}]','s1');
--   SELECT public.fnb_mark_paid((SELECT order_id FROM ...), NULL);    -- sale = price(M)
--   SELECT public.fnb_create_comp_order('<club>','counter',NULL,NULL,NULL,'[{"menu_item_id":"<M>","qty":1}]','free','c1'); -- comp: subtotal 0
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,'[{"menu_item_id":"<M>","qty":1}]','s2');
--   SELECT public.fnb_mark_paid((SELECT order_id ...), NULL);         -- sale2
--   SELECT public.fnb_cancel_order((that order_id), 'refund test');   -- refund2 → nets sale2 to 0
--   -- (d) close counting exactly the expected cash → variance 0 (khớp). expected = price(M) (sale) + 0 (comp) − 0 (sale2 net):
--   SELECT public.fnb_close_shift('S', <price(M)>, NULL, 'close1');   -- {expected_cash_vnd:price(M), variance_vnd:0}
--   --     comp did NOT inflate expected; sale2 paid-then-refunded netted to 0.
--   -- (e) close again → idempotent, same frozen figures:
--   SELECT public.fnb_close_shift('S', 999999, NULL, 'close1');       -- {idempotent:true, variance_vnd:0}  (999999 ignored)
--   -- (f) authz: a non-cashier/non-owner is refused:
--   SET LOCAL request.jwt.claim.sub = '<other>'; SELECT public.fnb_open_shift('<club>', 0, 'x'); -- {error:Forbidden}
--   -- (g) empty shift → expected 0: open a fresh club shift with no orders, close counting 0 → variance 0.
--   -- (h) cross-shift: an order paid in shift A but cancelled after A closed (in shift B's window) →
--   --     the refund reduces B's expected cash only; A unchanged (proven by paid_at∈A, cancelled_at∈B).
--   -- (i) gap: an order paid while NO shift is open is in neither shift's window (documented limitation).
-- ROLLBACK;
--
-- Read-only VERIFY after apply (owner session):
--   SELECT proname, prosecdef, provolatile FROM pg_proc
--     WHERE proname IN ('fnb_open_shift','fnb_close_shift','fnb_get_shift_report');
--   SELECT has_function_privilege('anon','public.fnb_open_shift(uuid,bigint,text)','EXECUTE');    -- f
--   SELECT indexname FROM pg_indexes WHERE tablename='fnb_cashier_shifts' AND indexname='uq_fnb_cashier_shift_one_open';
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_get_shift_report(uuid);
--   DROP FUNCTION IF EXISTS public.fnb_close_shift(uuid, bigint, text, text);
--   DROP FUNCTION IF EXISTS public.fnb_open_shift(uuid, bigint, text);
-- ===========================================================================================
