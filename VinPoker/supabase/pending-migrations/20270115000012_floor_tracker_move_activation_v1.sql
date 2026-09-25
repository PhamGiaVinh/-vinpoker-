-- Floor/Tracker V3 activation. Promote only after 00006-00010 are live,
-- tournament-live-update V3 is deployed, and the protected release gate passes.
-- Rollback: revoke EXECUTE from authenticated; do not delete pending moves.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'floor_queue_tracker_move_v1 missing; apply Floor V3 chain first';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)
  TO authenticated;

COMMIT;
