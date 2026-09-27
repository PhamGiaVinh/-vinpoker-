-- Disposable PG17 schema fixture: only the live-confirmed Chip Ops columns
-- plus the Floor V3/Tracker columns consumed by the forward End Flight seam.
-- This is not an archived migration replay or a live database assertion.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner_id uuid NOT NULL);
CREATE FUNCTION public.is_club_floor(p_actor uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_club_chip_master(p_actor uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_actor='10000000-0000-0000-0000-000000000003'::uuid
   AND p_club='20000000-0000-0000-0000-000000000001'::uuid
$$;
CREATE TABLE public.tournament_events(id uuid PRIMARY KEY,club_id uuid NOT NULL,
  final_tournament_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid NOT NULL,
  event_id uuid,phase text,deleted_at timestamptz);
CREATE TABLE public.tournament_entries(id uuid PRIMARY KEY,tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  player_id uuid NOT NULL,entry_no integer NOT NULL,
  status text NOT NULL DEFAULT 'seated' CHECK(status IN('seated','cancelled','busted')));
CREATE TABLE public.tournament_tables(id uuid PRIMARY KEY,tournament_id uuid NOT NULL,
  table_session_id uuid);
CREATE TABLE public.table_sessions(id uuid PRIMARY KEY,tournament_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0);
CREATE TABLE public.dealers(id uuid PRIMARY KEY,club_id uuid NOT NULL,user_id uuid);
CREATE TABLE public.dealer_attendance(id uuid PRIMARY KEY,dealer_id uuid NOT NULL);
CREATE TABLE public.dealer_assignments(id uuid PRIMARY KEY,table_session_id uuid,
  attendance_id uuid NOT NULL,
  status text NOT NULL,released_at timestamptz,version integer NOT NULL DEFAULT 0);
CREATE TABLE public.tournament_seats(id uuid PRIMARY KEY,tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  player_id uuid NOT NULL,entry_id uuid,entry_number integer NOT NULL,
  tournament_table_id uuid,table_session_id uuid,seat_number integer NOT NULL,
  is_active boolean NOT NULL);
CREATE TABLE public.tournament_hands(id uuid PRIMARY KEY,tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_session_id uuid,hand_number integer NOT NULL,status text,
  source_revision bigint);
CREATE TABLE public.hand_players(id uuid PRIMARY KEY,hand_id uuid NOT NULL);
CREATE TABLE public.hand_actions(id uuid PRIMARY KEY,hand_id uuid NOT NULL);
CREATE TABLE public.tournament_chip_counts(id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,player_id uuid NOT NULL,entry_number integer NOT NULL,
  chip_count bigint NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
-- Exact confirmed live Chip Ops baseline columns and row constraints.
CREATE TABLE public.chip_bag(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,club_id uuid NOT NULL,day_number int NOT NULL,
  player_id uuid NOT NULL,player_name text,table_id uuid,seat_number int,
  bag_code text,stack_value bigint NOT NULL DEFAULT 0,total_value bigint NOT NULL DEFAULT 0,
  sealed boolean NOT NULL DEFAULT false,created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tournament_id,day_number,player_id),CHECK(stack_value>=0),CHECK(total_value>=0));
CREATE UNIQUE INDEX chip_bag_code_unique_fixture ON public.chip_bag(tournament_id,bag_code)
  WHERE bag_code IS NOT NULL;
ALTER TABLE public.chip_bag ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.day_close(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,day_number int NOT NULL,club_id uuid NOT NULL,
  expected_total_value bigint NOT NULL DEFAULT 0,counted_total_value bigint NOT NULL DEFAULT 0,
  variance_by_player jsonb NOT NULL DEFAULT '[]'::jsonb,
  all_zero boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'open'
    CHECK(status IN('open','locked')),
  locked_by uuid,locked_at timestamptz,signed_off boolean NOT NULL DEFAULT false,
  signoff_by uuid,signoff_reason text,signoff_at timestamptz,
  version int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tournament_id,day_number));
ALTER TABLE public.day_close ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.chip_ops_signoff_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL,tournament_id uuid,day_close_id uuid,
  action text NOT NULL CHECK(action IN('lock','signoff','reopen','unseal')),
  actor uuid,created_at timestamptz DEFAULT now(),details jsonb);
ALTER TABLE public.chip_ops_signoff_audit ENABLE ROW LEVEL SECURITY;
