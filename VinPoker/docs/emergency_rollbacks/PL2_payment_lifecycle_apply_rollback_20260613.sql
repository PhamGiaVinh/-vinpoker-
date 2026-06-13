-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for PL-PR2 controlled live apply of
--   supabase/migrations/20260819000005_payroll_payment_lifecycle_pl1.sql
-- Target: linked project orlesggcjamwuknxwcpk. Apply this ONLY to undo PL1.
--
-- Pre-apply live state (captured 2026-06-13, read-only):
--   chk_payroll_status = CHECK (status IN ('draft','submitted','approved','locked','rejected'))
--   payment_records: absent · prepare/mark/reconcile RPCs: absent
--   save_payroll_period md5 = 65d547ebf96c6fac93f7cb9d2d093d81 (B7, migration 20260819000003)
--   schema_migrations: 20260819000005 NOT present (controlled apply does not touch it)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.prepare_payroll_payment(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mark_payroll_paid(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.reconcile_payroll_payment(UUID, UUID, TEXT, TEXT);

-- Only safe while NO payroll_periods row uses a payment-lifecycle status.
-- If any do, first move them back to 'locked' (or resolve manually) before this.
DROP TABLE IF EXISTS public.payment_records;

ALTER TABLE public.payroll_periods DROP CONSTRAINT IF EXISTS chk_payroll_status;
ALTER TABLE public.payroll_periods
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft','submitted','approved','locked','rejected'));

-- New nullable lifecycle columns are additive — leave them (harmless) OR drop if all NULL:
-- ALTER TABLE public.payroll_periods
--   DROP COLUMN IF EXISTS payment_prepared_by, DROP COLUMN IF EXISTS payment_prepared_at,
--   DROP COLUMN IF EXISTS paid_by, DROP COLUMN IF EXISTS paid_at,
--   DROP COLUMN IF EXISTS reconciled_by, DROP COLUMN IF EXISTS reconciled_at;

-- Restore save_payroll_period to the B7 canonical body (md5 65d547eb…) by re-running:
--   supabase/migrations/20260819000003_payroll_b7_server_recompute_on_save.sql
-- (the CREATE OR REPLACE FUNCTION block in that file). The PL1 version only changed
-- the re-save guard one line; re-applying B7 reverts it.

COMMIT;
