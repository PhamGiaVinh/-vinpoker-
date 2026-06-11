-- EMERGENCY ROLLBACK — Forward Rotation Scheduler Stage 1 (DB objects).
-- Run via Supabase Management API. Safe at any time while the edge function
-- is still on the legacy path (rotation_planner_enabled = false everywhere):
-- every object below is NEW in 20260813000000..3; no pre-existing object was
-- modified, so dropping them restores the exact pre-wave schema.
--
-- NOTE: dealer_assignments.planned_relief_at is additive and unread by the
-- legacy edge code; dropping it is optional but included for completeness.

BEGIN;

DROP VIEW IF EXISTS public.dealer_my_rotation;

DROP FUNCTION IF EXISTS public.get_rotation_board(UUID);
DROP FUNCTION IF EXISTS public.complete_rotation_slot(UUID, UUID);
DROP FUNCTION IF EXISTS public.upsert_rotation_plan(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.cancel_rotation_slot(UUID, TEXT);
DROP FUNCTION IF EXISTS public.lock_rotation_slot(UUID, INT);

DROP TABLE IF EXISTS public.dealer_rotation_schedule;

ALTER TABLE public.dealer_assignments DROP COLUMN IF EXISTS planned_relief_at;

ALTER TABLE public.swing_config DROP COLUMN IF EXISTS tier_a_min_buyin;
ALTER TABLE public.swing_config DROP COLUMN IF EXISTS tier_b_min_buyin;
-- rotation_planner_enabled is left in place if it pre-existed live; only drop
-- it if you have verified it did not exist before 20260813000003:
-- ALTER TABLE public.swing_config DROP COLUMN IF EXISTS rotation_planner_enabled;

COMMIT;
