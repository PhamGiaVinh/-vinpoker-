-- ============================================================================
-- ROLLBACK — Blind structure save + reusable templates (Phase B)
-- ============================================================================
-- Use only if the controlled apply of the two objects must be reverted.
-- Both are additive; dropping them migrates no data away from existing tables
-- (tournament_levels is untouched by these objects' removal).
--
-- With FEATURES.blindEditorSave = false AND FEATURES.blindTemplates = false, the
-- UI never calls either object — so even left applied they are inert.
-- ============================================================================

-- 1) Reusable templates table (migration 20260920000000)
DROP TABLE IF EXISTS public.blind_structure_templates;

-- 2) Full-replace save RPC (migration 20260825000000)
DROP FUNCTION IF EXISTS public.update_blind_structure(UUID, JSONB);
