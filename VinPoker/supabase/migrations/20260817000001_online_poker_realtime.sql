-- ============================================================================
-- 20260817000001_online_poker_realtime.sql
-- Online Poker realtime publication — GE-2 Patch A (separate from the core
-- schema on purpose, to stay isolated from the rest of the realtime config).
-- ADDITIVE + IDEMPOTENT. SOURCE-ONLY: authored, NOT applied here.
--
-- Publishes ONLY the public-state tables that drive the live table view:
--   online_poker_hands, online_poker_hand_seats, online_poker_seats.
-- Does NOT publish online_poker_hand_secrets (deny-all private store) and does
-- NOT publish online_poker_hand_snapshots in Patch A. Both publication-existence
-- and each ADD TABLE are guarded via pg_publication_tables so re-running this
-- migration (or any ordering vs. other realtime migrations) cannot error.
-- ============================================================================

-- REPLICA IDENTITY FULL so realtime UPDATE/DELETE payloads carry all columns.
-- These tables contain NO hidden cards, so FULL is safe. Idempotent (no-op if
-- already set). The tables exist from 20260817000000_online_poker_core.sql.
ALTER TABLE public.online_poker_hands      REPLICA IDENTITY FULL;
ALTER TABLE public.online_poker_hand_seats REPLICA IDENTITY FULL;
ALTER TABLE public.online_poker_seats      REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'online_poker_hands'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.online_poker_hands';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'online_poker_hand_seats'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.online_poker_hand_seats';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'online_poker_seats'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.online_poker_seats';
    END IF;

  END IF;
END $$;
