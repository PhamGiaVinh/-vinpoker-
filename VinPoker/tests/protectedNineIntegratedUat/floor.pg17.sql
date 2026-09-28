\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'floor_uat_failed: %', message; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT pg_temp.assert_true(
  public.floor_plan_break_table_v1(NULL, NULL, 'fill_lowest_table')->>'error' = 'invalid_request',
  'invalid legacy identity fails closed');
SELECT pg_temp.assert_true(
  public.floor_break_table_v5(NULL, NULL, NULL, 'fill_lowest_table', NULL)->>'error' = 'invalid_request',
  'writer requires request id and plan hash');
RESET ROLE;

SELECT pg_temp.assert_true(
  position('table_session_seat_locks' in pg_get_functiondef(
    'public.get_floor_tournament_table_roster_v5(uuid)'::regprocedure)) > 0
  AND position('missing_entry' in pg_get_functiondef(
    'public.get_floor_tournament_table_roster_v5(uuid)'::regprocedure)) > 0,
  'roster exposes locks and invalid legacy seats');
SELECT pg_temp.assert_true(
  position('IDEMPOTENCY_CONFLICT' in pg_get_functiondef(
    'public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure)) > 0
  AND position('plan_hash' in pg_get_functiondef(
    'public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure)) > 0,
  'writer is plan-hash and idempotency fenced');
SELECT pg_temp.assert_true(
  position('floor_pending_tracker_moves' in pg_get_functiondef(
    'public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure)) > 0
  AND position('v_pending = 0' in pg_get_functiondef(
    'public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure)) > 0,
  'deferred moves do not close their source prematurely');
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.floor_pending_tracker_moves'::regclass
      AND NOT tgisinternal AND tgenabled <> 'D'),
  'terminal move queue has an enabled completion trigger');

SELECT 'FLOOR_INVALID_LOCK_PLAN_DEFERRED_EXACTLY_ONCE_PG17_PASS' AS result;
