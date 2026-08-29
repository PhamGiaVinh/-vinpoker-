-- F&B A1 — COMP (đồ miễn phí) — schema + fnb_create_comp_order.
-- Depends on: 000002 (fnb_orders), 000003 (fnb_create_order / fnb_mark_paid), 000010 (lifecycle fix).
-- Source-only. Apply in a controlled session (Management API / db query --file), owner-gated,
-- after review. NOT db push / not deploy_db. schema_migrations untouched.
-- Number 20261111000012 verified FREE on origin/main (2026-07-01).
--
-- WHY: formalise free/complimentary F&B so staff cannot give items off-book.
--   A comp = a PAID order with subtotal_vnd=0 (no money collected), but stock STILL decrements
--   and COGS is snapshotted exactly like a normal sale — real ingredients were consumed.
--   Owner decision (2026-07-01): comp COGS is a REAL cost that reduces club Net (see …0013).
--
-- WHAT:
--   1. Add 3 columns to fnb_orders: is_comp, comp_reason, comp_authorized_by (plain uuid, no FK —
--      matches the existing created_by/paid_by/cancelled_by convention).
--   2. Add a partial index for comp reporting.
--   3. New RPC fnb_create_comp_order: atomic create+PAID in one tx (no separate pay step).
--      Authz = cashier OR owner (servers cannot self-issue comps).
--      Shares the RECIPE_REQUIRED guard (…0010) and INSUFFICIENT_STOCK block (…0003 + …0010).
--      subtotal_vnd is FORCED to 0; cogs_vnd is snapshotted as normal.
--
-- FLAG: fnbComp (default false) — code ships dark. Flip after preview UAT.
-- ROLLBACK: see bottom of this file.

-- ===========================================================================================
-- 1. Schema — add comp columns to fnb_orders (idempotent ADD COLUMN IF NOT EXISTS).
-- ===========================================================================================
ALTER TABLE public.fnb_orders
  ADD COLUMN IF NOT EXISTS is_comp            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comp_reason        text,
  ADD COLUMN IF NOT EXISTS comp_authorized_by uuid;   -- plain uuid, NO FK to auth.users

COMMENT ON COLUMN public.fnb_orders.is_comp IS
  'true = comp order: subtotal_vnd forced to 0, COGS still snapshotted. '
  'Finance tracks comp COGS separately via fnb_rows_comp CTE (see …0013).';

-- Partial index for comp reporting (paid_at bucketing, same shape as idx_fnb_orders_club_paid).
CREATE INDEX IF NOT EXISTS idx_fnb_orders_comp
  ON public.fnb_orders(club_id, paid_at)
  WHERE is_comp;

-- ===========================================================================================
-- 2. fnb_create_comp_order — atomic create+PAID with subtotal=0.
--    Models the life of a comp:
--      create (pending) → validate lines → RECIPE_REQUIRED guard → INSUFFICIENT_STOCK block
--      → stock decrement (sale ledger rows) → COGS snapshot → flip to paid (subtotal=0).
--    Idempotent on (club_id, client_request_id). Cancel path = unchanged fnb_cancel_order
--    (stock restored; finance handles it via the comp-refund leg in …0013).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_create_comp_order(
  p_club_id           uuid,
  p_source            public.fnb_order_source,
  p_table_label       text    DEFAULT NULL,
  p_customer_name     text    DEFAULT NULL,
  p_note              text    DEFAULT NULL,
  p_lines             jsonb   DEFAULT '[]'::jsonb,
  p_comp_reason       text    DEFAULT NULL,
  p_client_request_id text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_crid      text;
  v_order_id  uuid;
  v_shortages jsonb;
  v_norecipe  jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_cogs      bigint;
  v_line      jsonb;
  v_qty       int;
  v_mi        record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  -- Only cashier facet or owner can authorise a comp — servers cannot self-issue freebies.
  IF NOT (public.is_club_fnb_kind(v_uid, p_club_id, 'cashier')
          OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden', 'detail', 'comp requires cashier or owner');
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'empty lines');
  END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);

  -- Create the order (status=pending) with comp flags set.
  BEGIN
    INSERT INTO public.fnb_orders
      (club_id, status, source, table_label, customer_name, note,
       is_comp, comp_reason, comp_authorized_by,
       subtotal_vnd, client_request_id, created_by)
    VALUES
      (p_club_id, 'pending', p_source, p_table_label, p_customer_name, p_note,
       true, p_comp_reason, v_uid,
       0, v_crid, v_uid)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    -- A retry with the same crid: the comp was already created (and paid atomically).
    SELECT id INTO v_order_id
      FROM public.fnb_orders
      WHERE club_id = p_club_id AND client_request_id = v_crid;
    RETURN jsonb_build_object(
      'status', 'ok', 'order_id', v_order_id, 'is_comp', true, 'idempotent', true);
  END;

  -- Insert order lines (mirror fnb_create_order: validate active menu, snapshot name).
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line->>'qty')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    SELECT id, name, price_vnd, is_active INTO v_mi
      FROM public.fnb_menu_items
      WHERE id = (v_line->>'menu_item_id')::uuid AND club_id = p_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND %', (v_line->>'menu_item_id');
    END IF;
    IF NOT v_mi.is_active THEN
      RAISE EXCEPTION 'MENU_ITEM_INACTIVE %', v_mi.name;
    END IF;
    INSERT INTO public.fnb_order_items
      (order_id, club_id, menu_item_id, name_snapshot, qty, unit_price_snapshot, line_status)
    VALUES
      (v_order_id, p_club_id, v_mi.id, v_mi.name, v_qty, v_mi.price_vnd, 'pending');
  END LOOP;

  -- ── Atomic PAID path (mirrors fnb_mark_paid from …0010) ─────────────────────────────────

  -- (P0-3) RECIPE REQUIRED: block if any tracked item has no recipe.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'menu_item_id', oi.menu_item_id,
           'name',         oi.name_snapshot,
           'qty',          oi.qty)), '[]'::jsonb)
    INTO v_norecipe
  FROM public.fnb_order_items oi
  JOIN public.fnb_menu_items mi ON mi.id = oi.menu_item_id
  WHERE oi.order_id = v_order_id
    AND COALESCE(mi.tracks_inventory, true)
    AND NOT EXISTS (
      SELECT 1 FROM public.fnb_recipe_items ri WHERE ri.menu_item_id = oi.menu_item_id
    );
  IF jsonb_array_length(v_norecipe) > 0 THEN
    RAISE EXCEPTION 'RECIPE_REQUIRED'
      USING DETAIL = v_norecipe::text, ERRCODE = 'check_violation';
  END IF;

  -- Lock ingredients in fixed id ORDER (deadlock-safe; same order in cancel + stocktake-commit).
  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (
    SELECT DISTINCT ri.ingredient_id
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = v_order_id
  )
  ORDER BY i.id
  FOR UPDATE;

  -- #A BLOCK: comps still consume real stock — abort on shortage.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', s.ingredient_id,
           'name',          s.name,
           'need',          s.need,
           'on_hand',       s.on_hand)), '[]'::jsonb)
    INTO v_shortages
  FROM (
    SELECT ri.ingredient_id, ing.name,
           SUM(oi.qty * ri.qty) AS need, ing.on_hand
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
    WHERE oi.order_id = v_order_id
    GROUP BY ri.ingredient_id, ing.name, ing.on_hand
    HAVING SUM(oi.qty * ri.qty) > ing.on_hand
  ) s;
  IF jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK'
      USING DETAIL = v_shortages::text, ERRCODE = 'check_violation';
  END IF;

  -- Decrement stock + append one 'sale' ledger row per ingredient (same as mark_paid).
  FOR v_need IN
    SELECT ri.ingredient_id, SUM(oi.qty * ri.qty) AS need
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = v_order_id
    GROUP BY ri.ingredient_id
    ORDER BY ri.ingredient_id
  LOOP
    UPDATE public.fnb_ingredients
      SET on_hand = on_hand - v_need.need,
          version = version + 1,
          updated_at = now()
      WHERE id = v_need.ingredient_id
      RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;

    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
    VALUES
      (p_club_id, v_need.ingredient_id, -v_need.need, 'sale', v_avg, v_after, 'order', v_order_id, v_uid);
  END LOOP;

  -- Snapshot COGS per line (same formula as mark_paid; subtotal_vnd stays 0).
  UPDATE public.fnb_order_items oi
    SET unit_cost_snapshot = COALESCE((
      SELECT SUM(ri.qty * ing.avg_unit_cost)
      FROM public.fnb_recipe_items ri
      JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.menu_item_id = oi.menu_item_id
    ), 0)
    WHERE oi.order_id = v_order_id;

  SELECT COALESCE(ROUND(SUM(unit_cost_snapshot * qty)), 0)
    INTO v_cogs
  FROM public.fnb_order_items WHERE order_id = v_order_id;

  -- Flip to paid: subtotal_vnd=0 (no money collected); cogs_vnd=real ingredient cost.
  UPDATE public.fnb_orders
    SET status           = 'paid',
        paid_by          = v_uid,
        paid_at          = now(),
        subtotal_vnd     = 0,
        cogs_vnd         = v_cogs,
        updated_at       = now()
    WHERE id = v_order_id;

  UPDATE public.fnb_order_items
    SET line_status = 'paid'
    WHERE order_id = v_order_id;

  INSERT INTO public.fnb_order_events
    (order_id, club_id, action, old_status, new_status, actor, metadata)
  VALUES
    (v_order_id, p_club_id, 'comp_paid', 'pending', 'paid', v_uid,
     jsonb_build_object(
       'is_comp',              true,
       'comp_reason',          p_comp_reason,
       'comp_authorized_by',   v_uid
     ));

  RETURN jsonb_build_object(
    'status',    'ok',
    'order_id',  v_order_id,
    'is_comp',   true,
    'cogs_vnd',  v_cogs,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_create_comp_order(
  uuid, public.fnb_order_source, text, text, text, jsonb, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_create_comp_order(
  uuid, public.fnb_order_source, text, text, text, jsonb, text, text
) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (run in a tx + ROLLBACK after 000000..000011 + this):
--
-- BEGIN;
--   -- Setup: stock an ingredient, assign cashier, create a menu item with recipe.
--   -- (a) cashier can comp → stock decrements, subtotal=0, cogs>0, is_comp=true:
--   SELECT public.fnb_create_comp_order('<club>','counter',NULL,NULL,NULL,
--     '[{"menu_item_id":"<M>","qty":1}]','Staff event','comp1');
--   SELECT subtotal_vnd, cogs_vnd, is_comp, comp_reason FROM public.fnb_orders WHERE ... ;
--   -- EXPECT: subtotal_vnd=0, cogs_vnd>0, is_comp=true, comp_reason='Staff event'
--
--   -- (b) server cannot comp → Forbidden:
--   SET LOCAL role = '<server_jwt>'; SELECT public.fnb_create_comp_order(...);
--   -- EXPECT: {error:'Forbidden'}
--
--   -- (c) idempotency: same crid returns existing order without double-decrement:
--   SELECT public.fnb_create_comp_order(..., 'comp1');  -- EXPECT: idempotent=true
--
--   -- (d) RECIPE_REQUIRED: comp of item with tracks_inventory=true + no recipe → RAISE:
--   -- (e) INSUFFICIENT_STOCK: comp when on_hand < need → RAISE (full tx abort).
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text);
--   DROP INDEX  IF EXISTS public.idx_fnb_orders_comp;
--   ALTER TABLE public.fnb_orders
--     DROP COLUMN IF EXISTS comp_authorized_by,
--     DROP COLUMN IF EXISTS comp_reason,
--     DROP COLUMN IF EXISTS is_comp;
-- ===========================================================================================
