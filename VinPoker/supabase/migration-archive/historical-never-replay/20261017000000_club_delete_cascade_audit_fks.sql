-- ============================================================================
-- Club delete — cascade the non-financial audit/log/ops FKs
-- ============================================================================
-- Bug: deleting a club fails with
--   'update or delete on table "clubs" violates foreign key constraint
--    "swing_config_audit_club_id_fkey"' (and others).
--
-- Most club_id FKs already ON DELETE CASCADE. A handful were left with the
-- default NO ACTION, so they block a club delete. Of those, FIVE are
-- audit/log/operational and safe to remove with the club; the rest are
-- FINANCIAL (payment_records, dealer_payroll, payroll_periods, staking_deals,
-- club_wallets) and are INTENTIONALLY left NO ACTION / RESTRICT so deleting a
-- club can never silently wipe money history — a club holding financial rows
-- still (correctly) refuses to delete.
--
-- This migration switches only the 5 safe FKs to ON DELETE CASCADE. No data is
-- moved; only the delete behavior changes.
--
-- ROLLBACK: re-add each constraint without ON DELETE CASCADE (back to NO ACTION).
-- Controlled apply only (BEGIN..COMMIT). NO supabase db push / deploy_db /
-- schema_migrations write.
-- ============================================================================

ALTER TABLE public.swing_config_audit
  DROP CONSTRAINT swing_config_audit_club_id_fkey,
  ADD  CONSTRAINT swing_config_audit_club_id_fkey
       FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

ALTER TABLE public.audit_logs
  DROP CONSTRAINT audit_logs_club_id_fkey,
  ADD  CONSTRAINT audit_logs_club_id_fkey
       FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

ALTER TABLE public.dealer_assignment_corrections
  DROP CONSTRAINT dealer_assignment_corrections_club_id_fkey,
  ADD  CONSTRAINT dealer_assignment_corrections_club_id_fkey
       FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

ALTER TABLE public.diagnostic_logs
  DROP CONSTRAINT diagnostic_logs_club_id_fkey,
  ADD  CONSTRAINT diagnostic_logs_club_id_fkey
       FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;

ALTER TABLE public.online_poker_tables
  DROP CONSTRAINT online_poker_tables_club_id_fkey,
  ADD  CONSTRAINT online_poker_tables_club_id_fkey
       FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;
