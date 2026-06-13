-- ============================================================================
-- ROLLBACK — GE-2C online-poker runtime RPCs (migration 20260820000000)
-- ============================================================================
-- Purpose : cleanly remove everything the GE-2C runtime migration created, IF a
--           rollback is ever needed before the runtime is enabled.
-- Scope   : ONLY the GE-2C objects (the feature flag table + the 9 op_* RPCs).
--           Does NOT touch the GE-2B online_poker_* DATA tables — those have their
--           own earlier rollback recorded in the GE-2B schema_migrations rows.
-- Safety  : fully idempotent (DROP … IF EXISTS); safe to run twice. Wrapped in a
--           single transaction so a partial failure leaves nothing half-removed.
-- Precond : intended to run while online_poker_config.enabled = false (dark). If
--           the runtime was enabled and hands are in flight, DO NOT roll back —
--           disable the flag first (UPDATE online_poker_config SET enabled=false)
--           and let active hands drain; the op_* RPCs are the only writers.
-- Apply   : controlled session only, via the Management API query endpoint with
--           the CLI-keyring token (same channel as the GE-2C apply). NOT db push.
-- ============================================================================

BEGIN;

-- 1) Drop the RPCs in reverse dependency order. Signatures must match exactly
--    (Postgres identifies a function by name + argument types).
DROP FUNCTION IF EXISTS public.op_claim_daily_chips();
DROP FUNCTION IF EXISTS public.op_stand_up(uuid, text);
DROP FUNCTION IF EXISTS public.op_sit_down(uuid, int, bigint, text);
DROP FUNCTION IF EXISTS public.op_get_my_hole_cards(uuid);
DROP FUNCTION IF EXISTS public.op_timeout_sweep();
DROP FUNCTION IF EXISTS public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text);
DROP FUNCTION IF EXISTS public.op_start_hand(jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.op_load_action_context(uuid);

-- op_is_enabled is dropped last among functions: every other op_* depended on it,
-- but they are already gone by here.
DROP FUNCTION IF EXISTS public.op_is_enabled();

-- 2) Drop the feature-flag table. Its trigger (trg_online_poker_config_updated_at)
--    and policies (op_config_select / op_config_admin_write) are removed with it.
--    No other object references this table, so no CASCADE is required; we keep the
--    plain DROP so an unexpected dependency would surface as an error rather than a
--    silent cascade.
DROP TABLE IF EXISTS public.online_poker_config;

COMMIT;

-- 3) Remove the migration version row (run AFTER the COMMIT above succeeds).
--    Kept outside the transaction so the object teardown is recorded even if the
--    bookkeeping row is managed separately.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260820000000';

-- ============================================================================
-- POST-ROLLBACK VERIFICATION (expect all empty / absent)
-- ============================================================================
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname LIKE 'op\_%';                 -- 0 rows
-- SELECT to_regclass('public.online_poker_config');                   -- NULL
-- SELECT version FROM supabase_migrations.schema_migrations
-- WHERE version = '20260820000000';                                   -- 0 rows
--
-- The GE-2B data tables (online_poker_tables/seats/hands/hand_seats/hand_events/
-- actions/hand_secrets/hand_snapshots/chip_ledger/player_accounts) remain intact —
-- this rollback never touches them.
-- ============================================================================
