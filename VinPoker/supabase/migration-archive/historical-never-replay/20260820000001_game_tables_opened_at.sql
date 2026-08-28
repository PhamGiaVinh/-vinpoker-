-- ============================================================================
-- game_tables.opened_at — open-into-shift timestamp for the Open Table 6-minute
-- dealer grace window (Open Table Flow, frontend follow-up).
--
-- WHY: game_tables.created_at is the pool-table's original creation time (often
-- days old; "+ Thêm bàn" only UPDATEs shift_id/status on an existing pool row),
-- so it cannot drive a "table opened < 6 min ago" grace countdown. This adds a
-- dedicated, nullable, additive timestamp. No backfill, no default, no behavior
-- change — every existing read/write ignores it.
--
-- SOURCE-ONLY: NOT applied. No code reads or writes opened_at yet. The grace
-- follow-up (set opened_at = now() on table open + "Mở bàn sau M:SS" countdown
-- + reset semantics) ships in a separate PR AFTER this is applied live in a
-- controlled, owner-gated session. See docs/agent-handoffs/open-table-grace.md.
--
-- Rollback: ALTER TABLE public.game_tables DROP COLUMN IF EXISTS opened_at;
-- ============================================================================

ALTER TABLE public.game_tables
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;

COMMENT ON COLUMN public.game_tables.opened_at IS
  'When the table was opened into its current shift (drives the 6-minute dealer-grace countdown). NULL until the Open Table grace follow-up wires it. See docs/agent-handoffs/open-table-grace.md.';
