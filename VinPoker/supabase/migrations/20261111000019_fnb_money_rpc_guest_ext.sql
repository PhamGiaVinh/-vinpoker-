-- F&B GQR-M3 — Guest QR: MONEY-RPC extensions. DEPENDS ON 000010 (fnb_mark_paid body cloned),
-- 000016 (fnb_close_shift / fnb_get_shift_report bodies cloned), 000017 (payment_method column —
-- APPLY M1 FIRST). SOURCE-ONLY.
--
-- Apply AFTER …0017/…0018, controlled session, owner-gated. NOT `db push` / not deploy_db.
--
-- WHAT (two owner-locked changes to live money functions — each is a CLONE of the CURRENT LIVE
-- body with a minimal, clearly-marked [GQR] delta):
--   1. fnb_mark_paid (…0010 clone): the SERVER facet may now confirm payment for TABLE-source CASH
--      orders — the "phục vụ đến bàn thu tiền, bấm ngay trên điện thoại" flow. Counter orders and
--      bank orders are UNCHANGED (cashier/owner only; bank orders are settled by the SePay pipeline,
--      GQR-M4). This is the ONLY edit — the atomic PAID sequence is byte-preserved.
--   2. fnb_close_shift + fnb_get_shift_report (…0016 clones): the expected-DRAWER math now counts
--      CASH orders only (`payment_method='cash'`) on BOTH the sale and refund legs — a bank-paid
--      guest order never enters the physical drawer, so counting it would show a false "thiếu"
--      variance every time. Bank takings are surfaced separately as an informational bank_paid_vnd.
--      Both functions get the same filter so the live "so far" view and the frozen close agree.
--
-- ROLLBACK: bottom of file.

-- ===========================================================================================
-- 1. fnb_mark_paid — …0010 body, ONE authz delta (marked with -- [GQR] below).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_mark_paid(
  p_order_id          uuid,
  p_client_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_order     public.fnb_orders%ROWTYPE;
  v_shortages jsonb;
  v_norecipe  jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_subtotal  bigint;
  v_cogs      bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- [GQR] cashier/owner as before; PLUS the server facet for TABLE-source CASH orders only
  --       (the at-the-table collection flow). Counter and bank orders keep the original rule.
  IF NOT (public.is_club_fnb_kind(v_uid, v_order.club_id, 'cashier') OR public.is_club_owner(v_uid, v_order.club_id)
          OR (public.is_club_fnb_kind(v_uid, v_order.club_id, 'server')
              AND v_order.source = 'table' AND v_order.payment_method = 'cash')) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'idempotent', true);
  END IF;
  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'BAD_STATE', 'status', v_order.status);
  END IF;

  -- (P0-3) RECIPE REQUIRED: block PAID if any active line's item tracks inventory but has NO recipe.
  --   An item explicitly flagged tracks_inventory=false is an owner exemption (sell, COGS 0, no decrement).
  --   Evaluated at PAID time (not snapshotted at create). Tx aborts → order stays pending, retryable.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'menu_item_id', oi.menu_item_id, 'name', oi.name_snapshot, 'qty', oi.qty)), '[]'::jsonb)
    INTO v_norecipe
  FROM public.fnb_order_items oi
  JOIN public.fnb_menu_items mi ON mi.id = oi.menu_item_id
  WHERE oi.order_id = p_order_id
    AND COALESCE(mi.tracks_inventory, true)
    AND NOT EXISTS (SELECT 1 FROM public.fnb_recipe_items ri WHERE ri.menu_item_id = oi.menu_item_id);
  IF jsonb_array_length(v_norecipe) > 0 THEN
    RAISE EXCEPTION 'RECIPE_REQUIRED' USING DETAIL = v_norecipe::text, ERRCODE = 'check_violation';
  END IF;

  -- (1)(9) lock EVERY needed ingredient in a fixed id order BEFORE any check or mutation.
  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (
    SELECT DISTINCT ri.ingredient_id
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
  )
  ORDER BY i.id
  FOR UPDATE;

  -- (2) #A = BLOCK: collect every short ingredient; if any, abort the WHOLE tx via RAISE.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', s.ingredient_id, 'name', s.name, 'need', s.need, 'on_hand', s.on_hand)), '[]'::jsonb)
    INTO v_shortages
  FROM (
    SELECT ri.ingredient_id, ing.name, SUM(oi.qty * ri.qty) AS need, ing.on_hand
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id, ing.name, ing.on_hand
    HAVING SUM(oi.qty * ri.qty) > ing.on_hand
  ) s;

  IF jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING DETAIL = v_shortages::text, ERRCODE = 'check_violation';
  END IF;

  -- (4) freeze revenue: re-read live menu prices onto the lines at the payment instant.
  UPDATE public.fnb_order_items oi
    SET unit_price_snapshot = mi.price_vnd
    FROM public.fnb_menu_items mi
    WHERE oi.order_id = p_order_id AND mi.id = oi.menu_item_id;

  -- decrement stock + append one 'sale' ledger row per ingredient, in the same fixed id order.
  FOR v_need IN
    SELECT ri.ingredient_id AS ingredient_id, SUM(oi.qty * ri.qty) AS need
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id
    ORDER BY ri.ingredient_id
  LOOP
    UPDATE public.fnb_ingredients
      SET on_hand = on_hand - v_need.need, version = version + 1, updated_at = now()
      WHERE id = v_need.ingredient_id
      RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;
    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
    VALUES
      (v_order.club_id, v_need.ingredient_id, -v_need.need, 'sale', v_avg, v_after, 'order', p_order_id, v_uid);
  END LOOP;

  -- (4) freeze COGS per line (Σ recipe.qty × avg_unit_cost at sale time); avg is unchanged by a sale.
  UPDATE public.fnb_order_items oi
    SET unit_cost_snapshot = COALESCE((
      SELECT SUM(ri.qty * ing.avg_unit_cost)
      FROM public.fnb_recipe_items ri
      JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.menu_item_id = oi.menu_item_id
    ), 0)
    WHERE oi.order_id = p_order_id;

  SELECT COALESCE(SUM(unit_price_snapshot * qty), 0),
         COALESCE(ROUND(SUM(unit_cost_snapshot * qty)), 0)
    INTO v_subtotal, v_cogs
  FROM public.fnb_order_items WHERE order_id = p_order_id;

  UPDATE public.fnb_orders
    SET status = 'paid', paid_by = v_uid, paid_at = now(),
        subtotal_vnd = v_subtotal, cogs_vnd = v_cogs, updated_at = now()
    WHERE id = p_order_id;
  UPDATE public.fnb_order_items SET line_status = 'paid' WHERE order_id = p_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor)
  VALUES (p_order_id, v_order.club_id, 'paid', 'pending', 'paid', v_uid);

  RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id,
                            'subtotal_vnd', v_subtotal, 'cogs_vnd', v_cogs, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_mark_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_mark_paid(uuid, text) TO authenticated;

-- ===========================================================================================
-- 2. fnb_close_shift — …0016 body; the sale+refund legs gain `payment_method='cash'` (marked
--    [GQR]); the return gains an informational bank_paid_vnd.
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
  v_bank     bigint;
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

  -- cash IN: CASH sales recognized at paid_at. [GQR] bank-paid orders never enter the drawer.
  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_sales
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND now()
    AND NOT COALESCE(o.is_comp, false)
    AND o.payment_method = 'cash';                                             -- [GQR]

  -- cash OUT: CASH refunds recognized at cancelled_at. [GQR]
  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_refunds
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
    AND o.cancelled_at BETWEEN v_shift.opened_at AND now()
    AND NOT COALESCE(o.is_comp, false)
    AND o.payment_method = 'cash';                                             -- [GQR]

  -- informational: bank takings in the window (never in the drawer, shown for reconciliation context).
  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_bank
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND now()
    AND NOT COALESCE(o.is_comp, false)
    AND o.payment_method = 'bank_transfer';

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
    'bank_paid_vnd',      v_bank,
    'expected_cash_vnd',  v_expected,
    'counted_cash_vnd',   p_counted_cash_vnd,
    'variance_vnd',       v_variance);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_close_shift(uuid, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_close_shift(uuid, bigint, text, text) TO authenticated;

-- ===========================================================================================
-- 3. fnb_get_shift_report — …0016 body with the SAME cash-only filter on the two cash legs
--    (so the live "so far" view always matches what close will freeze) + bank_paid_vnd.
--    The order LIST stays inclusive (bank + comp rows appear, flagged by kind/is_comp) — it is
--    informational; only the cash math filters.
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
  v_bank       bigint;
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
    AND NOT COALESCE(o.is_comp, false)
    AND o.payment_method = 'cash';                                             -- [GQR]

  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_refunds
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
    AND o.cancelled_at BETWEEN v_shift.opened_at AND v_win_end
    AND NOT COALESCE(o.is_comp, false)
    AND o.payment_method = 'cash';                                             -- [GQR]

  SELECT COALESCE(SUM(o.subtotal_vnd), 0) INTO v_bank
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND v_win_end
    AND NOT COALESCE(o.is_comp, false)
    AND o.payment_method = 'bank_transfer';

  SELECT COUNT(*) INTO v_comp_count
  FROM public.fnb_orders o
  WHERE o.club_id = v_shift.club_id AND COALESCE(o.is_comp, false)
    AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND v_win_end;

  -- window order list: sale rows by paid_at (comps included as memo, is_comp flag) + refund rows by cancelled_at.
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.at), '[]'::jsonb) INTO v_orders
  FROM (
    SELECT o.id, o.paid_at AS at, 'sale'::text AS kind, o.subtotal_vnd::bigint AS amount_vnd,
           o.is_comp, o.payment_method::text AS payment_method,
           o.status::text AS status, o.table_label, o.customer_name
    FROM public.fnb_orders o
    WHERE o.club_id = v_shift.club_id
      AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN v_shift.opened_at AND v_win_end
    UNION ALL
    SELECT o.id, o.cancelled_at AS at, 'refund'::text AS kind, (-o.subtotal_vnd)::bigint AS amount_vnd,
           o.is_comp, o.payment_method::text AS payment_method,
           o.status::text AS status, o.table_label, o.customer_name
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
    'bank_paid_vnd',       v_bank,
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
-- Controlled-apply PROOF PLAN (BEGIN … ROLLBACK, after …0017/…0018 + this):
--   -- (a) server facet marks a TABLE+CASH order paid → ok (stock decremented, COGS frozen):
--   SET LOCAL request.jwt.claim.sub = '<server>';
--   SELECT public.fnb_mark_paid('<table_cash_order>');                 -- {status:ok}
--   -- (b) server CANNOT pay a counter order:
--   SELECT public.fnb_mark_paid('<counter_order>');                    -- {error:Forbidden}
--   -- (c) server CANNOT pay a table BANK order (SePay settles those):
--   SELECT public.fnb_mark_paid('<table_bank_order>');                 -- {error:Forbidden}
--   -- (d) cashier/owner behavior on counter orders is byte-identical to before.
--   -- (e) shift math: open a shift → cash order (paid) + bank order (paid via test flip) + comp →
--   --     fnb_get_shift_report shows expected_drawer = float + cash only, bank_paid_vnd separate;
--   --     fnb_close_shift counting exactly float+cash → variance 0 (bank does NOT create thiếu).
-- ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (undo this migration): re-apply the …0010 fnb_mark_paid body and the …0016
--   fnb_close_shift / fnb_get_shift_report bodies (they do not reference the new columns).
-- ===========================================================================================
