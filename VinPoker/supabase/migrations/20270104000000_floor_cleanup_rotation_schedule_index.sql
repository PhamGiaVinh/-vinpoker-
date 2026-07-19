-- SOURCE PARITY ONLY: this exact index was already created in production by the
-- owner-approved Floor canary run. Keep the statement standalone because
-- CREATE INDEX CONCURRENTLY cannot execute inside BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_dealer_rotation_schedule_table_id
ON public.dealer_rotation_schedule (table_id);

-- ROLLBACK (owner-gated, never automatic):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_dealer_rotation_schedule_table_id;
