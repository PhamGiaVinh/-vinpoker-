-- Rollback for the floor-role schema (20261025000000 + 20261025000001).
-- NOTE: a Postgres enum value cannot be dropped — 'floor' stays in app_role
-- harmlessly (no rows reference it after club_floors + user_roles cleanup).
DROP FUNCTION IF EXISTS public.is_club_floor(uuid, uuid);
DROP FUNCTION IF EXISTS public.floor_club_ids(uuid);
DROP TABLE IF EXISTS public.club_floors;
DELETE FROM public.user_roles WHERE role = 'floor';
