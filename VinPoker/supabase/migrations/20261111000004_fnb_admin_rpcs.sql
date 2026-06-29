-- F&B module (FNB-P4) — admin CRUD RPCs + read-only F&B report. DEPENDS ON 000000..000003.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 000000 → 000001 → 000002 → 000003 →
-- THIS in a controlled session (Management API / `supabase db query --linked --file`, NOT `db push`
-- / not deploy_db). Regen types.ts SEPARATELY. schema_migrations is NOT touched.
--
-- Every function: SECURITY DEFINER, SET search_path = public, REVOKE ALL FROM PUBLIC/anon +
-- GRANT EXECUTE TO authenticated, explicit auth.uid() authz INSIDE.
--
-- AUTHZ (per the §7 permission table):
--   * Menu / category / ingredient / recipe upserts AND fnb_update_settings = club OWNER/ADMIN only
--     (public.is_club_owner, which also covers super_admin). "Admin" here = the club owner — a cashier
--     may NOT edit the menu, prices, recipes, ingredients, or settings.
--   * fnb_update_settings is the ONLY writer of fnb_in_club_net (the finance kill-switch) → owner-only.
--   * fnb_get_report is read-only/STABLE; visible to any F&B staff OR owner of the club (scope is the
--     server-side public.fnb_club_ids set — never a client-supplied club list).
--
-- These RPCs NEVER move stock or money. on_hand / avg_unit_cost / version are written ONLY by the
-- ledger RPCs in 000003 (stock_in / mark_paid / cancel / stocktake); fnb_upsert_ingredient touches
-- METADATA only.

-- ===========================================================================================
-- 1. fnb_upsert_category
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_upsert_category(
  p_club_id    uuid,
  p_id         uuid DEFAULT NULL,
  p_name       text DEFAULT NULL,
  p_sort_order int  DEFAULT NULL,
  p_is_active  boolean DEFAULT NULL
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

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'name'); END IF;
    INSERT INTO public.fnb_categories (club_id, name, sort_order, is_active)
    VALUES (p_club_id, p_name, COALESCE(p_sort_order, 0), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.fnb_categories
      SET name       = COALESCE(p_name, name),
          sort_order = COALESCE(p_sort_order, sort_order),
          is_active  = COALESCE(p_is_active, is_active)
      WHERE id = p_id AND club_id = p_club_id
      RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'DUPLICATE_NAME');
END;
$$;

-- ===========================================================================================
-- 2. fnb_upsert_menu_item  (price lives here; read server-side at PAID)
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_upsert_menu_item(
  p_club_id     uuid,
  p_id          uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_price_vnd   bigint DEFAULT NULL,
  p_is_active   boolean DEFAULT NULL,
  p_image_url   text DEFAULT NULL,
  p_sort_order  int  DEFAULT NULL
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
    INSERT INTO public.fnb_menu_items (club_id, category_id, name, price_vnd, is_active, image_url, sort_order)
    VALUES (p_club_id, p_category_id, p_name, COALESCE(p_price_vnd, 0), COALESCE(p_is_active, true), p_image_url, COALESCE(p_sort_order, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.fnb_menu_items
      SET category_id = COALESCE(p_category_id, category_id),
          name        = COALESCE(p_name, name),
          price_vnd   = COALESCE(p_price_vnd, price_vnd),
          is_active   = COALESCE(p_is_active, is_active),
          image_url   = COALESCE(p_image_url, image_url),
          sort_order  = COALESCE(p_sort_order, sort_order),
          updated_at  = now()
      WHERE id = p_id AND club_id = p_club_id
      RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'DUPLICATE_NAME');
END;
$$;

-- ===========================================================================================
-- 3. fnb_upsert_ingredient  (METADATA only — never touches on_hand / avg_unit_cost / version)
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_upsert_ingredient(
  p_club_id             uuid,
  p_id                  uuid DEFAULT NULL,
  p_name                text DEFAULT NULL,
  p_stock_unit          text DEFAULT NULL,
  p_purchase_unit       text DEFAULT NULL,
  p_units_per_purchase  numeric DEFAULT NULL,
  p_low_stock_threshold numeric DEFAULT NULL,
  p_is_active           boolean DEFAULT NULL
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
  IF p_units_per_purchase IS NOT NULL AND p_units_per_purchase <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'units_per_purchase');
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'name'); END IF;
    IF p_stock_unit IS NULL OR btrim(p_stock_unit) = '' THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'stock_unit'); END IF;
    -- on_hand / avg_unit_cost left at their table defaults (0); they move ONLY via the ledger RPCs.
    INSERT INTO public.fnb_ingredients (club_id, name, stock_unit, purchase_unit, units_per_purchase, low_stock_threshold, is_active)
    VALUES (p_club_id, p_name, p_stock_unit, p_purchase_unit, COALESCE(p_units_per_purchase, 1), COALESCE(p_low_stock_threshold, 0), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.fnb_ingredients
      SET name                = COALESCE(p_name, name),
          stock_unit          = COALESCE(p_stock_unit, stock_unit),
          purchase_unit       = COALESCE(p_purchase_unit, purchase_unit),
          units_per_purchase  = COALESCE(p_units_per_purchase, units_per_purchase),
          low_stock_threshold = COALESCE(p_low_stock_threshold, low_stock_threshold),
          is_active           = COALESCE(p_is_active, is_active),
          updated_at          = now()
      WHERE id = p_id AND club_id = p_club_id
      RETURNING id INTO v_id;   -- on_hand / avg_unit_cost / version intentionally NOT in the SET list
    IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'DUPLICATE_NAME');
END;
$$;

-- ===========================================================================================
-- 4. fnb_set_recipe — FULL-REPLACE the BOM of a menu item in ONE tx (like update_blind_structure).
--    p_items = [{ "ingredient_id": uuid, "qty": numeric }, ...]  (empty array clears the recipe).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_set_recipe(
  p_menu_item_id uuid,
  p_items        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_club  uuid;
  v_item  jsonb;
  v_ing   uuid;
  v_qty   numeric;
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT club_id INTO v_club FROM public.fnb_menu_items WHERE id = p_menu_item_id;
  IF v_club IS NULL THEN RETURN jsonb_build_object('error', 'MENU_ITEM_NOT_FOUND'); END IF;
  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  -- full-replace: clear then re-insert. A RAISE below aborts the whole tx → the DELETE is rolled
  -- back too, so the recipe is never left half-applied.
  DELETE FROM public.fnb_recipe_items WHERE menu_item_id = p_menu_item_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_ing := (v_item->>'ingredient_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY %', COALESCE(v_ing::text, '?'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fnb_ingredients WHERE id = v_ing AND club_id = v_club) THEN
      RAISE EXCEPTION 'INGREDIENT_NOT_FOUND %', v_ing;   -- enforces same-club ingredients
    END IF;
    INSERT INTO public.fnb_recipe_items (club_id, menu_item_id, ingredient_id, qty)
    VALUES (v_club, p_menu_item_id, v_ing, v_qty)
    ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE SET qty = EXCLUDED.qty;  -- dedupe within the payload
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'menu_item_id', p_menu_item_id, 'items_saved', v_count);
END;
$$;

-- ===========================================================================================
-- 5. fnb_update_settings — owner-only. The ONLY writer of fnb_in_club_net (finance kill-switch).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_update_settings(
  p_club_id                   uuid,
  p_pending_ttl_secs          int     DEFAULT NULL,
  p_restock_on_shipped_cancel boolean DEFAULT NULL,
  p_fnb_in_club_net           boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_pending_ttl_secs IS NOT NULL AND p_pending_ttl_secs <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'pending_ttl_secs');
  END IF;

  INSERT INTO public.fnb_settings (club_id, pending_ttl_secs, restock_on_shipped_cancel, fnb_in_club_net, updated_at, updated_by)
  VALUES (p_club_id, COALESCE(p_pending_ttl_secs, 900), COALESCE(p_restock_on_shipped_cancel, false), COALESCE(p_fnb_in_club_net, false), now(), v_uid)
  ON CONFLICT (club_id) DO UPDATE SET
    pending_ttl_secs          = COALESCE(p_pending_ttl_secs, public.fnb_settings.pending_ttl_secs),
    restock_on_shipped_cancel = COALESCE(p_restock_on_shipped_cancel, public.fnb_settings.restock_on_shipped_cancel),
    fnb_in_club_net           = COALESCE(p_fnb_in_club_net, public.fnb_settings.fnb_in_club_net),
    updated_at                = now(),
    updated_by                = v_uid;

  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id);
END;
$$;

-- ===========================================================================================
-- 6. fnb_get_report — READ-ONLY / STABLE. F&B-only P&L + ops view (the "filtered" view).
--    Scope is the server-side public.fnb_club_ids set (memberships ∪ owned ∪ all-if-super_admin);
--    an explicit p_club_id must be inside that set, else 'forbidden'. Never trusts a client club id.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_get_report(
  p_from    timestamptz,
  p_to      timestamptz,
  p_club_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_all_ids uuid[];
  v_scope   uuid[];
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(array_agg(x), '{}') INTO v_all_ids FROM public.fnb_club_ids(v_uid) x;

  IF p_club_id IS NOT NULL THEN
    IF NOT (p_club_id = ANY(v_all_ids)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    v_scope := ARRAY[p_club_id];
  ELSE
    v_scope := v_all_ids;
  END IF;

  WITH
  paid AS (
    SELECT o.id, o.subtotal_vnd, o.cogs_vnd, o.paid_at
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.status = 'paid' AND o.paid_at BETWEEN p_from AND p_to
  ),
  itms AS (
    SELECT oi.menu_item_id, oi.name_snapshot,
           SUM(oi.qty) AS qty, SUM(oi.unit_price_snapshot * oi.qty) AS revenue
    FROM public.fnb_order_items oi
    JOIN paid p ON p.id = oi.order_id
    GROUP BY oi.menu_item_id, oi.name_snapshot
  ),
  status_rows AS (
    SELECT status::text AS status, COUNT(*) AS cnt
    FROM public.fnb_orders
    WHERE club_id = ANY(v_scope) AND created_at BETWEEN p_from AND p_to
    GROUP BY status
  ),
  low AS (
    SELECT id, name, on_hand, low_stock_threshold, stock_unit
    FROM public.fnb_ingredients
    WHERE club_id = ANY(v_scope) AND is_active AND on_hand <= low_stock_threshold
  ),
  daily AS (
    SELECT to_char(paid_at, 'YYYY-MM-DD') AS d, SUM(subtotal_vnd) AS revenue, SUM(cogs_vnd) AS cogs
    FROM paid GROUP BY to_char(paid_at, 'YYYY-MM-DD')
  )
  SELECT jsonb_build_object(
    'revenue',     (SELECT COALESCE(SUM(subtotal_vnd), 0) FROM paid),
    'cogs',        (SELECT COALESCE(SUM(cogs_vnd), 0) FROM paid),
    'grossProfit', (SELECT COALESCE(SUM(subtotal_vnd), 0) - COALESCE(SUM(cogs_vnd), 0) FROM paid),
    'orderCount',  (SELECT COUNT(*) FROM paid),
    'statusCounts',(SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM status_rows),
    'topItems',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'menuItemId', menu_item_id, 'name', name_snapshot, 'qty', qty, 'revenue', revenue)
                       ORDER BY revenue DESC), '[]'::jsonb)
                    FROM (SELECT * FROM itms ORDER BY revenue DESC LIMIT 10) t),
    'lowStock',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'ingredientId', id, 'name', name, 'onHand', on_hand,
                       'threshold', low_stock_threshold, 'unit', stock_unit)
                       ORDER BY (on_hand - low_stock_threshold)), '[]'::jsonb)
                    FROM low),
    'dailyTrend',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'cogs', cogs)
                       ORDER BY d), '[]'::jsonb)
                    FROM daily)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ===========================================================================================
-- 7. Grants
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.fnb_upsert_category(uuid, uuid, text, int, boolean)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_upsert_menu_item(uuid, uuid, uuid, text, bigint, boolean, text, int)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_upsert_ingredient(uuid, uuid, text, text, text, numeric, numeric, boolean)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_set_recipe(uuid, jsonb)                                                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_update_settings(uuid, int, boolean, boolean)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_get_report(timestamptz, timestamptz, uuid)                                        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fnb_upsert_category(uuid, uuid, text, int, boolean)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_upsert_menu_item(uuid, uuid, uuid, text, bigint, boolean, text, int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_upsert_ingredient(uuid, uuid, text, text, text, numeric, numeric, boolean)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_set_recipe(uuid, jsonb)                                                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_update_settings(uuid, int, boolean, boolean)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_get_report(timestamptz, timestamptz, uuid)                                        TO authenticated;

-- ===========================================================================================
-- Controlled-apply SANITY (after 000000..000003 + this; run in a tx + ROLLBACK).
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_upsert_menu_item('<club>',NULL,NULL,'Cà phê',25000,true,NULL,0); -- Forbidden
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_upsert_category('<club>',NULL,'Đồ uống',0,true);                 -- ok {id}
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_upsert_menu_item('<club>',NULL,'<cat>','Cà phê sữa',25000,true,NULL,0); -- ok
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_set_recipe('<menu>', jsonb_build_array(jsonb_build_object('ingredient_id','<ing>','qty',18))); -- full-replace
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_update_settings('<club>',NULL,NULL,true);  -- Forbidden (owner-only finance toggle)
--   SET LOCAL request.jwt.claim.sub = '<staff>';   SELECT public.fnb_get_report(now()-interval '7 day', now(), '<club>'); -- ok (read-only)
--   SET LOCAL request.jwt.claim.sub = '<other>';   SELECT public.fnb_get_report(now()-interval '7 day', now(), '<club>'); -- ERROR forbidden (not in fnb_club_ids)
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_get_report(timestamptz, timestamptz, uuid);
--   DROP FUNCTION IF EXISTS public.fnb_update_settings(uuid, int, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.fnb_set_recipe(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.fnb_upsert_ingredient(uuid, uuid, text, text, text, numeric, numeric, boolean);
--   DROP FUNCTION IF EXISTS public.fnb_upsert_menu_item(uuid, uuid, uuid, text, bigint, boolean, text, int);
--   DROP FUNCTION IF EXISTS public.fnb_upsert_category(uuid, uuid, text, int, boolean);
-- ===========================================================================================
