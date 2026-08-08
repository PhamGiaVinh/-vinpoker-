-- Forward-only schema repair for Tracker hand identity snapshots.
--
-- A controlled partial rollout installed start_hand definitions that write
-- hand_players.player_name/avatar_url before either historical snapshot
-- migration reached the active database. PostgreSQL accepts the PL/pgSQL
-- definition and fails only when the function first executes.
--
-- Keep this repair deliberately narrow: the live function bodies, ownership,
-- grants, security mode, search_path, and existing rows remain untouched.
-- The nullable columns are inert for historical rows and idempotent on a
-- fully replayed schema where they already exist.
--
-- Rollback: leave the nullable columns in place. Removing them would recreate
-- the runtime failure for any installed function that references them.

ALTER TABLE public.hand_players
  ADD COLUMN IF NOT EXISTS player_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text;
