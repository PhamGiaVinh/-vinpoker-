\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'tv_uat_failed: %', message; END IF;
END $$;

INSERT INTO auth.users(id) VALUES ('d2000000-0000-4000-8000-000000000010');
INSERT INTO public.clubs(id,owner_id,name,region,tv_brand_name) VALUES
  ('d2000000-0000-4000-8000-000000000011','d2000000-0000-4000-8000-000000000010','TV runtime TEST','TEST','Club fallback TEST');
INSERT INTO public.tournament_events(id,club_id,name,status) VALUES
  ('d2000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000011','TV event TEST','active');
INSERT INTO public.tournaments(id,club_id,event_id,name,status,live_status,current_level) VALUES
  ('d2000000-0000-4000-8000-000000000021','d2000000-0000-4000-8000-000000000011','d2000000-0000-4000-8000-000000000012','Event tournament TEST','active','live',1),
  ('d2000000-0000-4000-8000-000000000022','d2000000-0000-4000-8000-000000000011',NULL,'Standalone tournament TEST','active','live',1);
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes) VALUES
  ('d2000000-0000-4000-8000-000000000021',1,100,200,200,20),
  ('d2000000-0000-4000-8000-000000000022',1,100,200,200,20);
INSERT INTO public.tv_tournament_layouts(
  id,club_id,event_id,tournament_id,brand_name,layout,updated_by
) VALUES
  ('d2000000-0000-4000-8000-000000000031','d2000000-0000-4000-8000-000000000011','d2000000-0000-4000-8000-000000000012',NULL,'Event brand TEST',(SELECT tv_layout_config FROM public.clubs WHERE id='d2000000-0000-4000-8000-000000000011'),'d2000000-0000-4000-8000-000000000010'),
  ('d2000000-0000-4000-8000-000000000032','d2000000-0000-4000-8000-000000000011',NULL,'d2000000-0000-4000-8000-000000000022','Standalone brand TEST',(SELECT tv_layout_config FROM public.clubs WHERE id='d2000000-0000-4000-8000-000000000011'),'d2000000-0000-4000-8000-000000000010');
INSERT INTO public.tv_displays(
  id,club_id,display_number,name,display_token,assigned_tournament_id,status,paired_at
) VALUES (
  'd2000000-0000-4000-8000-000000000041','d2000000-0000-4000-8000-000000000011',1,'TV runtime display TEST',
  'tv-runtime-token-0000000000000000000000000001','d2000000-0000-4000-8000-000000000021','paired',now()
);

SELECT pg_temp.assert_true(
  public.get_tv_display_state_v3('short-token')->>'status' = 'invalid',
  'public reader fails closed for an invalid token');
SELECT public.get_tv_display_state_v3(
  'tv-runtime-token-0000000000000000000000000001'
)::text AS payload \gset event_reader_
SELECT pg_temp.assert_true(
  :'event_reader_payload'::jsonb->>'status' = 'paired'
  AND :'event_reader_payload'::jsonb->'display'->>'club_brand_name' = 'Event brand TEST'
  AND :'event_reader_payload'::jsonb->'tournament'->>'id' = 'd2000000-0000-4000-8000-000000000021',
  'Stage A public reader returns a frontend-compatible event-scoped payload');
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

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000010', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT public.save_tv_display_config_v1(
  'd2000000-0000-4000-8000-000000000041',
  'd2000000-0000-4000-8000-000000000022',
  'announcement','Stage B announcement TEST','Edited display TEST','Main TEST'
)::text AS payload \gset editor_
RESET ROLE;
SELECT public.get_tv_display_state_v3(
  'tv-runtime-token-0000000000000000000000000001'
)::text AS payload \gset tournament_reader_
SELECT pg_temp.assert_true(
  :'editor_payload'::jsonb->>'assigned_tournament_id' = 'd2000000-0000-4000-8000-000000000022'
  AND :'editor_payload'::jsonb->>'layout' = 'announcement'
  AND :'tournament_reader_payload'::jsonb->>'status' = 'paired'
  AND :'tournament_reader_payload'::jsonb->'display'->>'club_brand_name' = 'Standalone brand TEST'
  AND :'tournament_reader_payload'::jsonb->'display'->>'club_brand_name' <> 'Event brand TEST',
  'guarded Stage B editor updates the display and reader isolates tournament branding from the prior event');

SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated','public.tv_displays','UPDATE'),
  'editor cannot bypass the guarded writer');
SELECT 'TV_PUBLIC_READER_EDITOR_EVENT_ISOLATION_PG17_PASS' AS result;
