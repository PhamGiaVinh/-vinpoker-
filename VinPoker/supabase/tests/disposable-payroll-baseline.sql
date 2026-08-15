-- Disposable-only normalization for the pre-v2 activation-gap fixture.
--
-- The protected current-schema dump may already contain the historical global
-- PT writer even when the migration ledger does not record that application.
-- Remove that writer inside the disposable container so the activation-gap
-- test can exercise the 00001 -> v2 boundary. This file is never sent to a
-- Supabase project and never runs against production.

\set ON_ERROR_STOP on

begin;

drop function if exists public.set_all_approved_dealer_pt_wage_accrual(boolean, text);

commit;
