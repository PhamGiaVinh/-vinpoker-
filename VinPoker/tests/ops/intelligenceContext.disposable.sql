\set ON_ERROR_STOP on
-- ONLY a new disposable PostgreSQL 17 database; no production connection.
DO $$ BEGIN
  IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
     OR current_database() <> 'wave2_context_disposable'
  THEN RAISE EXCEPTION 'Requires named disposable PG17 database'; END IF;
END $$;
CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TYPE public.app_role AS ENUM ('super_admin', 'owner', 'floor');
CREATE TABLE public.test_roles (user_id uuid, role public.app_role);
CREATE TABLE public.clubs (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
CREATE TABLE public.tournament_events (id uuid PRIMARY KEY, club_id uuid REFERENCES public.clubs(id), name text NOT NULL, status text, final_tournament_id uuid);
CREATE TABLE public.tournaments (id uuid PRIMARY KEY, club_id uuid REFERENCES public.clubs(id), name text NOT NULL, status text, start_time timestamptz, buy_in bigint, guarantee_amount numeric, deleted_at timestamptz, event_id uuid REFERENCES public.tournament_events(id), phase text, flight_label text);
ALTER TABLE public.tournament_events ADD FOREIGN KEY (final_tournament_id) REFERENCES public.tournaments(id);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM public.test_roles WHERE user_id=_user_id AND role=_role) $$;
-- Matches inspected production helper semantics, including super_admin.
CREATE FUNCTION public.is_club_owner(_user_id uuid, _club_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.has_role(_user_id, 'super_admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=_club_id AND c.owner_id=_user_id) $$;
INSERT INTO public.clubs VALUES
 ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111'),
 ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'),
 ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111');
INSERT INTO public.test_roles VALUES ('99999999-9999-9999-9999-999999999999','super_admin');
INSERT INTO public.tournament_events VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','Festival fixture','scheduled',null),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','Missing final fixture','scheduled',null);
INSERT INTO public.tournaments (id,club_id,name,status,start_time,buy_in,guarantee_amount,event_id,phase,flight_label) VALUES
 ('00000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Daily fixture','scheduled',now(),0,null,null,null,null),
 ('00000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Flight A fixture','scheduled',now(),100,200,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','flight','A'),
 ('00000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','Flight B fixture','scheduled',now(),100,200,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','flight','B'),
 ('00000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','Final fixture','scheduled',now(),100,200,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','final',null),
 ('00000000-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','Unknown role fixture','scheduled',null,null,null,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',null,null),
 ('00000000-0000-0000-0000-000000000006','33333333-3333-3333-3333-333333333333','Malicious cross-club child','scheduled',now(),100,200,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','flight','X');
UPDATE public.tournament_events SET final_tournament_id='00000000-0000-0000-0000-000000000004' WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
\ir ../../supabase/pending-migrations/20260910152624_ops_intelligence_context_v1.sql
-- Reapplication must not broaden ACL or change behavior.
\ir ../../supabase/pending-migrations/20260910152624_ops_intelligence_context_v1.sql
DO $$ BEGIN
  IF has_function_privilege('anon','public.get_ops_intelligence_context_v1(uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon execute'; END IF;
  IF NOT has_function_privilege('authenticated','public.get_ops_intelligence_context_v1(uuid)','EXECUTE') THEN RAISE EXCEPTION 'missing auth execute'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname='get_ops_intelligence_context_v1') <> 1 THEN RAISE EXCEPTION 'overload'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$ DECLARE v jsonb; f jsonb; BEGIN
  v := public.get_ops_intelligence_context_v1('22222222-2222-2222-2222-222222222222');
  IF jsonb_array_length(v->'dailyTournaments')<>1 OR jsonb_array_length(v->'festivals')<>2 THEN RAISE EXCEPTION 'classification'; END IF;
  IF v#>'{dailyTournaments,0,gtd}' <> 'null'::jsonb OR v#>'{dailyTournaments,0,buyIn}' <> '0'::jsonb THEN RAISE EXCEPTION 'null zero'; END IF;
  SELECT value INTO f FROM jsonb_array_elements(v->'festivals') WHERE value->>'festivalId'='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF jsonb_array_length(f->'tournaments')<>3 OR f->>'finalTournamentId'<>'00000000-0000-0000-0000-000000000004' THEN RAISE EXCEPTION 'hierarchy'; END IF;
  IF v::text LIKE '%Malicious%' OR v::text LIKE '%000000000006%' THEN RAISE EXCEPTION 'cross-club leak'; END IF;
  SELECT value INTO f FROM jsonb_array_elements(v->'festivals') WHERE value->>'festivalId'='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF f->'finalTournamentId'<>'null'::jsonb OR f#>'{tournaments,0,phase}'<>'null'::jsonb OR f#>'{tournaments,0,startTime}'<>'null'::jsonb THEN RAISE EXCEPTION 'invented fields'; END IF;
  v := public.get_ops_intelligence_context_v1('55555555-5555-5555-5555-555555555555');
  IF v->'dailyTournaments'<>'[]'::jsonb OR v->'festivals'<>'[]'::jsonb THEN RAISE EXCEPTION 'empty'; END IF;
  BEGIN PERFORM public.get_ops_intelligence_context_v1('33333333-3333-3333-3333-333333333333'); RAISE EXCEPTION 'cross club allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_ops_intelligence_context_v1(NULL); RAISE EXCEPTION 'null allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN BEGIN PERFORM public.get_ops_intelligence_context_v1('22222222-2222-2222-2222-222222222222'); RAISE EXCEPTION 'anonymous allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',false);
DO $$ BEGIN BEGIN PERFORM public.get_ops_intelligence_context_v1('22222222-2222-2222-2222-222222222222'); RAISE EXCEPTION 'non owner allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',false);
DO $$ BEGIN
  PERFORM public.get_ops_intelligence_context_v1('33333333-3333-3333-3333-333333333333');
  BEGIN PERFORM public.get_ops_intelligence_context_v1('88888888-8888-8888-8888-888888888888'); RAISE EXCEPTION 'unknown club allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'WAVE2_CONTEXT_PG17_PASS' AS verdict;
