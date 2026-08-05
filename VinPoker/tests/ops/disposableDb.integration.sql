\set ON_ERROR_STOP on

-- Disposable PostgreSQL proof only. No project ref, credentials, or production
-- data are used. This baseline models only the dependencies of the invitation
-- migration, then applies that exact migration below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_confirmed_at timestamptz
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.clubs (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id));
CREATE TABLE public.club_floors (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (club_id, user_id)
);
CREATE TABLE public.club_cashiers (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (club_id, user_id)
);
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, actor_id uuid,
  action text NOT NULL, entity_type text, entity_id uuid, payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.ops_test_assert(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ops invite disposable assertion failed: %', message;
  END IF;
END;
$$;

\ir ../../supabase/migrations/20270107000001_ops_club_operator_invites.sql

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com', now()),
  ('00000000-0000-0000-0000-000000000002', 'pending.floor@example.com', NULL),
  ('00000000-0000-0000-0000-000000000003', 'known.cashier@example.com', now()),
  ('00000000-0000-0000-0000-000000000004', 'race.floor@example.com', now()),
  ('00000000-0000-0000-0000-000000000005', 'failure.floor@example.com', now()),
  ('00000000-0000-0000-0000-000000000099', 'outsider@example.com', now());
INSERT INTO public.clubs (id, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099');

-- ACL and RLS: authenticated callers cannot write membership or invite rows
-- directly, while the caller-bound accept RPC is executable.
SELECT public.ops_test_assert(
  NOT has_table_privilege('authenticated', 'public.club_operator_invites', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.club_floors', 'INSERT')
  AND has_function_privilege('authenticated', 'public.accept_my_club_operator_invites()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_my_club_operator_invites()', 'EXECUTE'),
  'browser roles have no direct writes and only authenticated can accept'
);

-- A service retry cannot accidentally bypass delivery/confirmation and create
-- membership for an unconfirmed Auth user.
SET ROLE service_role;
DO $$ BEGIN
  PERFORM public.apply_club_operator_invite(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000002',
    'pending.floor@example.com', 'floor', false, 'not_required'
  );
  RAISE EXCEPTION 'unconfirmed direct grant unexpectedly succeeded';
EXCEPTION WHEN others THEN
  IF SQLERRM <> 'AUTH_USER_UNCONFIRMED' THEN RAISE; END IF;
END $$;
RESET ROLE;

-- New/unconfirmed user: delivery-backed grant produces pending ledger only.
SET ROLE service_role;
SELECT * FROM public.apply_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002',
  'pending.floor@example.com', 'floor', true, 'sent'
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT status = 'pending' FROM public.club_operator_invites WHERE email_normalized = 'pending.floor@example.com')
  AND (SELECT count(*) = 0 FROM public.club_floors WHERE user_id = '00000000-0000-0000-0000-000000000002'),
  'pending invitation has zero Floor membership'
);

-- Existing confirmed user: no delivery grants exact membership immediately.
SET ROLE service_role;
SELECT * FROM public.apply_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000003',
  'known.cashier@example.com', 'cashier', false, 'not_required'
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT status = 'active' AND accepted_at IS NOT NULL
   FROM public.club_operator_invites WHERE email_normalized = 'known.cashier@example.com')
  AND EXISTS (SELECT 1 FROM public.club_cashiers
              WHERE club_id = '00000000-0000-0000-0000-000000000010'
                AND user_id = '00000000-0000-0000-0000-000000000003'),
  'confirmed existing Cashier is active with exact membership'
);

-- Confirmed pending recipient accepts with its own auth.uid; retry is idempotent.
UPDATE auth.users SET email_confirmed_at = now()
WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int = 1,
  'confirmed recipient activates exactly one pending invitation'
);
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int = 0
  AND (public.accept_my_club_operator_invites()->>'alreadyActiveCount')::int >= 1,
  'accept retry is idempotent after active transition'
);
RESET ROLE;
SELECT public.ops_test_assert(
  EXISTS (SELECT 1 FROM public.club_floors
          WHERE club_id = '00000000-0000-0000-0000-000000000010'
            AND user_id = '00000000-0000-0000-0000-000000000002')
  AND (SELECT count(*) = 1 FROM public.audit_logs
       WHERE actor_id = '00000000-0000-0000-0000-000000000002'
         AND action = 'ops_operator_invite_accepted'),
  'accept creates membership and one audit event'
);

-- Revoking an active invite removes its exact membership in the same commit.
SELECT id AS active_invite_id
FROM public.club_operator_invites
WHERE email_normalized = 'pending.floor@example.com' \gset
SET ROLE service_role;
SELECT * FROM public.revoke_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  :'active_invite_id'::uuid
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT status = 'revoked' FROM public.club_operator_invites WHERE email_normalized = 'pending.floor@example.com')
  AND NOT EXISTS (SELECT 1 FROM public.club_floors
                  WHERE club_id = '00000000-0000-0000-0000-000000000010'
                    AND user_id = '00000000-0000-0000-0000-000000000002'),
  'active revoke atomically removes the exact Floor membership'
);

-- Two database sessions race on one pending invite; only one can transition it.
SET ROLE service_role;
SELECT * FROM public.apply_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000004',
  'race.floor@example.com', 'floor', true, 'sent'
);
RESET ROLE;
SELECT dblink_connect('ops_accept_a', 'dbname=' || current_database());
SELECT dblink_connect('ops_accept_b', 'dbname=' || current_database());
SELECT dblink_send_query('ops_accept_a', $$SELECT public.accept_my_club_operator_invites()
  FROM (SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false)) s$$);
SELECT dblink_send_query('ops_accept_b', $$SELECT public.accept_my_club_operator_invites()
  FROM (SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false)) s$$);
CREATE TEMP TABLE ops_accept_results (result jsonb NOT NULL);
INSERT INTO ops_accept_results SELECT result FROM dblink_get_result('ops_accept_a') AS t(result jsonb);
INSERT INTO ops_accept_results SELECT result FROM dblink_get_result('ops_accept_b') AS t(result jsonb);
SELECT dblink_disconnect('ops_accept_a');
SELECT dblink_disconnect('ops_accept_b');
SELECT public.ops_test_assert(
  (SELECT count(*) FROM ops_accept_results WHERE (result->>'acceptedCount')::int = 1) = 1
  AND (SELECT count(*) FROM public.audit_logs WHERE actor_id = '00000000-0000-0000-0000-000000000004'
       AND action = 'ops_operator_invite_accepted') = 1,
  'concurrent accepts yield one transition and one audit'
);

-- Controlled audit failure proves acceptance is atomic: no membership escape.
CREATE OR REPLACE FUNCTION public.ops_test_fail_accept_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('ops_test.fail_accept_audit', true) = 'on'
    AND NEW.action = 'ops_operator_invite_accepted' THEN
    RAISE EXCEPTION 'controlled audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ops_test_fail_accept_audit
BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.ops_test_fail_accept_audit();
SET ROLE service_role;
SELECT * FROM public.apply_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000005',
  'failure.floor@example.com', 'floor', true, 'sent'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
SET ROLE authenticated;
SELECT set_config('ops_test.fail_accept_audit', 'on', false);
DO $$ BEGIN
  PERFORM public.accept_my_club_operator_invites();
  RAISE EXCEPTION 'acceptance unexpectedly succeeded';
EXCEPTION WHEN others THEN
  IF SQLERRM <> 'controlled audit failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT set_config('ops_test.fail_accept_audit', 'off', false);
SELECT public.ops_test_assert(
  (SELECT status = 'pending' FROM public.club_operator_invites WHERE email_normalized = 'failure.floor@example.com')
  AND NOT EXISTS (SELECT 1 FROM public.club_floors WHERE user_id = '00000000-0000-0000-0000-000000000005'),
  'audit failure rolls back both active transition and membership'
);

-- Revoke closes the same exact invite/membership pair. Revoke-before-accept
-- leaves no residual membership; accept-after-revoke is a no-op.
SELECT id AS pending_invite_id
FROM public.club_operator_invites
WHERE email_normalized = 'failure.floor@example.com' \gset
SET ROLE service_role;
SELECT * FROM public.revoke_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  :'pending_invite_id'::uuid
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
SET ROLE authenticated;
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int = 0,
  'revoked pending invite cannot be accepted'
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT status = 'revoked' FROM public.club_operator_invites WHERE email_normalized = 'failure.floor@example.com')
  AND NOT EXISTS (SELECT 1 FROM public.club_floors WHERE user_id = '00000000-0000-0000-0000-000000000005')
  AND NOT EXISTS (
    SELECT 1 FROM public.club_operator_invites i
    LEFT JOIN public.club_floors f ON i.operator_role = 'floor' AND f.club_id = i.club_id AND f.user_id = i.auth_user_id
    LEFT JOIN public.club_cashiers c ON i.operator_role = 'cashier' AND c.club_id = i.club_id AND c.user_id = i.auth_user_id
    WHERE i.status = 'active' AND ((i.operator_role = 'floor' AND f.user_id IS NULL) OR (i.operator_role = 'cashier' AND c.user_id IS NULL))
  ),
  'no revoked residual membership and no active invite missing membership'
);

SELECT 'ops club operator invites disposable DB integration passed' AS result;
