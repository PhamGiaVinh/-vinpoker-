-- 20261002000000_op_auto_close_empty_table.sql
-- Online poker friends-practice: auto-close a table the instant it becomes EMPTY.
--
-- When the last seated player leaves (op_leave_open_table) OR is reaped
-- (op_reap_stale_seats) — or via any future teardown path — the seat's user_id is
-- set to NULL. This trigger fires ONLY on that real vacate and, if no seat at the
-- table still holds a user, closes the table (status='closed'). The lobby already
-- hides closed tables (listTablesLive .neq('status','closed')) and isTableLive
-- gates the client, so a closed empty table simply disappears.
--
-- Design (owner-reviewed, race-safe):
--   * Fires AFTER UPDATE OF user_id, WHEN (OLD.user_id IS NOT NULL AND NEW.user_id
--     IS NULL) — only a genuine vacate, never on table create (INSERT) or stack
--     updates, never on a NULL->NULL no-op.
--   * "Empty" = NO seat with user_id IS NOT NULL (status-agnostic: any seat still
--     holding a user means the table is NOT empty — do not rely on the status enum).
--   * The emptiness re-check lives INSIDE the UPDATE's WHERE (single statement) so a
--     concurrent sit-down cannot race a close in between a separate IF/UPDATE.
--   * Only closes a table that is currently 'open' (idempotent; closing a non-open
--     table is a no-op).
--   * SECURITY DEFINER + locked search_path; EXECUTE revoked from PUBLIC/anon/
--     authenticated (it is only ever invoked by the trigger, never called directly).
--
-- Does NOT retro-close already-empty tables created before this trigger — that is a
-- separate, owner-gated controlled cleanup (UPDATE ... RETURNING id), never bundled
-- into this migration.
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS + CREATE TRIGGER) so a
-- future re-apply is safe.
-- Rollback:
--   DROP TRIGGER trg_op_close_empty ON public.online_poker_seats;
--   DROP FUNCTION public.op_close_table_if_empty();

CREATE OR REPLACE FUNCTION public.op_close_table_if_empty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.online_poker_tables t
  SET status = 'closed'
  WHERE t.id = NEW.table_id
    AND t.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM public.online_poker_seats s
      WHERE s.table_id = t.id AND s.user_id IS NOT NULL
    );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.op_close_table_if_empty() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_op_close_empty ON public.online_poker_seats;

CREATE TRIGGER trg_op_close_empty
AFTER UPDATE OF user_id ON public.online_poker_seats
FOR EACH ROW
WHEN (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
EXECUTE FUNCTION public.op_close_table_if_empty();
