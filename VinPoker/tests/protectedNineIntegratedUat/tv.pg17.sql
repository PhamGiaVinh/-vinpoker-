\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'tv_uat_failed: %', message; END IF;
END $$;

SELECT pg_temp.assert_true(
  public.get_tv_display_state_v3('short-token')->>'status' = 'invalid',
  'public reader fails closed for an invalid token');
SELECT pg_temp.assert_true(
  position('FOR SHARE' in pg_get_functiondef('public.get_tv_display_state_v3(text)'::regprocedure)) > 0
  AND position('t.club_id = v_display.club_id' in pg_get_functiondef('public.get_tv_display_state_v3(text)'::regprocedure)) > 0,
  'reader binds assignment and tournament to one club under a shared lock');
SELECT pg_temp.assert_true(
  position('t.event_id IS NOT NULL AND l.event_id = t.event_id' in
    pg_get_functiondef('public.get_tv_tournament_branding_v1(uuid)'::regprocedure)) > 0
  AND position('t.event_id IS NULL AND l.tournament_id = t.id' in
    pg_get_functiondef('public.get_tv_tournament_branding_v1(uuid)'::regprocedure)) > 0,
  'event layouts and tournament layouts are isolated explicitly');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.save_tv_display_config_v1(
      'd2000000-0000-4000-8000-000000000001', NULL,
      'clock', NULL, NULL, NULL);
    RAISE EXCEPTION 'editor unexpectedly accepted without an actor';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%tv_display_unauthorized%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated','public.tv_displays','UPDATE'),
  'editor cannot bypass the guarded writer');
SELECT 'TV_PUBLIC_READER_EDITOR_EVENT_ISOLATION_PG17_PASS' AS result;
