-- Rollback for 20261223000000_end_breaks_on_demand.sql
-- Instant kill-switch: the Pass R caller is try/catch, so dropping the function
-- degrades F2 to a per-tick non-fatal warn (pre-F2 behaviour). No data touched.
DROP FUNCTION IF EXISTS public.end_breaks_on_demand(UUID, INT, INT);
NOTIFY pgrst, 'reload schema';
