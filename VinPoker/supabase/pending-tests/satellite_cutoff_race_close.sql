\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL deadlock_timeout='500ms';
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id=:'tour'::uuid;
SELECT pg_sleep(2);
COMMIT;
