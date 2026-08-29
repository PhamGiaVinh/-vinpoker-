-- F&B module (FNB-P0-fix gate …0010) — ORDER-LIFECYCLE correctness. DEPENDS ON 000002 (schema) +
-- 000003 (fnb_mark_paid / fnb_cancel_order, live) + 000004 (fnb_upsert_menu_item, live).
--
-- SOURCE-ONLY. Apply in a controlled session (Supabase SQL Editor / Management API), owner-gated,
-- AFTER P3-level review. NOT `db push` / not deploy_db. schema_migrations untouched. Number
-- 20261111000010 is FREE on origin/main. Reviewed at P3 rigor (touches money/stock paths).
--
-- WHY (owner P0 review 2026-06-29 — 2 real LIVE bugs + 1 gap):
--   (P0-3) fnb_mark_paid only decrements via the recipe JOIN, so an ACTIVE item with NO recipe sells
--          with no stock movement and COGS 0 → phantom margin. v1 promises mandatory inventory/COGS.
--   (P0-2) fnb_cancel_order restocks by RE-READING the CURRENT recipe (SUM(oi.qty*ri.qty)); if the
--          recipe changed after PAID, the restock quantity ≠ what was deducted → wrong on_hand.
--   These are dark (flags OFF, no real orders yet), so fixing now is safe + pre-production.
--
-- WHAT (3 surgical changes; every other line of each function is byte-preserved):
--   1. ADD COLUMN fnb_menu_items.tracks_inventory boolean NOT NULL DEFAULT true (existing rows → true,
--      no behavior change until an item is opted out). Drop-then-create fnb_upsert_menu_item with a 9th
--      arg p_tracks_inventory (adding an arg = a NEW overload, not a replace → DROP the 8-arg sig first
--      to avoid an ambiguous PostgREST overload).
--   2. fnb_mark_paid: RAISE 'RECIPE_REQUIRED' (structured JSON detail) BEFORE the shortage check if any
--      active line's item has tracks_inventory=true AND zero recipe rows. tracks_inventory=false is an
--      explicit owner exemption (sell with COGS 0, no decrement). Inventory policy is evaluated at PAID
--      time (consistent with price/COGS freeze at PAID), not snapshotted at create.
--   3. fnb_cancel_order: restock by REVERSING the actual `sale` ledger rows (ref_type='order',
--      ref_id=order, reason='sale'), NOT a recompute from the current recipe — recipe/price/menu edits
--      after PAID can no longer corrupt restock. Same fixed `ORDER BY ingredient_id` lock (deadlock-safe
--      vs a concurrent mark_paid, which also locks ascending id). shipped-cancel restock policy
--      (restock_on_shipped_cancel, default false) unchanged.
--
-- P3 GUARANTEES: all functions keep SECURITY DEFINER + search_path=public + the SAME authz
-- (mark_paid = cashier-or-owner; cancel = cashier-or-owner-or-pending-creator; upsert = owner-only) +
-- the same idempotency/lock posture. No new privileges. Append-only ledger triggers unchanged.

-- ===========================================================================================
-- 1. tracks_inventory column + fnb_upsert_menu_item (drop 8-arg → create 9-arg).
-- ===========================================================================================
ALTER TABLE public.fnb_menu_items ADD COLUMN IF NOT EXISTS tracks_inventory boolean NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS public.fnb_upsert_menu_item(uuid, uuid, uuid, text, bigint, boolean, text, int);

CREATE OR REPLACE FUNCTION public.fnb_upsert_menu_item(
  p_club_id          uuid,
  p_id               uuid DEFAULT NULL,
  p_category_id      uuid DEFAULT NULL,
  p_name             text DEFAULT NULL,
  p_price_vnd        bigint DEFAULT NULL,
  p_is_active        boolean DEFAULT NULL,
  p_image_url        text DEFAULT NULL,
  p_sort_order       int  DEFAULT NULL,
  p_tracks_inventory boolean DEFAULT NULL   -- NULL = (insert) default true / (update) keep existing
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_price_vnd IS NOT NULL AND p_price_vnd < 0 THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'price'); END IF;
  -- a category, if given, must belong to this club
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fnb_categories WHERE id = p_category_id AND club_id = p_club_id
  ) THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'category'); END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'name'); END IF;
    INSERT INTO public.fnb_menu_items (club_id, category_id, name, price_vnd, is_active, image_url, sort_order, tracks_inventory)
    VALUES (p_club_id, p_category_id, p_name, COALESCE(p_price_vnd, 0), COALESCE(p_is_active, true), p_image_url, COALESCE(p_sort_order, 0), COALESCE(p_tracks_inventory, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.fnb_menu_items
      SET category_id      = COALESCE(p_category_id, category_id),
          name             = COALESCE(p_name, name),
          price_vnd        = COALESCE(p_price_vnd, price_vnd),
          is_active        = COALESCE(p_is_active, is_active),
          image_url        = COALESCE(p_image_url, image_url),
          sort_order       = COALESCE(p_sort_order, sort_order),
          tracks_inventory = COALESCE(p_tracks_inventory, tracks_inventory),
          updated_at       = now()
      WHERE id = p_id AND club_id = p_club_id
      RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'DUPLICATE_NAME');
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_upsert_menu_item(uuid, uuid, uuid, text, bigint, boolean, text, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_upsert_menu_item(uuid, uuid, uuid, text, bigint, boolean, text, int, boolean) TO authenticated;

-- ===========================================================================================
-- 2. fnb_mark_paid — UNCHANGED except the (P0-3) RECIPE_REQUIRED guard before the shortage check.
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

  IF NOT (public.is_club_fnb_kind(v_uid, v_order.club_id, 'cashier') OR public.is_club_owner(v_uid, v_order.club_id)) THEN
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

-- ===========================================================================================
-- 3. fnb_cancel_order — UNCHANGED except the (P0-2) restock loop now reverses the SALE LEDGER rows.
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

  IF NOT (public.is_club_fnb_kind(v_uid, v_order.club_id, 'cashier') OR public.is_club_owner(v_uid, v_order.club_id)
          OR (v_order.status = 'pending' AND v_order.created_by = v_uid)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  IF v_order.status IN ('cancelled', 'expired') THEN
    RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'idempotent', true);
  END IF;

  -- decide restock by prior state
  IF v_order.status = 'paid' THEN
    v_restock := true;                                   -- not served yet → restore stock
  ELSIF v_order.status = 'shipped' THEN
    SELECT COALESCE((SELECT restock_on_shipped_cancel FROM public.fnb_settings WHERE club_id = v_order.club_id), false)
      INTO v_restock;                                    -- default false → refund only, NO restock
  ELSE
    v_restock := false;                                  -- pending → nothing was deducted
  END IF;

  IF v_restock THEN
    -- (P0-2) reverse the ACTUAL 'sale' ledger rows for this order — NOT a recompute from the current
    --   recipe (which may have changed since PAID). Lock the same ingredients in fixed id order
    --   (ascending), matching fnb_mark_paid's lock order → no deadlock between a cancel and a PAID.
    PERFORM 1 FROM public.fnb_ingredients i
    WHERE i.id IN (
      SELECT DISTINCT sm.ingredient_id
      FROM public.fnb_stock_movements sm
      WHERE sm.ref_type = 'order' AND sm.ref_id = p_order_id AND sm.reason = 'sale'
    )
    ORDER BY i.id
    FOR UPDATE;

    FOR v_need IN
      SELECT sm.ingredient_id AS ingredient_id, -SUM(sm.delta) AS need   -- sale delta is negative → need > 0
      FROM public.fnb_stock_movements sm
      WHERE sm.ref_type = 'order' AND sm.ref_id = p_order_id AND sm.reason = 'sale'
      GROUP BY sm.ingredient_id
      HAVING -SUM(sm.delta) <> 0
      ORDER BY sm.ingredient_id
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

  RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'reversed_stock', v_restock);
END;
$$;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (after 000000..000004 + 000009 + this; run in a tx + ROLLBACK).
--   Fixture: <club>+<cashier>+<owner>; item M_norec (active, tracks_inventory=true, NO recipe);
--   item M_exempt (active, tracks_inventory=false); item M (recipe: 2× ingredient I); I via stock_in.
--
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   -- (P0-3) no-recipe tracked item → PAID blocked:
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--            jsonb_build_array(jsonb_build_object('menu_item_id','<M_norec>','qty',1)),'o_nr');
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_mark_paid('<o_nr>');   -- ERROR RECIPE_REQUIRED
--   -- exemption: tracks_inventory=false item sells, COGS 0, no stock movement:
--   SET LOCAL request.jwt.claim.sub = '<cashier>';
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--            jsonb_build_array(jsonb_build_object('menu_item_id','<M_exempt>','qty',1)),'o_ex');
--   SELECT public.fnb_mark_paid('<o_ex>');                                  -- ok, cogs_vnd=0
--   SELECT count(*) FROM public.fnb_stock_movements WHERE ref_id='<o_ex>';  -- 0
--   -- (P0-2) recipe-change-then-cancel restocks the ORIGINAL deducted qty (not the new recipe):
--   SET LOCAL request.jwt.claim.sub = '<cashier>';
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--            jsonb_build_array(jsonb_build_object('menu_item_id','<M>','qty',1)),'o_rc');
--   SELECT public.fnb_mark_paid('<o_rc>');                                  -- decrement I by 2 ('sale' -2)
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.fnb_set_recipe('<M>', jsonb_build_array(jsonb_build_object('ingredient_id','<I>','qty',5)));  -- recipe now 5
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_cancel_order('<o_rc>','test');             -- restock +2 (ledger), NOT +5
--   SELECT delta, reason FROM public.fnb_stock_movements WHERE ref_id='<o_rc>' ORDER BY created_at;             -- -2 sale, +2 cancel_return
-- ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (restore the pre-…0010 live definitions): re-apply 000003's fnb_mark_paid + fnb_cancel_order
--   bodies and 000004's 8-arg fnb_upsert_menu_item, then:
--     DROP FUNCTION IF EXISTS public.fnb_upsert_menu_item(uuid,uuid,uuid,text,bigint,boolean,text,int,boolean);
--     ALTER TABLE public.fnb_menu_items DROP COLUMN IF EXISTS tracks_inventory;
--   (tracks_inventory defaults true, so leaving the column is harmless; the mark_paid guard is the only
--    behavior change and reverts with the 000003 body.)
-- ===========================================================================================
