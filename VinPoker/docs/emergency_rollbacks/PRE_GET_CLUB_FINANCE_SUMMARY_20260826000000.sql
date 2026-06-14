-- Rollback for migration 20260826000000_get_club_finance_summary.sql
-- The RPC is NEW and read-only (zero writes), so rollback = drop the function.
-- Pre-apply state: function get_club_finance_summary(timestamptz,timestamptz,uuid) does NOT exist.
-- Verify before apply:
--   select count(*) from pg_proc where proname = 'get_club_finance_summary';   -- expect 0
-- Rollback (if needed after apply):

drop function if exists public.get_club_finance_summary(timestamptz, timestamptz, uuid);

-- Note: dropping it makes the frontend transparently fall back to client-side aggregation
-- (useClubFinanceSummary.ts tries the RPC first, then falls back) — no UI breakage.
