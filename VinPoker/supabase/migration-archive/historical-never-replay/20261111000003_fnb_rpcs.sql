-- F&B module (FNB-P3) — money/stock RPCs. DEPENDS ON 000000 + 000001 + 000002.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 000000 → 000001 → 000002 → THIS in a
-- controlled session (Management API / `supabase db query --linked --file`, NOT `db push` / not
-- deploy_db). Regen types.ts in a SEPARATE step. schema_migrations is NOT touched.
--
-- Every function: SECURITY DEFINER, SET search_path = public, REVOKE ALL FROM PUBLIC/anon +
-- GRANT EXECUTE TO authenticated, explicit auth.uid() authz INSIDE (RLS is SELECT-only — these
-- DEFINER functions are the ONLY write path; they run as the owner and bypass RLS for their own
-- statements). All writes are atomic within the function's transaction.
--
-- THE 9 GUARANTEES (per the approved plan / owner review):
--   (1) fnb_mark_paid locks every needed ingredient with `... ORDER BY i.id FOR UPDATE` — a fixed
--       lock order so two concurrent PAIDs sharing ingredients can NEVER deadlock.
--   (2) #A = BLOCK: if any ingredient is short, `RAISE EXCEPTION 'INSUFFICIENT_STOCK'` aborts the
--       WHOLE transaction (all-or-nothing). The RAISE is the abort mechanism; nothing is mutated.
--   (3) Idempotency rerun never double-charges/double-decrements: fnb_create_order is anchored by
--       UNIQUE(club_id, client_request_id) (ON CONFLICT → return existing); fnb_mark_paid is guarded
--       by the order FOR UPDATE + status check (already 'paid' → return idempotent, no second decrement).
--   (4) COGS is FROZEN at PAID: unit_price_snapshot re-read from the live menu, unit_cost_snapshot =
--       Σ(recipe.qty × avg_unit_cost) per line, order.cogs_vnd = round(Σ qty × unit_cost_snapshot).
--       Later price/recipe/cost edits never retro-change a paid order.
--   (5) Parent→child club_id is always consistent: every child row (order_items, stock_movements,
--       order_events) is written with the order's / parent's club_id, never a client value.
--   (6) Cancel reverses correctly (P0-4): pending→flip (nothing moved); paid (not shipped)→restore
--       stock (+cancel_return ledger); shipped→REFUND ONLY, NO restock (default) — served goods are
--       consumed. Revenue+COGS reverse automatically because the finance RPC sums only status='paid'.
--   (7) Money/cash authz is the club_fnb_staff CASHIER FACET (is_club_fnb_kind(...,'cashier')) — NOT
--       the app_role enum value (which is coarse nav only). Inventory ADJUSTMENTS (stock_in,
--       stocktake commit) are owner/admin ONLY (is_club_owner) — a cashier may NOT adjust stock (§7).
--   (8) fnb_stock_in WMA is divide-by-zero guarded with a CASE (keep prior avg when new_on_hand ≤ 0).
--   (9) The fixed `ORDER BY ingredient_id FOR UPDATE` lock order is used in fnb_cancel_order and
--       fnb_commit_stocktake too — every stock writer takes ingredient locks in the same order.
--
-- NUANCE (documented): a SHIPPED order that is cancelled keeps its 'sale' stock deduction (no
-- restock) AND drops out of the finance PAID set, so its consumed cost is NOT in F&B COGS — it
-- surfaces instead as inventory shrinkage at the next stocktake (counted < expected). This matches
-- the owner rule "shipped-cancel = refund money, not stock", and keeps inventory truthful.

-- ===========================================================================================
-- 1. fnb_create_order — flow A (table) or flow B (counter). PENDING; no stock/no money yet.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_create_order(
  p_club_id           uuid,
  p_source            public.fnb_order_source,
  p_table_label       text,
  p_customer_name     text,
  p_note              text,
  p_lines             jsonb,                 -- [{ "menu_item_id": uuid, "qty": int }, ...]
  p_client_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_crid     text;
  v_order_id uuid;
  v_subtotal bigint := 0;
  v_line     jsonb;
  v_qty      int;
  v_mi       record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  -- (7) authz: any F&B facet or owner; a COUNTER order additionally requires the cashier facet.
  IF NOT (public.is_club_fnb(v_uid, p_club_id) OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF p_source = 'counter'
     AND NOT (public.is_club_fnb_kind(v_uid, p_club_id, 'cashier') OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden', 'detail', 'counter requires cashier');
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'empty lines');
  END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);

  -- (3) idempotency: insert the order; a retry with the same crid returns the existing order.
  BEGIN
    INSERT INTO public.fnb_orders (club_id, status, source, table_label, customer_name, note, client_request_id, created_by)
    VALUES (p_club_id, 'pending', p_source, p_table_label, p_customer_name, p_note, v_crid, v_uid)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_order_id FROM public.fnb_orders WHERE club_id = p_club_id AND client_request_id = v_crid;
    RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id, 'idempotent', true);
  END;

  -- lines: validate against this club's ACTIVE menu; snapshot price + sum subtotal SERVER-SIDE.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line->>'qty')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;   -- aborts tx → the order is rolled back
    SELECT id, name, price_vnd, is_active INTO v_mi
      FROM public.fnb_menu_items WHERE id = (v_line->>'menu_item_id')::uuid AND club_id = p_club_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND %', (v_line->>'menu_item_id'); END IF;
    IF NOT v_mi.is_active THEN RAISE EXCEPTION 'MENU_ITEM_INACTIVE %', v_mi.name; END IF;

    -- (5) child club_id = order club_id (never a client value)
    INSERT INTO public.fnb_order_items (order_id, club_id, menu_item_id, name_snapshot, qty, unit_price_snapshot, line_status)
    VALUES (v_order_id, p_club_id, v_mi.id, v_mi.name, v_qty, v_mi.price_vnd, 'pending')
    ON CONFLICT (order_id, menu_item_id) DO UPDATE SET qty = public.fnb_order_items.qty + EXCLUDED.qty;

    v_subtotal := v_subtotal + v_mi.price_vnd * v_qty;
  END LOOP;

  UPDATE public.fnb_orders SET subtotal_vnd = v_subtotal, updated_at = now() WHERE id = v_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, new_status, actor)
  VALUES (v_order_id, p_club_id, 'created', 'pending', v_uid);

  RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id, 'subtotal_vnd', v_subtotal, 'idempotent', false);
END;
$$;

-- ===========================================================================================
-- 2. fnb_mark_paid — THE ATOMIC PAID. Lock order → authz → idempotency → lock ingredients in
--    fixed order → BLOCK-if-short (RAISE) → decrement + sale ledger → freeze COGS → flip + event.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_mark_paid(
  p_order_id          uuid,
  p_client_request_id text DEFAULT NULL      -- accepted for call-shape symmetry; the order lock + status guard are the idempotency
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_order     public.fnb_orders%ROWTYPE;
  v_shortages jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_subtotal  bigint;
  v_cogs      bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;   -- lock the order
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- (7) only the COUNTER takes money — cashier facet (or owner). Servers/kitchen are rejected.
  IF NOT (public.is_club_fnb_kind(v_uid, v_order.club_id, 'cashier') OR public.is_club_owner(v_uid, v_order.club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- (3) idempotency / state guard
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'idempotent', true);
  END IF;
  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'BAD_STATE', 'status', v_order.status);
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
    -- (5) club_id from the order; sale cost = avg at sale time
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

-- ===========================================================================================
-- 3. fnb_cancel_order — atomic reverse (P0-4). pending: flip. paid: restore stock. shipped: refund only.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_cancel_order(
  p_order_id uuid,
  p_reason   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_order   public.fnb_orders%ROWTYPE;
  v_restock boolean := false;
  v_need    record;
  v_after   numeric;
  v_avg     numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- (7) refund/cancel = cashier facet or owner; a STILL-PENDING order may also be cancelled by its creator.
  IF NOT (public.is_club_fnb_kind(v_uid, v_order.club_id, 'cashier') OR public.is_club_owner(v_uid, v_order.club_id)
          OR (v_order.status = 'pending' AND v_order.created_by = v_uid)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  IF v_order.status IN ('cancelled', 'expired') THEN
    RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'idempotent', true);
  END IF;

  -- (6) decide restock by prior state
  IF v_order.status = 'paid' THEN
    v_restock := true;                                   -- not served yet → restore stock
  ELSIF v_order.status = 'shipped' THEN
    SELECT COALESCE((SELECT restock_on_shipped_cancel FROM public.fnb_settings WHERE club_id = v_order.club_id), false)
      INTO v_restock;                                    -- default false → refund only, NO restock
  ELSE
    v_restock := false;                                  -- pending → nothing was deducted
  END IF;

  IF v_restock THEN
    -- (9) same fixed id lock order as mark_paid
    PERFORM 1 FROM public.fnb_ingredients i
    WHERE i.id IN (
      SELECT DISTINCT ri.ingredient_id
      FROM public.fnb_order_items oi
      JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
      WHERE oi.order_id = p_order_id
    )
    ORDER BY i.id
    FOR UPDATE;

    FOR v_need IN
      SELECT ri.ingredient_id AS ingredient_id, SUM(oi.qty * ri.qty) AS need
      FROM public.fnb_order_items oi
      JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
      WHERE oi.order_id = p_order_id
      GROUP BY ri.ingredient_id
      ORDER BY ri.ingredient_id
    LOOP
      UPDATE public.fnb_ingredients
        SET on_hand = on_hand + v_need.need, version = version + 1, updated_at = now()
        WHERE id = v_need.ingredient_id
        RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;
      INSERT INTO public.fnb_stock_movements
        (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
      VALUES
        (v_order.club_id, v_need.ingredient_id, v_need.need, 'cancel_return', v_avg, v_after, 'order', p_order_id, v_uid);
    END LOOP;
  END IF;

  UPDATE public.fnb_orders
    SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = p_reason, updated_at = now()
    WHERE id = p_order_id;
  UPDATE public.fnb_order_items SET line_status = 'cancelled' WHERE order_id = p_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor, metadata)
  VALUES (p_order_id, v_order.club_id, 'cancelled', v_order.status, 'cancelled', v_uid,
          jsonb_build_object('reason', p_reason, 'reversed_stock', v_restock, 'was_shipped', (v_order.status = 'shipped')));

  -- Revenue + COGS reverse automatically: the finance RPC sums only status='paid', so a cancelled
  -- order drops out (no compensating negative row, no double count).
  RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'reversed_stock', v_restock);
END;
$$;

-- ===========================================================================================
-- 4. fnb_mark_shipped — server marks a paid line/order delivered. No money, no stock.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_mark_shipped(
  p_order_id uuid,
  p_line_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_order public.fnb_orders%ROWTYPE;
  v_all_shipped boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- (7) any F&B facet (server/kitchen/cashier) or owner — this is a fulfilment action, not money.
  IF NOT (public.is_club_fnb(v_uid, v_order.club_id) OR public.is_club_owner(v_uid, v_order.club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF v_order.status NOT IN ('paid', 'shipped') THEN
    RETURN jsonb_build_object('error', 'BAD_STATE', 'status', v_order.status);
  END IF;

  IF p_line_id IS NOT NULL THEN
    UPDATE public.fnb_order_items SET line_status = 'shipped', shipped_at = now()
      WHERE id = p_line_id AND order_id = p_order_id AND line_status = 'paid';
  ELSE
    UPDATE public.fnb_order_items SET line_status = 'shipped', shipped_at = now()
      WHERE order_id = p_order_id AND line_status = 'paid';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.fnb_order_items WHERE order_id = p_order_id AND line_status <> 'shipped'
  ) INTO v_all_shipped;

  IF v_all_shipped THEN
    UPDATE public.fnb_orders SET status = 'shipped', shipped_at = now(), updated_at = now()
      WHERE id = p_order_id AND status = 'paid';
    INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor)
    VALUES (p_order_id, v_order.club_id, 'shipped', 'paid', 'shipped', v_uid);
  ELSE
    INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor, metadata)
    VALUES (p_order_id, v_order.club_id, 'line_shipped', v_order.status, v_order.status, v_uid,
            jsonb_build_object('line_id', p_line_id));
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'all_shipped', v_all_shipped);
END;
$$;

-- ===========================================================================================
-- 5. fnb_stock_in — admin/owner buys stock (#C convert, #B WMA). Append-only ledger + materialized on_hand.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_stock_in(
  p_club_id            uuid,
  p_ingredient_id      uuid,
  p_qty_purchase       numeric,   -- quantity bought in purchase_unit (e.g. number of thùng)
  p_unit_cost_purchase numeric,   -- cost of ONE purchase_unit
  p_client_request_id  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_crid         text;
  v_ing          public.fnb_ingredients%ROWTYPE;
  v_qty_stock    numeric;
  v_cost_per_unit numeric;
  v_new_onhand   numeric;
  v_new_avg      numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  -- (7) inventory adjustment = owner/admin ONLY (a cashier may NOT adjust stock).
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_qty_purchase IS NULL OR p_qty_purchase <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'qty'); END IF;
  IF p_unit_cost_purchase IS NULL OR p_unit_cost_purchase < 0 THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'cost'); END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);
  -- idempotency fast-path
  IF EXISTS (SELECT 1 FROM public.fnb_stock_movements WHERE club_id = p_club_id AND client_request_id = v_crid) THEN
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true);
  END IF;

  -- idempotency race-safe path: a duplicate crid hitting uq_fnb_stock_crid rolls back this sub-tx.
  BEGIN
    SELECT * INTO v_ing FROM public.fnb_ingredients WHERE id = p_ingredient_id AND club_id = p_club_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INGREDIENT_NOT_FOUND'; END IF;

    v_qty_stock     := p_qty_purchase * v_ing.units_per_purchase;        -- #C convert to stock_unit
    v_cost_per_unit := p_unit_cost_purchase / v_ing.units_per_purchase;  -- cost per stock_unit
    v_new_onhand    := v_ing.on_hand + v_qty_stock;
    -- (8) WMA, divide-by-zero guarded
    v_new_avg := CASE
      WHEN v_new_onhand <= 0 THEN v_ing.avg_unit_cost
      ELSE (GREATEST(v_ing.on_hand, 0) * v_ing.avg_unit_cost + v_qty_stock * v_cost_per_unit) / v_new_onhand
    END;

    UPDATE public.fnb_ingredients
      SET on_hand = v_new_onhand, avg_unit_cost = v_new_avg, version = version + 1, updated_at = now()
      WHERE id = p_ingredient_id;
    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, client_request_id, actor)
    VALUES
      (p_club_id, p_ingredient_id, v_qty_stock, 'stock_in', v_cost_per_unit, v_new_onhand, 'manual', v_crid, v_uid);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true);   -- ingredient UPDATE rolled back too
  END;

  RETURN jsonb_build_object('status', 'ok', 'ingredient_id', p_ingredient_id,
                            'on_hand', v_new_onhand, 'avg_unit_cost', v_new_avg);
END;
$$;

-- ===========================================================================================
-- 6. fnb_commit_stocktake — admin/owner reconciles a physical count to on_hand (recompute under lock).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_commit_stocktake(
  p_stocktake_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_st     public.fnb_stocktakes%ROWTYPE;
  v_line   public.fnb_stocktake_lines%ROWTYPE;
  v_onhand numeric;
  v_avg    numeric;
  v_delta  numeric;
  v_count  int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_st FROM public.fnb_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'STOCKTAKE_NOT_FOUND'); END IF;
  -- (7) inventory adjustment = owner/admin ONLY
  IF NOT public.is_club_owner(v_uid, v_st.club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF v_st.status = 'committed' THEN RETURN jsonb_build_object('status', 'ok', 'idempotent', true); END IF;
  IF v_st.status <> 'open' THEN RETURN jsonb_build_object('error', 'BAD_STATE', 'status', v_st.status); END IF;

  -- (9) lock every counted ingredient in a fixed id order
  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (SELECT ingredient_id FROM public.fnb_stocktake_lines WHERE stocktake_id = p_stocktake_id)
  ORDER BY i.id
  FOR UPDATE;

  FOR v_line IN
    SELECT * FROM public.fnb_stocktake_lines WHERE stocktake_id = p_stocktake_id ORDER BY ingredient_id
  LOOP
    SELECT on_hand, avg_unit_cost INTO v_onhand, v_avg FROM public.fnb_ingredients WHERE id = v_line.ingredient_id;
    v_delta := v_line.counted_qty - v_onhand;                 -- recompute under lock (no stale expected)
    UPDATE public.fnb_stocktake_lines SET expected_qty = v_onhand, delta_applied = v_delta WHERE id = v_line.id;
    IF v_delta <> 0 THEN
      UPDATE public.fnb_ingredients
        SET on_hand = v_line.counted_qty, version = version + 1, updated_at = now()
        WHERE id = v_line.ingredient_id;
      INSERT INTO public.fnb_stock_movements
        (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
      VALUES
        (v_st.club_id, v_line.ingredient_id, v_delta, 'stocktake_adjust', v_avg, v_line.counted_qty, 'stocktake', p_stocktake_id, v_uid);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  UPDATE public.fnb_stocktakes SET status = 'committed', committed_by = v_uid, committed_at = now()
    WHERE id = p_stocktake_id;

  RETURN jsonb_build_object('status', 'ok', 'committed', true, 'adjusted_lines', v_count);
END;
$$;

-- ===========================================================================================
-- 7. Grants — default-deny then authenticated-only (authz is re-checked INSIDE each function).
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_mark_paid(uuid, text)                                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_cancel_order(uuid, text)                                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_mark_shipped(uuid, uuid)                                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_stock_in(uuid, uuid, numeric, numeric, text)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_commit_stocktake(uuid)                                                     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_mark_paid(uuid, text)                                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_cancel_order(uuid, text)                                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_mark_shipped(uuid, uuid)                                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_stock_in(uuid, uuid, numeric, numeric, text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_commit_stocktake(uuid)                                                     TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (after 000000..000002 + this; run in a tx + ROLLBACK).
--   Fixture: <club> with <cashier> (cashier facet), <server> (server facet), <owner>; menu item M
--   = 1×ingredient I (recipe qty 2); stock I.on_hand via fnb_stock_in.
--
-- BEGIN;
--   -- (7) money authz: server cannot pay; cashier can.
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_stock_in('<club>','<I>', 5, 10000, 'si1');   -- on_hand=5*units, avg set
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--                                                       jsonb_build_array(jsonb_build_object('menu_item_id','<M>','qty',1)),'o1');
--   SET LOCAL request.jwt.claim.sub = '<server>';  SELECT public.fnb_mark_paid('<order>');   -- Forbidden (no cashier facet)
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_mark_paid('<order>');   -- ok: decrement 2, COGS frozen
--   -- (3) idempotency rerun: second mark_paid does NOT decrement again
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_mark_paid('<order>');   -- idempotent:true
--   -- verify single decrement:
--   SELECT delta, reason FROM public.fnb_stock_movements WHERE ref_id = '<order>';            -- exactly one -2 'sale'
--   -- (2) #A BLOCK: order needing more than on_hand aborts the whole tx
--   --   create an order that needs > on_hand, then: SELECT public.fnb_mark_paid('<order2>');  -- ERROR INSUFFICIENT_STOCK; on_hand unchanged
--   -- (6) cancel paid (not shipped) restores stock; cancel shipped does NOT (default)
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_cancel_order('<order>','test'); -- +2 cancel_return; finance drops it
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_commit_stocktake(uuid);
--   DROP FUNCTION IF EXISTS public.fnb_stock_in(uuid, uuid, numeric, numeric, text);
--   DROP FUNCTION IF EXISTS public.fnb_mark_shipped(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.fnb_cancel_order(uuid, text);
--   DROP FUNCTION IF EXISTS public.fnb_mark_paid(uuid, text);
--   DROP FUNCTION IF EXISTS public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text);
-- ===========================================================================================
