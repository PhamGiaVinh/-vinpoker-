-- Isolated-only cron/net/Vault doubles: no network, no real credential, no production execution.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,command text,active boolean);
INSERT INTO cron.job VALUES(30,'run-dealer-ready-backup','* * * * *','old-fixture-caller',true);
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,
  database text DEFAULT NULL,username text DEFAULT NULL,active boolean DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET command=COALESCE($3,command) WHERE jobid=$1$$;
CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
CREATE TABLE net._http_response(id bigint,status_code integer,timed_out boolean);
CREATE TABLE net.test_requests(id bigint GENERATED ALWAYS AS IDENTITY,headers jsonb,url text);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
RETURNS bigint LANGUAGE plpgsql AS $$DECLARE v_id bigint; BEGIN
  INSERT INTO net.test_requests(headers,url) VALUES($2,$1) RETURNING id INTO v_id;
  RETURN v_id;
END$$;
