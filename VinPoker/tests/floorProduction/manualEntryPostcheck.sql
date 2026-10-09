-- Read-only migration36 postcheck; run ledger and objects separately if the
-- client returns only the last statement. Every expected boolean must be true.
SELECT version,name FROM supabase_migrations.schema_migrations
WHERE version='20270128000036';
SELECT p.oid::regprocedure::text AS signature,
 md5(replace(p.prosrc,chr(13),''))=expected.digest AS body_matches,
 pg_get_userbyid(p.proowner)='postgres' AS owner_matches,
 p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AS settings_match,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_allowed,
 NOT has_function_privilege('anon',p.oid,'EXECUTE') AS anon_denied,
 NOT has_function_privilege('service_role',p.oid,'EXECUTE') AS service_denied
FROM (VALUES
 ('public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)','d7aa29ca2c6b01f3aa3d03b28ce6930b'),
 ('public.floor_free_sit_player_v1(uuid,bigint,bigint,integer,uuid,text)','1951430bc0b8d0ff57d087a28b6a25dd'),
 ('public.get_floor_seatable_entries(uuid)','b9ca01c5183bf6cd93f7519d7e970011')
) expected(signature,digest)
JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature);
