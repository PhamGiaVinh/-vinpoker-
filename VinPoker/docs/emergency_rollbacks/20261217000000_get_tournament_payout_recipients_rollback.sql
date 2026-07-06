-- Emergency rollback for 20261217000000_get_tournament_payout_recipients.sql
-- Read-only RPC, additive — dropping it only hides the B2 cashier payout list (the
-- write RPC + ledger from 20261216000000 are untouched). Run in a controlled session.
DROP FUNCTION IF EXISTS public.get_tournament_payout_recipients(uuid);
