\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.cashier_refund_requests
      (club_id,tournament_id,registration_id,amount,reason,requested_by)
    VALUES ('bb000000-0000-4000-8000-000000000001',
            'bc000000-0000-4000-8000-000000000002',
            'be000000-0000-4000-8000-000000000002',
            1200000,'Race refund after Lock',
            'ba000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'refund request crossed concurrent Lock';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_refund_after_lock_requires_adjustment%' THEN RAISE; END IF;
  END;
END $$;
COMMIT;
