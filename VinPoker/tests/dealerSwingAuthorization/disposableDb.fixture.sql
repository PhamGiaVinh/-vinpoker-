CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TABLE public.clubs (id uuid PRIMARY KEY);
CREATE TABLE public.game_tables (id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id));
CREATE TABLE public.table_sessions (
  id uuid PRIMARY KEY,
  game_table_id uuid NOT NULL REFERENCES public.game_tables(id),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  closed_at timestamptz
);
CREATE TABLE public.dealers (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  status text NOT NULL DEFAULT 'active',
  deleted_at timestamptz
);
CREATE TABLE public.dealer_attendance (
  id uuid PRIMARY KEY,
  dealer_id uuid NOT NULL REFERENCES public.dealers(id),
  status text NOT NULL DEFAULT 'checked_in',
  check_out_time timestamptz,
  current_state text NOT NULL DEFAULT 'available'
);
CREATE TABLE public.dealer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  table_id uuid NOT NULL REFERENCES public.game_tables(id),
  table_session_id uuid REFERENCES public.table_sessions(id),
  attendance_id uuid NOT NULL REFERENCES public.dealer_attendance(id),
  status text NOT NULL DEFAULT 'assigned',
  released_at timestamptz,
  swing_processed_at timestamptz,
  pre_assigned_attendance_id uuid REFERENCES public.dealer_attendance(id),
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE public.club_dealer_controls (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  user_id uuid NOT NULL,
  PRIMARY KEY (club_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_club_dealer_control(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_dealer_controls cdc
    WHERE cdc.user_id = _user_id AND cdc.club_id = _club_id
  )
$$;

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id uuid,
  p_duration_minutes integer DEFAULT 30,
  p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT 15,
  p_max_break_minutes integer DEFAULT 60,
  p_expected_version integer DEFAULT NULL,
  p_next_attendance_id uuid DEFAULT NULL,
  p_rest_deficit_minutes integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_assignment public.dealer_assignments%ROWTYPE;
  v_next uuid;
  v_new uuid;
BEGIN
  SELECT * INTO v_assignment FROM public.dealer_assignments
  WHERE id = p_assignment_id AND status = 'assigned' AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_assignment.version THEN
    RETURN jsonb_build_object('outcome', 'version_conflict');
  END IF;
  v_next := COALESCE(p_next_attendance_id, v_assignment.pre_assigned_attendance_id);
  IF v_next IS NULL THEN
    SELECT dat.id INTO v_next
    FROM public.dealer_attendance dat JOIN public.dealers d ON d.id = dat.dealer_id
    WHERE d.club_id = v_assignment.club_id AND d.status = 'active'
      AND dat.status = 'checked_in' AND dat.check_out_time IS NULL
      AND dat.current_state IN ('available', 'on_break')
    ORDER BY dat.id LIMIT 1 FOR UPDATE OF dat;
  END IF;
  IF v_next IS NULL THEN RETURN jsonb_build_object('outcome', 'no_dealer'); END IF;
  PERFORM pg_sleep(0.3);
  UPDATE public.dealer_assignments SET status = 'completed', released_at = now(),
    swing_processed_at = now(), version = version + 1 WHERE id = p_assignment_id;
  UPDATE public.dealer_attendance SET current_state = 'assigned' WHERE id = v_next;
  INSERT INTO public.dealer_assignments(club_id, table_id, table_session_id, attendance_id)
  VALUES (v_assignment.club_id, v_assignment.table_id, NULL, v_next) RETURNING id INTO v_new;
  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.perform_swing(uuid,uuid,boolean,integer,text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT '{"outcome":"dead"}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.perform_swing(uuid,integer,uuid,boolean,integer,integer,timestamptz,integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT '{"outcome":"core"}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id uuid, p_next_attendance_id uuid, p_swing_due_at timestamptz,
  p_duration_minutes integer, p_send_to_break boolean, p_break_duration_minutes integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_assignment public.dealer_assignments%ROWTYPE; v_new uuid;
BEGIN
  SELECT * INTO v_assignment FROM public.dealer_assignments
  WHERE id = p_old_assignment_id AND status = 'assigned' AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'error'); END IF;
  UPDATE public.dealer_assignments SET status = 'completed', released_at = now(),
    swing_processed_at = now(), version = version + 1 WHERE id = p_old_assignment_id;
  UPDATE public.dealer_attendance SET current_state = 'assigned' WHERE id = p_next_attendance_id;
  INSERT INTO public.dealer_assignments(club_id, table_id, table_session_id, attendance_id)
  VALUES (v_assignment.club_id, v_assignment.table_id, v_assignment.table_session_id, p_next_attendance_id)
  RETURNING id INTO v_new;
  RETURN jsonb_build_object('status', 'success', 'new_assignment_id', v_new);
END;
$$;
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing_rpc(
  p_old_assignment_id uuid, p_next_attendance_id uuid, p_swing_due_at timestamptz,
  p_duration_minutes integer, p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT 15
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.execute_pre_assigned_swing($1,$2,$3,$4,$5,$6)
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN IF NOT COALESCE(p_condition, false) THEN RAISE EXCEPTION 'ASSERT:%', p_message; END IF; END;
$$;
CREATE OR REPLACE FUNCTION public.assert_raises(p_expected text, p_sql text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'ASSERT:no error for %', p_expected;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%' || p_expected || '%' THEN RAISE; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assert_true(boolean,text), public.assert_raises(text,text)
  TO anon, authenticated, service_role;

INSERT INTO public.clubs VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.game_tables VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001');
INSERT INTO public.table_sessions VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',NULL),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',NULL);
INSERT INTO public.dealers VALUES
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active',NULL),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','active',NULL),
  ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','active',NULL),
  ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','active',NULL),
  ('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','active',NULL),
  ('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','active',NULL),
  ('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','active',NULL),
  ('40000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','active',NULL);
INSERT INTO public.dealer_attendance VALUES
  ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','checked_in',NULL,'assigned'),
  ('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','checked_in',NULL,'available'),
  ('50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003','checked_in',NULL,'pre_assigned'),
  ('50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000004','checked_in',NULL,'available'),
  ('50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000005','checked_out',now(),'available'),
  ('50000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000006','checked_in',NULL,'assigned'),
  ('50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000007','checked_in',NULL,'assigned'),
  ('50000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000008','checked_in',NULL,'available');
INSERT INTO public.dealer_assignments(id,club_id,table_id,table_session_id,attendance_id,pre_assigned_attendance_id) VALUES
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',NULL),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000003'),
  ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000006',NULL);
INSERT INTO public.club_dealer_controls VALUES
  ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001');
