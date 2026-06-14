-- 01_setup_disposable_table.sql  — PHASE D ONLY (run via the Management-API keyring helper).
-- Creates one DISPOSABLE play-money table (club_id NULL = global lobby; no real club).
-- Returns the new id → put it in scripts/.env.ge2-drill.local as TABLE_ID.
-- Tag name 'GE2-DRILL-DISPOSABLE' is what 02/03/04/99 key off, so leave it.

INSERT INTO public.online_poker_tables
  (name, club_id, max_seats, sb, bb, min_buyin, max_buyin, starting_stack_default, act_timeout_secs, status)
VALUES
  ('GE2-DRILL-DISPOSABLE', NULL, 6, 25, 50, 1000, 100000, 10000, 30, 'open')
RETURNING id, name, status;
