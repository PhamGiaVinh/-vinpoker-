-- ============================================================================
-- ROLLBACK for 20260818000001_tv_displays_pairing.sql
-- ============================================================================
-- The migration is purely additive (1 new table + 4 new functions + RLS on
-- the new table only). Nothing existing is altered, so rollback = drop the
-- new objects. Safe to run at any time; loses only TV pairing rows.
--
-- Pre-apply state (verified in source, 2026-06-13):
--   * public.tv_displays does NOT exist
--   * functions tv_pair_begin / tv_claim_display / get_tv_display_state /
--     tv_revoke_display do NOT exist (no overloads anywhere in migrations)
--   * supabase_realtime publication: NOT touched by this migration
--   * schema_migrations: only the single new version row after apply
-- ============================================================================

DROP FUNCTION IF EXISTS public.tv_revoke_display(UUID);
DROP FUNCTION IF EXISTS public.get_tv_display_state(TEXT);
DROP FUNCTION IF EXISTS public.tv_claim_display(TEXT, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.tv_pair_begin();
DROP TABLE IF EXISTS public.tv_displays;

-- If the migration row must also be removed after a rollback (only in a
-- dedicated, owner-approved reconciliation session):
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260818000001';
