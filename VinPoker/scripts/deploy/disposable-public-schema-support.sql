-- Disposable PostgreSQL support only. Run after restoring a public-schema dump.
-- These stubs reproduce the extension surfaces exercised by Dealer Swing tests;
-- they never contact a real network, Vault, or scheduler.

ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS schedule text;
ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS command text;
ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE net._http_response ADD COLUMN IF NOT EXISTS timed_out boolean NOT NULL DEFAULT false;

CREATE SEQUENCE IF NOT EXISTS net.http_request_log_id_seq;
CREATE TABLE IF NOT EXISTS net.http_request_log (
  id bigint PRIMARY KEY DEFAULT nextval('net.http_request_log_id_seq'),
  url text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_milliseconds integer NOT NULL,
  created timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  headers jsonb DEFAULT '{}'::jsonb,
  body jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 1000
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  request_id bigint;
BEGIN
  INSERT INTO net.http_request_log (url, headers, body, timeout_milliseconds)
  VALUES (url, headers, body, timeout_milliseconds)
  RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  SELECT COALESCE(MAX(jobid), 0) + 1 INTO v_jobid FROM cron.job;
  INSERT INTO cron.job (jobid, jobname, schedule, command, active)
  VALUES (v_jobid, job_name, schedule, command, true);
  RETURN v_jobid;
END;
$$;

CREATE TABLE IF NOT EXISTS vault.secrets (
  name text PRIMARY KEY,
  decrypted_secret text NOT NULL
);
ALTER TABLE vault.decrypted_secrets ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE vault.decrypted_secrets ADD COLUMN IF NOT EXISTS decrypted_secret text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'vault.decrypted_secrets'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE vault.decrypted_secrets ADD CONSTRAINT decrypted_secrets_pkey PRIMARY KEY (name);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION vault.create_secret(
  p_secret text,
  p_name text,
  p_description text,
  p_project_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO vault.secrets (name, decrypted_secret)
  VALUES (p_name, p_secret)
  ON CONFLICT (name) DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
  INSERT INTO vault.decrypted_secrets (name, decrypted_secret)
  VALUES (p_name, p_secret)
  ON CONFLICT (name) DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
  RETURN p_project_id;
END;
$$;
