BEGIN;

-- =============================================================================
-- Migration: Add missing columns to tournaments table
--
-- Frontend expects buy_in, starting_stack, rake_amount, game_type, location,
-- start_time, late_reg_close_level, minutes_per_level, free_rake_*,
-- current_players, live_status, deleted_at — all missing from schema.
-- =============================================================================

-- Columns already applied via supabase_apply_migration; this file is for
-- local migration tracking only.

COMMIT;