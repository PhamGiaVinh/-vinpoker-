-- Emergency rollback for 20261216000000_accounting_payout_liability.sql
-- Additive migration → rollback = drop the two functions + the ledger table.
-- The table is append-only and read-only-consumed; leaving it in place is harmless,
-- so a rollback is only needed if you must fully revert. Run in a controlled session.
DROP FUNCTION IF EXISTS public.record_tournament_prize_payment(uuid, integer, text, text, text);
DROP FUNCTION IF EXISTS public.get_club_payout_liability(timestamptz, timestamptz, uuid);
DROP TABLE IF EXISTS public.tournament_prize_payments;
