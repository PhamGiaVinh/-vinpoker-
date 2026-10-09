-- Isolated schema doubles for acquisition fences; no attendance/payroll/history data.
CREATE SCHEMA auth;
CREATE SCHEMA floor_private;
CREATE TABLE floor_private.dealer_initial_assign_receipts(request_key text PRIMARY KEY,payload jsonb,result jsonb,created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.club_dealer_controls(user_id uuid,club_id uuid);
CREATE FUNCTION public.is_club_dealer_control(_user_id uuid,_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE user_id=$1 AND club_id=$2)
    OR EXISTS(SELECT 1 FROM public.clubs WHERE id=$2 AND owner_id=$1) $$;
CREATE TABLE public.club_settings(club_id uuid PRIMARY KEY,auto_swing_enabled boolean);
CREATE TABLE public.game_tables(id uuid PRIMARY KEY,club_id uuid);
CREATE TABLE public.dealers(id uuid PRIMARY KEY,club_id uuid);
CREATE TABLE public.dealer_assignments(id uuid PRIMARY KEY,club_id uuid,table_id uuid,table_session_id uuid,
  attendance_id uuid,dealer_id uuid,status text,released_at timestamptz,pre_assigned_attendance_id uuid,planned_relief_at timestamptz);
CREATE TABLE public.dealer_attendance(id uuid PRIMARY KEY,dealer_id uuid,current_state text,pre_assigned_table_id uuid);
CREATE TABLE public.dealer_rotation_schedule(id uuid PRIMARY KEY,club_id uuid,table_id uuid,status text,
  in_attendance_id uuid,planned_relief_at timestamptz);
INSERT INTO public.clubs VALUES('22000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002');
INSERT INTO public.club_settings VALUES('22000000-0000-4000-8000-000000000001',false);
INSERT INTO public.game_tables VALUES('22000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000001');
INSERT INTO public.dealers VALUES('22000000-0000-4000-8000-000000000004','22000000-0000-4000-8000-000000000001');
INSERT INTO public.dealer_attendance VALUES('22000000-0000-4000-8000-000000000005','22000000-0000-4000-8000-000000000004','available',NULL);
