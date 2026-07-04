-- Rollback for 20261215000000_tracker_seat_setup.sql — run in a controlled session if
-- the pre-hand roster setup must be fully removed at the DB level. Idempotent.
-- (Flag `trackerSeatSetup=false` already reverts the UI instantly; this DB rollback is
-- only needed to remove the column/RPC/policy themselves.)

DROP POLICY IF EXISTS "tournament_photos_obj_insert_tracker_seatavatar" ON storage.objects;

DROP FUNCTION IF EXISTS public.set_tracker_table_roster_seat(uuid, uuid, integer, text, integer, uuid, boolean, text, uuid);

-- avatar_url is inert when the flag is off; drop only if you truly want it gone.
ALTER TABLE public.tournament_seats DROP COLUMN IF EXISTS avatar_url;
