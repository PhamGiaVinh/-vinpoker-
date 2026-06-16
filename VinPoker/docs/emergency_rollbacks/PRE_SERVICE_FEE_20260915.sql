-- ROLLBACK for the tournament SERVICE FEE feature (migrations 20260915000000 + 20260916000000).
-- Run in a controlled op (Management API), NOT via supabase db push. Order: RPC first, then column.

-- 1) Restore the finance RPC to its pre-service-fee body (20260905000000). Re-run that migration's
--    CREATE OR REPLACE verbatim. After this, get_club_finance_summary no longer returns serviceFee
--    and rakeActual reverts to (total_pay - buy_in). The useClubFinanceSummary hook treats missing
--    fields as 0, so the frontend is safe with the old body.
--    (Source: supabase/migrations/20260905000000_finance_summary_rake_accuracy.sql)

-- 2) Drop the column (new + unreferenced once the RPC is rolled back and the flag is off):
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS service_fee_amount;

-- 3) Frontend kill-switch (no DB): set FEATURES.tournamentServiceFee = false to hide all UI immediately.

-- NOTE: dropping the column is only safe after (1) the RPC no longer selects it and (2) the edge fn's
-- guarded select tolerates its absence (it does — absent → service fee 0). No data loss for existing
-- tours: every existing tour had service_fee_amount = 0.
