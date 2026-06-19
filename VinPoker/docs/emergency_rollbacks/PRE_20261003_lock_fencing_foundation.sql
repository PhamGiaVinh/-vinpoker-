-- EMERGENCY ROLLBACK — B2.2a lock-fencing foundation (migration 20261003000000)
--
-- B2.2a is PURELY ADDITIVE: it adds 3 columns + 3 new-named functions and does NOT modify
-- any existing object. The legacy try_acquire_club_lock(uuid,integer), release_club_lock(uuid),
-- and cleanup_expired_club_locks() are byte-untouched — so there is NOTHING to "restore".
--
-- Rollback = drop the new objects. Safe to run only BEFORE B2.2b wires process-swing to the
-- tokened functions (after B2.2b, process-swing depends on them — roll back B2.2b first).
--
-- Pre-apply state (for verification): the 3 columns and 3 functions below do NOT exist yet.

DROP FUNCTION IF EXISTS public.try_acquire_club_lock_fenced(uuid, integer, text);
DROP FUNCTION IF EXISTS public.extend_club_lock_lease(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.release_club_lock_if_owner(uuid, uuid);

ALTER TABLE public.club_processing_locks DROP COLUMN IF EXISTS lock_token;
ALTER TABLE public.club_processing_locks DROP COLUMN IF EXISTS owner_id;
ALTER TABLE public.club_processing_locks DROP COLUMN IF EXISTS last_heartbeat_at;

-- Legacy functions/columns are unchanged by 20261003000000; no re-CREATE needed.
