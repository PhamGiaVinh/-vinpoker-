-- F&B module (FNB-P5) — realtime publication for the Kitchen Display. DEPENDS ON 000002 (tables).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply in a controlled session (Management API
-- / `supabase db query --linked --file`, NOT `db push` / not deploy_db). schema_migrations is NOT
-- touched. (No types.ts impact — publication membership is not in the generated types.)
--
-- WHAT: publish ONLY public.fnb_orders + public.fnb_order_items to supabase_realtime so the Kitchen
-- Display updates live when an order is marked PAID (the lines flip to 'paid' / appear) and when a
-- server marks them SHIPPED. The frontend subscribes with:
--   supabase.channel('fnb-kitchen:'+clubId)
--     .on('postgres_changes', {event:'*', schema:'public', table:'fnb_orders',
--          filter:'club_id=eq.'+clubId}, reload)
--     .on('postgres_changes', {event:'*', schema:'public', table:'fnb_order_items',
--          filter:'club_id=eq.'+clubId}, reload)
--     .subscribe()
--
-- WHAT IS NOT PUBLISHED (intentional): fnb_stock_movements, fnb_order_events, fnb_ingredients,
-- fnb_settings, fnb_categories, fnb_menu_items, fnb_recipe_items, fnb_stocktakes/_lines, and the
-- finance RPC — none of these need a live client push, and the stock LEDGER must not stream.
--
-- REPLICA IDENTITY FULL so realtime UPDATE/DELETE payloads carry every column (the client filters on
-- club_id/status from the payload). F&B order rows contain no secrets, so FULL is safe. Idempotent
-- (no-op if already set). Both publication-existence and each ADD TABLE are guarded via
-- pg_publication_tables so re-running this migration (in any order vs other realtime migrations)
-- cannot error.

-- REPLICA IDENTITY FULL (idempotent no-op if already FULL).
ALTER TABLE public.fnb_orders      REPLICA IDENTITY FULL;
ALTER TABLE public.fnb_order_items REPLICA IDENTITY FULL;

-- Guarded ADD TABLE — mirrors 20260817000001_online_poker_realtime.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'fnb_orders'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fnb_orders';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'fnb_order_items'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.fnb_order_items';
    END IF;

  END IF;
END $$;

-- Verify (run manually after apply):
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename LIKE 'fnb_%';
--   -- EXPECT exactly: fnb_orders, fnb_order_items  (NO fnb_stock_movements / fnb_* others).
--
-- ROLLBACK:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.fnb_order_items;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.fnb_orders;
--   -- (REPLICA IDENTITY FULL may be left as-is; it is harmless when the table is unpublished.)
