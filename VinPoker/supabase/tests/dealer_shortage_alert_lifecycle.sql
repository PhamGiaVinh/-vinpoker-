\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'assertion failed: %', p_message;
  END IF;
END;
$$;

SET session_replication_role = replica;
INSERT INTO public.clubs (id, name, region, status)
VALUES
  ('71000000-0000-4000-8000-000000000001', 'Shortage Alert Test A', 'TEST', 'approved'::public.club_status),
  ('71000000-0000-4000-8000-000000000002', 'Shortage Alert Test B', 'TEST', 'approved'::public.club_status)
ON CONFLICT (id) DO NOTHING;
SET session_replication_role = origin;

DELETE FROM public.dealer_shortage_alert_incidents
WHERE club_id IN (
  '71000000-0000-4000-8000-000000000001'::uuid,
  '71000000-0000-4000-8000-000000000002'::uuid
);

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.dealer_shortage_alert_incidents'::regclass),
  'shortage alert ledger must have RLS enabled'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.advance_dealer_shortage_alert_incident(uuid,text,text,smallint,jsonb,text,boolean,integer,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.advance_dealer_shortage_alert_incident(uuid,text,text,smallint,jsonb,text,boolean,integer,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.advance_dealer_shortage_alert_incident(uuid,text,text,smallint,jsonb,text,boolean,integer,integer)',
    'EXECUTE'
  ),
  'advance ledger RPC must remain service-role only'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.complete_dealer_shortage_alert_notification(uuid,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_dealer_shortage_alert_notification(uuid,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.complete_dealer_shortage_alert_notification(uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'complete ledger RPC must remain service-role only'
);

CREATE TEMP TABLE alert_response (payload jsonb NOT NULL);

INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'dealer_shortage_v1',
  'true_shortage',
  1::smallint,
  jsonb_build_object('status', 'ok', 'tables_without_replacement_total', 2),
  NULL,
  true,
  600,
  0
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'outcome' = 'recorded' AND payload->>'notification' = 'opened'
   FROM alert_response),
  'a true shortage opens exactly one incident and one initial notification claim'
);
SELECT public.complete_dealer_shortage_alert_notification(
  (SELECT (payload->>'incident_id')::uuid FROM alert_response),
  (SELECT (payload->>'claim_id')::uuid FROM alert_response),
  true
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'dealer_shortage_v1',
  'true_shortage',
  1::smallint,
  jsonb_build_object('status', 'ok', 'tables_without_replacement_total', 2),
  NULL,
  true,
  600,
  0
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'notification' = 'none' FROM alert_response),
  'a tick inside the cooldown must not send a duplicate reminder'
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'dealer_shortage_v1',
  'critical_shortage',
  2::smallint,
  jsonb_build_object('status', 'ok', 'tables_without_replacement_total', 3),
  NULL,
  true,
  600,
  0
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'notification' = 'escalated' FROM alert_response),
  'severity escalation must bypass the reminder cooldown once'
);
SELECT public.complete_dealer_shortage_alert_notification(
  (SELECT (payload->>'incident_id')::uuid FROM alert_response),
  (SELECT (payload->>'claim_id')::uuid FROM alert_response),
  true
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'dealer_shortage_v1',
  'healthy',
  0::smallint,
  jsonb_build_object('status', 'ok', 'tables_without_replacement_total', 0),
  NULL,
  true,
  600,
  0
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'notification' = 'none' FROM alert_response),
  'the first healthy tick only starts resolution debounce'
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'dealer_shortage_v1',
  'healthy',
  0::smallint,
  jsonb_build_object('status', 'ok', 'tables_without_replacement_total', 0),
  NULL,
  true,
  600,
  0
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'notification' = 'resolved' FROM alert_response),
  'a stable healthy state resolves and claims one resolution notification'
);
SELECT public.complete_dealer_shortage_alert_notification(
  (SELECT (payload->>'incident_id')::uuid FROM alert_response),
  (SELECT (payload->>'claim_id')::uuid FROM alert_response),
  true
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'dealer_shortage_v1',
  'healthy',
  0::smallint,
  jsonb_build_object('status', 'ok', 'tables_without_replacement_total', 0),
  NULL,
  true,
  600,
  0
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'notification' = 'none' FROM alert_response),
  'an already resolved incident must not repeat the resolution notification'
);
SELECT pg_temp.assert_true(
  (SELECT notification_count = 3 AND status = 'resolved'
   FROM public.dealer_shortage_alert_incidents
   WHERE club_id = '71000000-0000-4000-8000-000000000001'
     AND incident_key = 'dealer_shortage_v1'),
  'opened, escalated and resolved notifications are each recorded once'
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000001',
  'setting_off',
  'true_shortage',
  1::smallint,
  jsonb_build_object('status', 'ok'),
  NULL,
  false,
  600,
  120
);
SELECT pg_temp.assert_true(
  (SELECT payload->>'notification' = 'none' FROM alert_response),
  'notification-disabled clubs must not claim a Telegram send'
);

TRUNCATE alert_response;
INSERT INTO alert_response
SELECT public.advance_dealer_shortage_alert_incident(
  '71000000-0000-4000-8000-000000000002',
  'dealer_shortage_v1',
  'true_shortage',
  1::smallint,
  jsonb_build_object('status', 'ok'),
  NULL,
  true,
  600,
  120
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
   FROM public.dealer_shortage_alert_incidents
   WHERE incident_key = 'dealer_shortage_v1'
     AND club_id IN (
       '71000000-0000-4000-8000-000000000001'::uuid,
       '71000000-0000-4000-8000-000000000002'::uuid
     )),
  'each club owns an independent shortage incident'
);

SELECT pg_temp.assert_true(
  (SELECT public.advance_dealer_shortage_alert_incident(
    '71000000-0000-4000-8000-000000000001',
    'oversized_snapshot',
    'true_shortage',
    1::smallint,
    jsonb_build_object('raw_error', repeat('x', 8001)),
    NULL,
    true,
    600,
    120
  )->>'outcome') = 'invalid_request',
  'ledger rejects oversized persisted snapshots'
);

SELECT dblink_connect('shortage_alert_a', 'dbname=' || current_database());
SELECT dblink_connect('shortage_alert_b', 'dbname=' || current_database());
SELECT dblink_send_query('shortage_alert_a', $query$
  SELECT public.advance_dealer_shortage_alert_incident(
    '71000000-0000-4000-8000-000000000001',
    'concurrent_tick',
    'true_shortage',
    1::smallint,
    jsonb_build_object('status', 'ok'),
    NULL,
    true,
    600,
    120
  )::text
$query$);
SELECT dblink_send_query('shortage_alert_b', $query$
  SELECT public.advance_dealer_shortage_alert_incident(
    '71000000-0000-4000-8000-000000000001',
    'concurrent_tick',
    'true_shortage',
    1::smallint,
    jsonb_build_object('status', 'ok'),
    NULL,
    true,
    600,
    120
  )::text
$query$);

CREATE TEMP TABLE concurrent_alert_response (payload jsonb NOT NULL);
INSERT INTO concurrent_alert_response
SELECT response::jsonb
FROM dblink_get_result('shortage_alert_a') AS t(response text);
INSERT INTO concurrent_alert_response
SELECT response::jsonb
FROM dblink_get_result('shortage_alert_b') AS t(response text);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
      AND count(*) FILTER (WHERE payload->>'notification' = 'opened') = 1
      AND count(*) FILTER (WHERE payload->>'notification' = 'none') = 1
   FROM concurrent_alert_response),
  'concurrent ticks claim one opening notification without duplicate incidents'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.dealer_shortage_alert_incidents
   WHERE club_id = '71000000-0000-4000-8000-000000000001'
     AND incident_key = 'concurrent_tick'),
  'concurrent ticks persist one ledger row'
);
SELECT dblink_disconnect('shortage_alert_a');
SELECT dblink_disconnect('shortage_alert_b');

SELECT 'dealer_shortage_alert_lifecycle_sql_pass' AS result;
