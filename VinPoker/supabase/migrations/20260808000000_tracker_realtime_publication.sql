-- 20260808000000_tracker_realtime_publication.sql
-- Milestone A — Live Tracker realtime hotfix.
--
-- WHY: TournamentLiveView (src/components/cashier/tournament-live/TournamentLiveView.tsx)
-- and TournamentLivePanel (src/components/cashier/TournamentLivePanel.tsx) subscribe via
-- supabase postgres_changes to tournament_hands, tournament_chip_counts, tournament_seats
-- (event '*', filter tournament_id=eq.<id>) and hand_players (UPDATE). But only
-- public.tournaments is in the supabase_realtime publication (added in
-- 20260423103624_*.sql). Without publishing these tables, INSERT/UPDATE events never reach
-- the client, so the live viewer cannot update without a manual page refresh. This migration
-- closes that gap.
--
-- REPLICA IDENTITY: intentionally left at DEFAULT (primary key). The subscriptions filter
-- on tournament_id; for INSERT and UPDATE the filter is evaluated against the NEW row, which
-- carries every column (incl. tournament_id), so they work WITHOUT REPLICA IDENTITY FULL.
-- FULL is avoided on purpose to keep WAL overhead low on these high-churn tables. Trade-off:
-- filtered hard-DELETE events are not delivered (the old row carries only the PK, so the
-- tournament_id filter cannot match). Deletes are rare in this tracker (voids use
-- is_voided/status rather than DELETE), so this is acceptable for the MVP. If filtered
-- DELETE delivery is ever required, add REPLICA IDENTITY FULL selectively to the specific
-- table only.
--
-- hand_actions is intentionally NOT published: nothing in src subscribes to it (the viewer
-- refetches actions when a hand row changes), so publishing it would add WAL cost for no
-- realtime benefit.
--
-- RLS is unchanged. tournament_hands / tournament_chip_counts / tournament_seats /
-- hand_players already have "FOR SELECT TO authenticated USING (true)" policies (see
-- 20260608000001_tournament_live_tracker.sql), so realtime — which enforces the subscriber's
-- RLS — delivers events to any logged-in viewer without any policy change. anon is not
-- granted SELECT, so a public/anon spectator cannot read these raw tables; that is by design
-- and is handled later via a sanitized RPC, not by loosening RLS here.
--
-- IDEMPOTENT: each ADD TABLE is wrapped so re-running is safe even if the live DB (which has
-- drifted from migrations) already added some of these tables to the publication.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_hands;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_chip_counts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_seats;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.hand_players;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
