\set ON_ERROR_STOP on
-- ONLY a new disposable PostgreSQL 17 database; no production connection.
DO $$ BEGIN
  IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
     OR current_database() <> 'wave3_timeline_disposable_1234'
  THEN RAISE EXCEPTION 'Requires named disposable PG17 database'; END IF;
END $$;

CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TYPE public.app_role AS ENUM ('super_admin', 'owner');
CREATE TABLE public.test_roles (user_id uuid, role public.app_role);
CREATE TABLE public.clubs (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
CREATE TABLE public.tournaments (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id), name text NOT NULL, deleted_at timestamptz, guarantee_amount numeric);
CREATE TABLE public.tournament_entries (id uuid PRIMARY KEY, tournament_id uuid NOT NULL REFERENCES public.tournaments(id), player_id uuid NOT NULL, status text NOT NULL DEFAULT 'seated', seated_at timestamptz, busted_at timestamptz);
CREATE TABLE public.tournament_registrations (id uuid PRIMARY KEY, tournament_id uuid NOT NULL REFERENCES public.tournaments(id), status text NOT NULL, confirmed_at timestamptz, buy_in bigint NOT NULL);
CREATE TABLE public.game_tables (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id));
CREATE TABLE public.table_sessions (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id), game_table_id uuid NOT NULL REFERENCES public.game_tables(id), session_type text NOT NULL, tournament_id uuid, opened_at timestamptz NOT NULL, closed_at timestamptz);
CREATE TABLE public.tournament_tables (id uuid PRIMARY KEY, tournament_id uuid NOT NULL REFERENCES public.tournaments(id), table_session_id uuid, max_seats integer);
CREATE TABLE public.dealer_assignments (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id), table_id uuid NOT NULL REFERENCES public.game_tables(id), table_session_id uuid, assigned_at timestamptz NOT NULL, released_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM public.test_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION public.is_club_owner(_user_id uuid, _club_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.has_role(_user_id, 'super_admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.clubs WHERE id=_club_id AND owner_id=_user_id) $$;

INSERT INTO public.clubs VALUES
 ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111'),
 ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');
INSERT INTO public.test_roles VALUES ('99999999-9999-9999-9999-999999999999','super_admin');
INSERT INTO public.tournaments VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Exact',null,1000),
 ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Partial capacity',null,0),
 ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','Partial dealer',null,null),
 ('aaaaaaaa-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','Partial entry',null,1000),
 ('aaaaaaaa-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','Partial GTD',null,1000),
 ('aaaaaaaa-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222','Temporal handoffs',null,500),
 ('aaaaaaaa-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222','Exact empty',null,0),
 ('aaaaaaaa-0000-0000-0000-000000000008','22222222-2222-2222-2222-222222222222','Partial terminal lifecycle',null,0),
 ('bbbbbbbb-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','Other club',null,500);

-- A/B: two active entries for one player plus a busted prior entry. Count entries, not identities.
INSERT INTO public.tournament_entries (id,tournament_id,player_id,status,seated_at,busted_at) VALUES
 ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','seated','2026-09-14 08:00+00',null),
 ('e0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','seated','2026-09-14 08:10+00',null),
 ('e0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','busted','2026-09-14 08:05+00','2026-09-14 08:20+00'),
 ('e0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000006','busted','2026-09-13 07:00+00','2026-09-13 08:00+00'),
 ('e0000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000007','busted','2026-09-13 08:00+00','2026-09-13 09:00+00'),
 ('e0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000008','50000000-0000-0000-0000-000000000008','finished','2026-09-13 08:00+00',null),
 ('e0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000003','busted',null,null);
INSERT INTO public.game_tables VALUES
 ('60000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222'),
 ('60000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222'),
 ('60000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222'),
 ('60000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222'),
 ('60000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222');
-- C/F: exact table and dealer intervals create a 15-minute observed gap.
INSERT INTO public.table_sessions VALUES
 ('70000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000001','tournament','aaaaaaaa-0000-0000-0000-000000000001','2026-09-14 08:00+00','2026-09-14 09:00+00'),
 ('70000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000002','tournament','aaaaaaaa-0000-0000-0000-000000000002','2026-09-14 08:00+00',null),
 ('70000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000003','tournament','aaaaaaaa-0000-0000-0000-000000000003','2026-09-14 08:00+00',null),
 ('70000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000006','tournament','aaaaaaaa-0000-0000-0000-000000000006','2026-09-13 07:00+00','2026-09-13 08:00+00'),
 ('70000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000007','tournament','aaaaaaaa-0000-0000-0000-000000000006','2026-09-13 08:00+00','2026-09-13 09:00+00');
INSERT INTO public.tournament_tables VALUES
 ('80000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',9),
 ('80000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002',0),
 ('80000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000003',9),
 ('80000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000006',9),
 ('80000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000007',9);
INSERT INTO public.dealer_assignments VALUES
 ('90000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','2026-09-14 08:15+00','2026-09-14 09:00+00'),
 -- E: relevant table assignment exists, but its session identity is missing.
 ('90000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000003',null,'2026-09-14 08:05+00',null),
 -- Same-session overlap and exact handoff remain one covered table session.
 ('90000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000006','2026-09-13 07:00+00','2026-09-13 08:00+00'),
 ('90000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000006','2026-09-13 07:30+00','2026-09-13 08:00+00'),
 ('90000000-0000-0000-0000-000000000008','22222222-2222-2222-2222-222222222222','60000000-0000-0000-0000-000000000007','70000000-0000-0000-0000-000000000007','2026-09-13 08:00+00','2026-09-13 09:00+00');
-- G/H/I: null GTD, zero GTD and actual zero buy-in are all distinct.
INSERT INTO public.tournament_registrations VALUES
 ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','confirmed','2026-09-14 07:00+00',500),
 ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','confirmed','2026-09-14 07:05+00',0),
 ('c0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','pending',null,999),
 ('c0000000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','confirmed','2026-09-14 07:10+00',700),
 ('c0000000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000006','confirmed','2026-09-13 08:00+00',100),
 ('c0000000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000006','confirmed','2026-09-13 08:00+00',200),
 ('c0000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000006','confirmed','2026-09-13 09:00+00',200);
INSERT INTO public.tournament_registrations VALUES
 ('c0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000005','confirmed',null,500);

\ir ../../supabase/migration-archive/historical-never-replay/20261011000000_get_tournament_prize_pool.sql
\ir ../../supabase/pending-migrations/20260914120000_ops_intelligence_timeline_v1.sql
\ir ../../supabase/pending-migrations/20260914120000_ops_intelligence_timeline_v1.sql

DO $$ BEGIN
  IF has_function_privilege('anon','public.get_ops_intelligence_timeline_v1(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon execute'; END IF;
  IF NOT has_function_privilege('authenticated','public.get_ops_intelligence_timeline_v1(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'missing authenticated execute'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname='get_ops_intelligence_timeline_v1') <> 1 THEN RAISE EXCEPTION 'overload'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.get_ops_intelligence_timeline_v1(uuid,uuid)'::regprocedure
      AND p.prosecdef AND p.provolatile = 's'
      AND p.proconfig = ARRAY['search_path=""']
  ) THEN RAISE EXCEPTION 'security posture'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$ DECLARE v jsonb; BEGIN
  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001');
  IF v#>>'{entries,points,3,value}' <> '2' THEN RAISE EXCEPTION 'active entry interval/count'; END IF;
  IF v#>>'{tables,capacityAvailability}' <> 'exact' OR v#>>'{tables,points,0,seatCapacity}' <> '9' THEN RAISE EXCEPTION 'table capacity'; END IF;
  IF jsonb_array_length(v->'dealerGaps') = 0 OR v#>>'{dealerGaps,0,maxGap}' <> '1' THEN RAISE EXCEPTION 'dealer gap'; END IF;
  IF v#>>'{gtd,guaranteeState}' <> 'available' OR v#>>'{gtd,points,1,value}' <> '500' OR v#>>'{gtd,points,2,value}' <> '1200' THEN RAISE EXCEPTION 'gtd zero buy-in/surplus'; END IF;
  IF v::text ~ '(50000000|90000000)' THEN RAISE EXCEPTION 'identity leak'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000002');
  IF v#>>'{tables,capacityAvailability}' <> 'partial' OR v#>'{tables,points,0,seatCapacity}' <> 'null'::jsonb OR v#>>'{gtd,guaranteeState}' <> 'no_guarantee' THEN RAISE EXCEPTION 'capacity/no guarantee'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000003');
  IF v#>>'{dealers,availability}' <> 'partial' OR v->'dealerGaps' <> '[]'::jsonb OR v#>>'{gtd,availability}' <> 'unavailable' THEN RAISE EXCEPTION 'partial dealer/null GTD'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000004');
  IF v#>>'{entries,availability}' <> 'partial' OR v#>>'{entries,reasonCode}' <> 'ENTRY_SEATED_AT_MISSING' THEN RAISE EXCEPTION 'partial entry lifecycle'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000005');
  IF v#>>'{gtd,availability}' <> 'partial' OR v#>>'{gtd,reasonCode}' <> 'CONFIRMED_AT_MISSING' THEN RAISE EXCEPTION 'partial GTD timeline'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000006');
  IF (SELECT count(*) FROM jsonb_array_elements(v#>'{entries,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> 1
     OR (SELECT p->>'value' FROM jsonb_array_elements(v#>'{entries,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> '1'
  THEN RAISE EXCEPTION 'same timestamp occupancy handoff'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v#>'{tables,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> 1
     OR (SELECT p->>'value' FROM jsonb_array_elements(v#>'{tables,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> '1'
     OR (SELECT p->>'seatCapacity' FROM jsonb_array_elements(v#>'{tables,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> '9'
  THEN RAISE EXCEPTION 'same timestamp table handoff'; END IF;
  IF (SELECT max((p->>'value')::int) FROM jsonb_array_elements(v#>'{dealers,points}') p) <> 1
     OR (SELECT p->>'value' FROM jsonb_array_elements(v#>'{dealers,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> '1'
  THEN RAISE EXCEPTION 'distinct-session dealer coverage/handoff'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v#>'{gtd,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> 1
     OR (SELECT p->>'value' FROM jsonb_array_elements(v#>'{gtd,points}') p WHERE p->>'at' = '2026-09-13T08:00:00.000Z') <> '300'
  THEN RAISE EXCEPTION 'same timestamp GTD grouping'; END IF;
  IF (v#>>'{gtd,points,1,value}')::numeric <> (SELECT prize_pool FROM public.get_tournament_prize_pool('aaaaaaaa-0000-0000-0000-000000000006'))
  THEN RAISE EXCEPTION 'canonical prize-pool parity'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000007');
  IF v#>>'{entries,availability}' <> 'exact' OR v#>'{entries,points}' <> '[]'::jsonb
     OR v#>>'{tables,availability}' <> 'exact' OR v#>'{tables,points}' <> '[]'::jsonb
     OR v#>>'{dealers,availability}' <> 'exact' OR v#>'{dealers,points}' <> '[]'::jsonb
     OR v#>>'{gtd,availability}' <> 'exact' OR v#>'{gtd,points}' <> '[]'::jsonb
  THEN RAISE EXCEPTION 'exact empty'; END IF;

  v := public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000008');
  IF v#>>'{entries,availability}' <> 'partial' OR v#>>'{entries,reasonCode}' <> 'ENTRY_TERMINAL_AT_MISSING'
  THEN RAISE EXCEPTION 'terminal lifecycle must fail closed'; END IF;

  BEGIN PERFORM public.get_ops_intelligence_timeline_v1('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-000000000001'); RAISE EXCEPTION 'cross club allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000001'); RAISE EXCEPTION 'identity mismatch allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN BEGIN PERFORM public.get_ops_intelligence_timeline_v1('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001'); RAISE EXCEPTION 'anonymous allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',false);
DO $$ BEGIN PERFORM public.get_ops_intelligence_timeline_v1('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-000000000001'); END $$;
RESET ROLE;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT public.get_ops_intelligence_timeline_v1(
  '22222222-2222-2222-2222-222222222222',
  'aaaaaaaa-0000-0000-0000-000000000006'
);
SELECT 'WAVE3_TIMELINE_PG17_PASS' AS verdict;
