-- F&B A2 — link a REGULAR order to a real table + seated player (reporting-only). DEPENDS ON
-- 000002 (fnb_orders), 000003 (fnb_create_order), 000013 (current fnb_get_report body).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply in a controlled session (Supabase SQL
-- Editor / Management API / `supabase db query --linked --file`), owner-gated, AFTER review. NOT
-- `db push` / not `db reset` / not `migration up` / not deploy_db. schema_migrations untouched.
-- types.ts regen is a SEPARATE step. Number 20261111000014 verified FREE on origin/main (2026-07-02:
-- F&B series tops at …0013; SePay `20261114*` is a different prefix).
--
-- WHY: replace the free-text `table_label` with SOFT pointers to VinPoker's real tables/players so
--   the owner can read "F&B theo bàn / theo player". This is **knowing / reporting ONLY** — it is
--   NEVER a player tab, balance, debt, or any chip/bank write. F&B stays 100% pre-paid; `table_label`
--   / `customer_name` free-text remain the walk-in fallback.
--
-- WHAT:
--   1. fnb_orders += `table_ref uuid`, `player_ref uuid` — **SOFT pointers, NO FK** (matches the
--      existing created_by/paid_by/cancelled_by convention; keeps F&B independent of the
--      game/tournament lifecycle — a dropped table/player never cascades into F&B history). + 2
--      partial indexes for the by-table / by-player report.
--   2. fnb_create_order — DROP the exact 7-arg signature, CREATE a 9-arg one adding
--      `p_table_ref` / `p_player_ref` (a defaulted arg = a NEW overload, so DROP-then-CREATE avoids
--      an ambiguous PostgREST overload — same lesson as …0010's fnb_upsert_menu_item). Body is
--      byte-preserved where refs are NULL; refs are validated (must belong to this club) then persisted.
--   3. fnb_list_link_targets(p_club_id) — a NEW read RPC = the picker's read path. F&B cashiers CANNOT
--      read game_tables / tournament_tables (their RLS gates to dealer-control / admin / owner), so
--      this SECURITY DEFINER function reads them on the caller's behalf, authz'd INSIDE. It does NOT
--      widen any RLS. Returns club tables + seated players in the club's live tournaments (labels only).
--   4. fnb_get_report — CREATE OR REPLACE (clone the CURRENT LIVE …0013 comp-split body) + `byTable` /
--      `byPlayer` breakdowns. ALL existing keys stay byte-identical; the two new keys reconcile to the
--      existing `revenue`/`cogs` totals.
--
-- DOES NOT TOUCH: get_club_finance_summary (club P&L) → NO golden-diff gate needed. fnb_create_comp_order
--   (the day-old A1 comp RPC) → untouched; comps do not capture a ref in A2. No write to any
--   game/tournament/player/chip/bank table — the game_tables/tournament_seats/profiles reads are
--   SELECT-only inside SECURITY DEFINER validation/lookup.
--
-- FLAG: fnbTableLink (default false) — the frontend ships dark in a SEPARATE PR. Flip after apply + UAT.
-- ROLLBACK: see bottom of this file.

-- ===========================================================================================
-- 1. Schema — soft refs on fnb_orders (idempotent ADD COLUMN IF NOT EXISTS; NO FK).
-- ===========================================================================================
ALTER TABLE public.fnb_orders
  ADD COLUMN IF NOT EXISTS table_ref  uuid,   -- soft → game_tables(id); NO FK (reporting-only)
  ADD COLUMN IF NOT EXISTS player_ref uuid;   -- soft → tournament_seats.player_id; NO FK

COMMENT ON COLUMN public.fnb_orders.table_ref IS
  'A2: soft pointer to game_tables(id) for "F&B theo bàn" reporting. NO FK. NULL = walk-in (table_label).';
COMMENT ON COLUMN public.fnb_orders.player_ref IS
  'A2: soft pointer to a seated player (tournament_seats.player_id) for "F&B theo player" reporting. '
  'NO FK, reporting-only — NEVER a player tab/balance/debt. NULL = no player linked.';

-- Partial indexes for the by-table / by-player report buckets (paid_at, same shape as idx_fnb_orders_club_paid).
CREATE INDEX IF NOT EXISTS idx_fnb_orders_table_ref
  ON public.fnb_orders(club_id, table_ref, paid_at) WHERE table_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fnb_orders_player_ref
  ON public.fnb_orders(club_id, player_ref, paid_at) WHERE player_ref IS NOT NULL;

-- ===========================================================================================
-- 2. fnb_create_order — DROP 7-arg, CREATE 9-arg (+ p_table_ref / p_player_ref).
--    Clone of …0003 verbatim; refs validated (must belong to this club) then persisted. Behavior
--    with both refs NULL is byte-identical to the live 7-arg body (existing counter flow unchanged).
-- ===========================================================================================
DROP FUNCTION IF EXISTS public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.fnb_create_order(
  p_club_id           uuid,
  p_source            public.fnb_order_source,
  p_table_label       text,
  p_customer_name     text,
  p_note              text,
  p_lines             jsonb,                 -- [{ "menu_item_id": uuid, "qty": int }, ...]
  p_client_request_id text DEFAULT NULL,
  p_table_ref         uuid DEFAULT NULL,     -- A2: soft link to game_tables(id) in this club (optional)
  p_player_ref        uuid DEFAULT NULL      -- A2: soft link to a seated player in this club (optional)
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

  -- (A2) validate the OPTIONAL soft refs BEFORE any insert (reporting-only; NO FK, NO player write).
  --   A bad ref aborts with a clear code; the tx has no F&B changes yet, so nothing is rolled back.
  IF p_table_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.game_tables gt WHERE gt.id = p_table_ref AND gt.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'INVALID_TABLE_REF';
  END IF;
  IF p_player_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tournament_seats ts
    JOIN public.tournaments t ON t.id = ts.tournament_id
    WHERE ts.player_id = p_player_ref AND ts.is_active AND t.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER_REF';
  END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);

  -- (3) idempotency: insert the order; a retry with the same crid returns the existing order.
  BEGIN
    INSERT INTO public.fnb_orders (club_id, status, source, table_label, customer_name, note,
                                   table_ref, player_ref, client_request_id, created_by)
    VALUES (p_club_id, 'pending', p_source, p_table_label, p_customer_name, p_note,
            p_table_ref, p_player_ref, v_crid, v_uid)
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

REVOKE ALL ON FUNCTION public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text, uuid, uuid) TO authenticated;

-- ===========================================================================================
-- 3. fnb_list_link_targets — the picker's READ path (F&B cashiers can't read game_tables /
--    tournament_tables under RLS). SECURITY DEFINER reads them on the caller's behalf, authz INSIDE.
--    READ-ONLY: STABLE, no INSERT/UPDATE/DELETE. Returns labels only — NO chip/bank/debt data.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_list_link_targets(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tables  jsonb;
  v_players jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  -- authz: any F&B facet or the owner (same posture as fnb_create_order's read side).
  IF NOT (public.is_club_fnb(v_uid, p_club_id) OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- active club tables (label + status only; NO dealer/blind internals)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',         gt.id,
           'table_name', gt.table_name,
           'status',     gt.status
         ) ORDER BY gt.table_name), '[]'::jsonb) INTO v_tables
  FROM public.game_tables gt
  WHERE gt.club_id = p_club_id AND gt.status = 'active';

  -- seated players in THIS club's live tournaments (reporting labels only; NO chip/bank/debt)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',   ts.player_id,
           'name',        COALESCE(pr.display_name, left(ts.player_id::text, 6)),
           'table_id',    ts.table_id,
           'table_name',  gt.table_name,
           'seat_number', ts.seat_number
         ) ORDER BY gt.table_name NULLS LAST, ts.seat_number), '[]'::jsonb) INTO v_players
  FROM public.tournament_seats ts
  JOIN public.tournaments t
       ON t.id = ts.tournament_id
      AND t.club_id = p_club_id
      AND t.status::text IN ('registering','drawing','active','live','break','final_table')
  LEFT JOIN public.game_tables gt ON gt.id = ts.table_id
  LEFT JOIN public.profiles    pr ON pr.user_id = ts.player_id
  WHERE ts.is_active;

  RETURN jsonb_build_object('status', 'ok', 'tables', v_tables, 'players', v_players);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_list_link_targets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_list_link_targets(uuid) TO authenticated;

-- ===========================================================================================
-- 4. fnb_get_report — CREATE OR REPLACE (clone of the CURRENT LIVE …0013 comp-split body) + byTable /
--    byPlayer. Every pre-existing key is byte-identical; the new keys group the SAME `sale`/`refund`
--    recognition, so Σ byTable.revenue == Σ byPlayer.revenue == the existing `revenue` key.
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
  -- [C] sale: regular paid orders only (comps excluded). [A2] carry table_ref/player_ref.
  sale AS (
    SELECT o.id, o.subtotal_vnd::numeric AS revenue, o.cogs_vnd::numeric AS cogs, o.paid_at AS recog_at,
           o.table_ref, o.player_ref
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  -- [C] refund: regular cancelled orders only (comp cancels excluded). [A2] carry table_ref/player_ref.
  refund AS (
    SELECT o.id, -o.subtotal_vnd::numeric AS revenue,
           CASE WHEN o.shipped_at IS NULL THEN -o.cogs_vnd::numeric ELSE 0 END AS cogs,
           o.cancelled_at AS recog_at,
           o.table_ref, o.player_ref
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  recog AS (
    SELECT id, revenue, cogs, recog_at FROM sale
    UNION ALL
    SELECT id, revenue, cogs, recog_at FROM refund
  ),
  -- [A2] ref recognition = sale ∪ refund carrying the soft refs (so by-table/by-player net refunds
  --      and reconcile to the `revenue`/`cogs` totals).
  ref_recog AS (
    SELECT id, revenue, cogs, table_ref, player_ref FROM sale
    UNION ALL
    SELECT id, revenue, cogs, table_ref, player_ref FROM refund
  ),
  item_recog AS (
    SELECT oi.menu_item_id, oi.name_snapshot,
           oi.qty::numeric AS qty, (oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN sale s ON s.id = oi.order_id
    UNION ALL
    SELECT oi.menu_item_id, oi.name_snapshot,
           -oi.qty::numeric AS qty, -(oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN public.fnb_orders o ON o.id = oi.order_id
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL AND o.shipped_at IS NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  itms AS (
    SELECT menu_item_id, name_snapshot, SUM(qty) AS qty, SUM(revenue) AS revenue
    FROM item_recog GROUP BY menu_item_id, name_snapshot
  ),
  -- [A2] revenue/COGS grouped by the soft table ref (NULL → "Khách lẻ").
  by_table AS (
    SELECT rr.table_ref AS ref,
           COALESCE(gt.table_name, 'Khách lẻ') AS name,
           SUM(rr.revenue) AS revenue, SUM(rr.cogs) AS cogs, COUNT(DISTINCT rr.id) AS cnt
    FROM ref_recog rr
    LEFT JOIN public.game_tables gt ON gt.id = rr.table_ref
    GROUP BY rr.table_ref, gt.table_name
  ),
  -- [A2] revenue/COGS grouped by the soft player ref (NULL → "Khách lẻ").
  by_player AS (
    SELECT rr.player_ref AS ref,
           COALESCE(pr.display_name,
                    CASE WHEN rr.player_ref IS NULL THEN 'Khách lẻ' ELSE left(rr.player_ref::text, 6) END) AS name,
           SUM(rr.revenue) AS revenue, SUM(rr.cogs) AS cogs, COUNT(DISTINCT rr.id) AS cnt
    FROM ref_recog rr
    LEFT JOIN public.profiles pr ON pr.user_id = rr.player_ref
    GROUP BY rr.player_ref, pr.display_name
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
    SELECT to_char(recog_at, 'YYYY-MM-DD') AS d, SUM(revenue) AS revenue, SUM(cogs) AS cogs
    FROM recog GROUP BY to_char(recog_at, 'YYYY-MM-DD')
  ),
  -- [C] comp recognition: sale@paid_at (revenue=0, cogs=cogs_vnd) + cancel reversal.
  comp_sale AS (
    SELECT o.id, o.cogs_vnd::numeric AS cogs
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND COALESCE(o.is_comp, false)
      AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
  ),
  comp_cancel AS (
    SELECT o.id,
           CASE WHEN o.shipped_at IS NULL THEN -o.cogs_vnd::numeric ELSE 0 END AS cogs_reversal
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND COALESCE(o.is_comp, false)
      AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'revenue',     (SELECT COALESCE(SUM(revenue), 0) FROM recog),
    'cogs',        (SELECT COALESCE(SUM(cogs), 0) FROM recog),
    'grossProfit', (SELECT COALESCE(SUM(revenue), 0) - COALESCE(SUM(cogs), 0) FROM recog),
    'orderCount',  (SELECT COUNT(*) FROM sale),
    'statusCounts',(SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM status_rows),
    'topItems',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'menuItemId', menu_item_id, 'name', name_snapshot, 'qty', qty, 'revenue', revenue)
                       ORDER BY revenue DESC), '[]'::jsonb)
                    FROM (SELECT * FROM itms WHERE qty <> 0 OR revenue <> 0 ORDER BY revenue DESC LIMIT 10) t),
    'lowStock',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'ingredientId', id, 'name', name, 'onHand', on_hand,
                       'threshold', low_stock_threshold, 'unit', stock_unit)
                       ORDER BY (on_hand - low_stock_threshold)), '[]'::jsonb)
                    FROM low),
    'dailyTrend',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'cogs', cogs)
                       ORDER BY d), '[]'::jsonb)
                    FROM daily),
    -- [C] comp stats: issued this period + net COGS (after any pre-ship cancellations).
    'compCount',   (SELECT COUNT(*) FROM comp_sale),
    'compCogs',    (SELECT COALESCE(SUM(cogs), 0) FROM comp_sale)
                   + (SELECT COALESCE(SUM(cogs_reversal), 0) FROM comp_cancel),
    -- [A2] revenue/COGS by table + by player (reporting-only; reconcile to `revenue`/`cogs`).
    'byTable',     (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'tableRef', ref, 'name', name, 'revenue', revenue, 'cogs', cogs, 'count', cnt)
                       ORDER BY revenue DESC), '[]'::jsonb) FROM by_table),
    'byPlayer',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'playerRef', ref, 'name', name, 'revenue', revenue, 'cogs', cogs, 'count', cnt)
                       ORDER BY revenue DESC), '[]'::jsonb) FROM by_player)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

revoke all on function public.fnb_get_report(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fnb_get_report(timestamptz, timestamptz, uuid) to authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (after 000000..000013 + this; run in a tx you ROLLBACK). Fixture:
-- <owner> owns <club>; <cashier> has the cashier facet; a live tournament in <club> has an active
-- seat for <player>; <T> is an active game_table in <club>; <other> owns nothing.
--
-- BEGIN;
--   -- (a) refs NULL == unchanged create (existing counter flow byte-same):
--   SET LOCAL request.jwt.claim.sub = '<cashier>';
--   SELECT public.fnb_create_order('<club>','counter','Bàn tay',NULL,NULL,
--     '[{"menu_item_id":"<M>","qty":1}]','a2n', NULL, NULL);              -- {status:ok, table_ref stays NULL}
--   -- (b) valid refs persist:
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--     '[{"menu_item_id":"<M>","qty":1}]','a2v', '<T>', '<player>');       -- {status:ok}
--   SELECT table_ref, player_ref FROM public.fnb_orders WHERE client_request_id='a2v';  -- = <T>, <player>
--   -- (c) invalid table ref → RAISE INVALID_TABLE_REF (tx aborts, no order):
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--     '[{"menu_item_id":"<M>","qty":1}]','a2bt', gen_random_uuid(), NULL);
--   -- (d) invalid player ref → RAISE INVALID_PLAYER_REF:
--   SELECT public.fnb_create_order('<club>','counter',NULL,NULL,NULL,
--     '[{"menu_item_id":"<M>","qty":1}]','a2bp', NULL, gen_random_uuid());
--   -- (e) fnb_list_link_targets: owner/cashier see this club's active tables + live-tour seated players:
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_list_link_targets('<club>');   -- {tables:[…], players:[…]}
--   SET LOCAL request.jwt.claim.sub = '<other>';   SELECT public.fnb_list_link_targets('<club>');   -- {error: Forbidden}
--   -- (f) fnb_get_report: pre-existing keys unchanged + byTable/byPlayer present & reconcile:
--   SELECT (r ->> 'revenue')::numeric =
--          (SELECT COALESCE(SUM((e->>'revenue')::numeric),0) FROM jsonb_array_elements(r->'byTable') e) AS by_table_reconciles
--   FROM (SELECT public.fnb_get_report('2026-01-01','2026-12-31','<club>') r) q;   -- EXPECT true
-- ROLLBACK;
--
-- Read-only VERIFY after apply (owner session): grant + definer/stable + columns exist.
--   SELECT proname, prosecdef, provolatile FROM pg_proc WHERE proname IN ('fnb_create_order','fnb_list_link_targets','fnb_get_report');
--   SELECT has_function_privilege('anon','public.fnb_list_link_targets(uuid)','EXECUTE');  -- f
--   SELECT column_name FROM information_schema.columns WHERE table_name='fnb_orders' AND column_name IN ('table_ref','player_ref');
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   -- restore the 7-arg fnb_create_order + the …0013 fnb_get_report body, then drop the A2 objects:
--   DROP FUNCTION IF EXISTS public.fnb_list_link_targets(uuid);
--   DROP FUNCTION IF EXISTS public.fnb_create_order(uuid, public.fnb_order_source, text, text, text, jsonb, text, uuid, uuid);
--   -- re-apply …0003's fnb_create_order (7-arg) and …0013's fnb_get_report body from source;
--   DROP INDEX IF EXISTS public.idx_fnb_orders_player_ref;
--   DROP INDEX IF EXISTS public.idx_fnb_orders_table_ref;
--   ALTER TABLE public.fnb_orders DROP COLUMN IF EXISTS player_ref, DROP COLUMN IF EXISTS table_ref;
-- ===========================================================================================
