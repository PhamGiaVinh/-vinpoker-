-- Floor production canary cleanup support only.
-- Must be executed as a standalone statement outside BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_dealer_rotation_schedule_table_id
ON public.dealer_rotation_schedule (table_id);

-- ROLLBACK (owner-gated, never automatic):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_dealer_rotation_schedule_table_id;
