-- Isolated trigger fixture, extending backupCron.fixture.pg17.sql; no network or real credentials.
CREATE TABLE public.dealers(id uuid PRIMARY KEY,club_id uuid);
CREATE TABLE public.club_settings(club_id uuid PRIMARY KEY,auto_swing_enabled boolean);
CREATE TABLE public.dealer_attendance(id uuid PRIMARY KEY,dealer_id uuid,current_state text,
  status text,check_out_time timestamptz);
ALTER TABLE net.test_requests ADD COLUMN body jsonb;
CREATE OR REPLACE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
RETURNS bigint LANGUAGE plpgsql AS $$DECLARE v_id bigint; BEGIN
  IF current_setting('test.enqueue_failure',true)='on' THEN RAISE EXCEPTION 'fixture transport error'; END IF;
  INSERT INTO net.test_requests(headers,url,body) VALUES($2,$1,$3) RETURNING id INTO v_id;
  RETURN v_id;
END$$;
