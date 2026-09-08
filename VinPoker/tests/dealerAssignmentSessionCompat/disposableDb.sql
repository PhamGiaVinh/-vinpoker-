\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.game_tables (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  table_name text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.table_sessions (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  game_table_id uuid NOT NULL REFERENCES public.game_tables(id),
  session_type text NOT NULL,
  control_mode text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE public.dealer_attendance (
  id uuid PRIMARY KEY,
  dealer_id uuid NOT NULL,
  current_state text NOT NULL,
  status text NOT NULL,
  pre_assigned_table_id uuid,
  pre_assigned_at timestamptz
);

CREATE TABLE public.dealer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.dealer_attendance(id),
  table_id uuid NOT NULL REFERENCES public.game_tables(id),
  table_session_id uuid REFERENCES public.table_sessions(id),
  club_id uuid NOT NULL,
  status text NOT NULL,
  assigned_at timestamptz NOT NULL,
  swing_due_at timestamptz,
  idempotency_key text UNIQUE,
  released_at timestamptz,
  release_reason text,
  needs_replacement boolean NOT NULL DEFAULT false
);

CREATE TABLE public.audit_logs (
  club_id uuid,
  actor_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  payload jsonb
);

CREATE TABLE public.dealer_override_claims (
  table_id uuid,
  dealer_id uuid,
  attendance_id uuid,
  txid bigint
);

CREATE OR REPLACE FUNCTION public._assert_dealer_allowed_for_table(uuid, uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.is_club_dealer_control(uuid, uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.assert_true(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion_failed: %', p_message;
  END IF;
END;
$$;

\ir ../../supabase/migrations/20270114000005_assign_dealer_floor_v3_session_compat.sql

INSERT INTO public.game_tables (id, club_id, table_name, status) VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Legacy', 'active'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Manual', 'active'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Tracker', 'active'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Drift', 'active'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'Rollover', 'active');

INSERT INTO public.dealer_attendance (id, dealer_id, current_state, status) VALUES
  ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'available', 'checked_in'),
  ('30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'available', 'checked_in'),
  ('30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 'available', 'checked_in'),
  ('30000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'available', 'checked_in'),
  ('30000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005', 'available', 'checked_in'),
  ('30000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000006', 'available', 'checked_in');

-- Zero-session legacy staffing remains valid and sessionless.
SELECT public.assign_dealer_to_table(
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  p_club_id => '20000000-0000-4000-8000-000000000001',
  p_idempotency_key => 'legacy-key'
);
SELECT public.assert_true(
  EXISTS (
    SELECT 1 FROM public.dealer_assignments
    WHERE idempotency_key = 'legacy-key' AND table_session_id IS NULL
  ),
  'zero-session assignment must remain legacy NULL'
);
SELECT 'ZERO_SESSION_ASSIGN=PASS';

-- Exact legacy replay succeeds while there is still no active session.
SELECT public.assert_true(
  public.assign_dealer_to_table(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    p_club_id => '20000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'legacy-key'
  ) ->> 'outcome' = 'ok',
  'legacy exact replay must succeed'
);

INSERT INTO public.table_sessions (id, club_id, game_table_id, session_type, control_mode) VALUES
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'cash', 'manual'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'tournament', 'tracker');

SELECT public.assign_dealer_to_table(
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  p_club_id => '20000000-0000-4000-8000-000000000001',
  p_idempotency_key => 'manual-key'
);
SELECT public.assert_true(
  (SELECT table_session_id FROM public.dealer_assignments WHERE idempotency_key = 'manual-key') =
    '50000000-0000-4000-8000-000000000002'::uuid,
  'manual session must bind exact identity'
);

SELECT public.assign_dealer_to_table(
  '30000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000003',
  p_club_id => '20000000-0000-4000-8000-000000000001',
  p_idempotency_key => 'tracker-key'
);
SELECT public.assert_true(
  (SELECT table_session_id FROM public.dealer_assignments WHERE idempotency_key = 'tracker-key') =
    '50000000-0000-4000-8000-000000000003'::uuid,
  'tracker session must bind exact identity'
);
SELECT 'ONE_SESSION_EXACT_BIND=PASS';

-- Caller club cannot override physical-table ownership.
SELECT public.assert_true(
  public.assign_dealer_to_table(
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    p_club_id => '20000000-0000-4000-8000-000000000099',
    p_idempotency_key => 'wrong-club-key'
  ) ->> 'outcome' = 'table_club_mismatch',
  'wrong club must fail closed'
);
SELECT public.assert_true(
  NOT EXISTS (SELECT 1 FROM public.dealer_assignments WHERE idempotency_key = 'wrong-club-key'),
  'wrong club must not write'
);

-- Fault injection: represent catalog drift that production uniqueness prevents.
INSERT INTO public.table_sessions (id, club_id, game_table_id, session_type, control_mode) VALUES
  ('50000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'cash', 'manual'),
  ('50000000-0000-4000-8000-000000000042', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'cash', 'manual');
SELECT public.assert_true(
  public.assign_dealer_to_table(
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    p_idempotency_key => 'ambiguous-key'
  ) ->> 'outcome' = 'table_session_ambiguous',
  'multiple active sessions must fail closed'
);
SELECT public.assert_true(
  NOT EXISTS (SELECT 1 FROM public.dealer_assignments WHERE idempotency_key = 'ambiguous-key'),
  'ambiguous session must not write'
);
SELECT 'MULTIPLE_SESSION_REJECT=PASS';

-- A legacy key cannot be reinterpreted after a session opens.
INSERT INTO public.table_sessions (id, club_id, game_table_id, session_type, control_mode) VALUES
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'tournament', 'tracker');
SELECT public.assert_true(
  public.assign_dealer_to_table(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    p_club_id => '20000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'legacy-key'
  ) ->> 'outcome' = 'idempotency_mismatch',
  'legacy key must mismatch after session creation'
);
SELECT 'LEGACY_KEY_AFTER_SESSION=PASS';

-- Closed A plus active B binds B; old key remains bound to A.
INSERT INTO public.table_sessions (id, club_id, game_table_id, session_type, control_mode, closed_at) VALUES
  ('50000000-0000-4000-8000-000000000051', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'tournament', 'tracker', NULL);
SELECT public.assign_dealer_to_table(
  '30000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000005',
  p_idempotency_key => 'rollover-a'
);
UPDATE public.dealer_assignments SET status = 'completed', released_at = now() WHERE idempotency_key = 'rollover-a';
UPDATE public.dealer_attendance SET current_state = 'available' WHERE id = '30000000-0000-4000-8000-000000000005';
UPDATE public.table_sessions SET closed_at = now() WHERE id = '50000000-0000-4000-8000-000000000051';
INSERT INTO public.table_sessions (id, club_id, game_table_id, session_type, control_mode) VALUES
  ('50000000-0000-4000-8000-000000000052', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'tournament', 'tracker');
SELECT public.assign_dealer_to_table(
  '30000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000005',
  p_idempotency_key => 'rollover-b'
);
SELECT public.assert_true(
  (SELECT table_session_id FROM public.dealer_assignments WHERE idempotency_key = 'rollover-b') =
    '50000000-0000-4000-8000-000000000052'::uuid,
  'new assignment must bind new active session'
);
SELECT public.assert_true(
  public.assign_dealer_to_table(
    '30000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    p_idempotency_key => 'rollover-a'
  ) ->> 'outcome' = 'idempotency_mismatch',
  'old session key must mismatch after rollover'
);

SELECT 'CANONICAL_ASSIGNMENT_SESSION_COMPAT=PASS';
