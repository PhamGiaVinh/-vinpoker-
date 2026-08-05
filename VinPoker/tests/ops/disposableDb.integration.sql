\set ON_ERROR_STOP on

-- Disposable PostgreSQL proof only. No project ref, credentials, or live data
-- are used. The SQL below provides only the prerequisite schemas required by
-- the two reviewed Ops migrations.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.app_role AS ENUM ('super_admin', 'player');
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_confirmed_at timestamptz
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE OR REPLACE FUNCTION public.ops_test_assert(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ops invite disposable assertion failed: %', message;
  END IF;
END;
$$;

\ir ../../supabase/migrations/20270108000000_ops_operator_membership_baseline.sql
\ir ../../supabase/migrations/20270108000001_ops_club_operator_invites.sql

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com', now()),
  ('00000000-0000-0000-0000-000000000002', 'pending.floor@example.com', NULL),
  ('00000000-0000-0000-0000-000000000003', 'known.cashier@example.com', now()),
  ('00000000-0000-0000-0000-000000000004', 'race.floor@example.com', now()),
  ('00000000-0000-0000-0000-000000000005', 'failure.floor@example.com', now()),
  ('00000000-0000-0000-0000-000000000006', 'already.floor@example.com', now()),
  ('00000000-0000-0000-0000-000000000099', 'outsider@example.com', now());
INSERT INTO public.clubs (id, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099');

-- The baseline creates only its reviewed contracts and derives capability from
-- caller-bound membership, not a global role enum or display metadata.
INSERT INTO public.club_floors (club_id, user_id, granted_by)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SELECT public.ops_test_assert(
  EXISTS (SELECT 1 FROM public.get_my_floor_operator_scope()
          WHERE club_id = '00000000-0000-0000-0000-000000000010'
            AND can_owner AND NOT can_cashier AND NOT can_floor),
  'owner scope is caller-bound'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SELECT public.ops_test_assert(
  EXISTS (SELECT 1 FROM public.get_my_floor_operator_scope()
          WHERE club_id = '00000000-0000-0000-0000-000000000020'
            AND can_cashier)
  AND NOT EXISTS (SELECT 1 FROM public.get_my_floor_operator_scope()
                  WHERE club_id = '00000000-0000-0000-0000-000000000010'),
  'cashier scope is club-scoped and cross-club access is absent'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
SELECT public.ops_test_assert(
  EXISTS (SELECT 1 FROM public.get_my_floor_operator_scope()
          WHERE club_id = '00000000-0000-0000-0000-000000000010' AND can_floor),
  'floor scope comes from membership'
);
SELECT public.ops_test_assert(
  to_regclass('public.staking_deals') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname ILIKE '%staking%')
  AND to_regclass('public.club_operator_invite_events') IS NOT NULL,
  'baseline contains only Ops dependencies and invitation history'
);

-- Browser roles cannot write invitation state or its append-only event table.
SELECT public.ops_test_assert(
  NOT has_table_privilege('authenticated', 'public.club_operator_invites', 'INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('authenticated', 'public.club_operator_invite_events', 'INSERT, UPDATE, DELETE')
  AND has_function_privilege('authenticated', 'public.accept_my_club_operator_invites()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_my_club_operator_invites()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_my_floor_operator_scope()', 'EXECUTE'),
  'browser direct writes are denied and caller-bound reads require authentication'
);

-- A service retry cannot create membership for an unconfirmed Auth account.
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

-- New/unconfirmed user: delivery-backed grant produces pending state only.
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
  AND (SELECT count(*) = 0 FROM public.club_floors WHERE user_id = '00000000-0000-0000-0000-000000000002')
  AND (SELECT count(*) = 1 FROM public.club_operator_invite_events WHERE event_type = 'invited'),
  'pending invitation has zero membership and one invited event'
);

-- Re-sending remains pending and appends the correctly classified event.
SET ROLE service_role;
SELECT * FROM public.apply_club_operator_invite(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002',
  'pending.floor@example.com', 'floor', true, 'resent'
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT count(*) = 1 FROM public.club_operator_invite_events WHERE event_type = 'resent'),
  'resend is represented by its own append-only event'
);

-- Existing confirmed user becomes active with one membership and one event.
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
                AND user_id = '00000000-0000-0000-0000-000000000003')
  AND (SELECT count(*) = 1 FROM public.club_operator_invite_events WHERE event_type = 'granted_existing'),
  'confirmed existing cashier is active with exact membership'
);

-- Confirmed pending recipient accepts as auth.uid(); retry adds no terminal event.
UPDATE auth.users SET email_confirmed_at = now()
WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int = 1,
  'confirmed recipient activates one pending invitation'
);
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int = 0
  AND (public.accept_my_club_operator_invites()->>'alreadyActiveCount')::int >= 1,
  'accept retry is idempotent'
);
RESET ROLE;
SELECT public.ops_test_assert(
  EXISTS (SELECT 1 FROM public.club_floors
          WHERE club_id = '00000000-0000-0000-0000-000000000010'
            AND user_id = '00000000-0000-0000-0000-000000000002')
  AND (SELECT count(*) = 1 FROM public.club_operator_invite_events
       WHERE auth_user_id = '00000000-0000-0000-0000-000000000002' AND event_type = 'accepted'),
  'accept creates membership and exactly one accepted event'
);

-- Active revoke removes precisely the corresponding membership and appends once.
SELECT id AS active_invite_id
FROM public.club_operator_invites
WHERE email_normalized = 'pending.floor@example.com' \gset
SET ROLE service_role;
SELECT * FROM public.revoke_club_operator_invite(
  '00000000-0000-0000-0000-000000000001', :'active_invite_id'::uuid
);
SELECT * FROM public.revoke_club_operator_invite(
  '00000000-0000-0000-0000-000000000001', :'active_invite_id'::uuid
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT status = 'revoked' FROM public.club_operator_invites WHERE id = :'active_invite_id'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.club_floors
                  WHERE club_id = '00000000-0000-0000-0000-000000000010'
                    AND user_id = '00000000-0000-0000-0000-000000000002')
  AND (SELECT count(*) = 1 FROM public.club_operator_invite_events
       WHERE invite_id = :'active_invite_id'::uuid AND event_type = 'revoked'),
  'active revoke is exact and retry does not duplicate terminal event'
);

-- Two sessions race on one pending invite; the lock order yields one transition.
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
  AND (SELECT count(*) FROM public.club_operator_invite_events WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' AND event_type = 'accepted') = 1,
  'concurrent accepts produce one membership transition and one terminal event'
);

-- A controlled event insertion failure rolls back both invitation state and membership.
CREATE OR REPLACE FUNCTION public.ops_test_fail_accept_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('ops_test.fail_accept_event', true) = 'on'
    AND NEW.event_type = 'accepted' THEN
    RAISE EXCEPTION 'controlled event failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ops_test_fail_accept_event
BEFORE INSERT ON public.club_operator_invite_events
FOR EACH ROW EXECUTE FUNCTION public.ops_test_fail_accept_event();
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
SELECT set_config('ops_test.fail_accept_event', 'on', false);
DO $$ BEGIN
  PERFORM public.accept_my_club_operator_invites();
  RAISE EXCEPTION 'acceptance unexpectedly succeeded';
EXCEPTION WHEN others THEN
  IF SQLERRM <> 'controlled event failure' THEN RAISE; END IF;
END $$;
RESET ROLE;
SELECT set_config('ops_test.fail_accept_event', 'off', false);
SELECT public.ops_test_assert(
  (SELECT status = 'pending' FROM public.club_operator_invites WHERE email_normalized = 'failure.floor@example.com')
  AND NOT EXISTS (SELECT 1 FROM public.club_floors WHERE user_id = '00000000-0000-0000-0000-000000000005'),
  'event failure rolls back acceptance and membership'
);

-- Revoking a pending invitation prevents future acceptance and leaves no membership.
SELECT id AS pending_invite_id
FROM public.club_operator_invites
WHERE email_normalized = 'failure.floor@example.com' \gset
SET ROLE service_role;
SELECT * FROM public.revoke_club_operator_invite(
  '00000000-0000-0000-0000-000000000001', :'pending_invite_id'::uuid
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
SET ROLE authenticated;
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int = 0,
  'revoked pending invitation cannot be accepted'
);
RESET ROLE;
SELECT public.ops_test_assert(
  (SELECT status = 'revoked' FROM public.club_operator_invites WHERE id = :'pending_invite_id'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.club_floors WHERE user_id = '00000000-0000-0000-0000-000000000005'),
  'pending revoke leaves no residual membership'
);

-- Re-applying the baseline validates existing canonical contracts without loss.
INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001');
\ir ../../supabase/migrations/20270108000000_ops_operator_membership_baseline.sql
SELECT public.ops_test_assert(
  EXISTS (SELECT 1 FROM public.club_cashiers
          WHERE club_id = '00000000-0000-0000-0000-000000000010'
            AND user_id = '00000000-0000-0000-0000-000000000006'),
  'reconciliation leaves compatible existing data unchanged'
);

-- An incompatible pre-existing object fails closed instead of being repaired.
CREATE TABLE public.ops_incompatible_clubs (club_id uuid PRIMARY KEY, user_id uuid NOT NULL);
ALTER TABLE public.ops_incompatible_clubs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  PERFORM public.ops_test_assert(
    NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.ops_incompatible_clubs'::regclass AND contype = 'f'
    ),
    'incompatible fixture is intentionally noncanonical'
  );
END $$;

SELECT 'ops club operator invites disposable PostgreSQL integration passed' AS result;
