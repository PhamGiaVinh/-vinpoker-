-- Read-only postcheck. Every returned passed value must be true.
WITH expected(signature,digest) AS (VALUES
 ('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)','6f12a08bab466d61fcf6d76fd7aa52e9'),
 ('floor_private.floor_apply_tracker_moves_after_hand_v1()','73d2c6346bb1eab8b48bd7040c93d7a9'),
 ('public.floor_break_table_v5(uuid,bigint,uuid,text,text)','137f5844cc1dd4a591ae377002475f2f'),
 ('public.get_floor_tournament_table_roster_v3(uuid)','ee2a56b1803a8aea69d13d5c063adea0'),
 ('public.get_floor_tournament_table_roster_v5(uuid)','eb9f0a1a53ade72c1602fa401fa5a954'),
 ('floor_private.floor_break_plan_rows_v1(uuid,uuid)','07391e6efe45f579232af9a23263f9ff'),
 ('floor_private.tournament_participation_v1(uuid)','b9624adaa8d7bb35713917486c40fe67'),
 ('public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)','8d028d5193919c70d578582b2e9cfa6d'),
 ('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)','1fa4fcae06f56774b40913b83a6b239a'),
 ('floor_private.preserve_tournament_seat_display_v1()','cd6ecd6f6c885f05d90892bad4200b78')
)
SELECT e.signature,
 COALESCE(md5(replace(p.prosrc,E'\r',''))=e.digest
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=""']::text[],false) AS passed
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY e.signature;

SELECT 'private_display_acl' AS check_name,
 NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) roles(name)
 WHERE p.oid IN (
  to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)'),
  to_regprocedure('floor_private.preserve_tournament_seat_display_v1()'))
 AND has_function_privilege(roles.name,p.oid,'EXECUTE')) AS passed;

SELECT 'display_insert_trigger' AS check_name, EXISTS(
 SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_seats'::regclass
  AND tgname='trg_tournament_seat_display_preserve_v1' AND NOT tgisinternal
  AND tgenabled='O' AND tgtype=7
  AND tgfoid=to_regprocedure('floor_private.preserve_tournament_seat_display_v1()')
) AS passed;
