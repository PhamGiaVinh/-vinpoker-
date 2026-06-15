-- ============================================================================
-- PRE_GE2K_20260909000000_op_run_due_table_ticks_rollback.sql
--
-- ROLLBACK for 20260909000000_op_run_due_table_ticks.sql.
--
-- Both functions are NEW in GE-2K (no prior definition), so the rollback is a plain
-- DROP. Idempotent (IF EXISTS). No data/schema change; the table-runner Edge function and
-- its (future) cron are separate and inert without these functions + the enabled flag.
-- Run only if the GE-2K lister must be removed after a (future, owner-gated) live apply.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.op_run_due_table_ticks(int);
DROP FUNCTION IF EXISTS public.op_table_runner_diag(int);

-- Optional, only if a GE-2K version row was recorded at apply time:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260909000000';

COMMIT;
