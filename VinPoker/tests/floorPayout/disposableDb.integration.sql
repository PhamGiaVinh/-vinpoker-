\set ON_ERROR_STOP on

-- Disposable PostgreSQL only. This fixture contains no project reference,
-- credential, production connection string, or real player/club data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS auth;

DO $roles$
BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
DO $roles$
BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
DO $roles$
BEGIN
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
ALTER ROLE service_role BYPASSRLS;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL
);

CREATE TABLE public.club_cashiers (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE public.club_floors (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text
);

CREATE TABLE public.club_members (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  full_name text,
  player_user_id uuid
);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'completed'
);

CREATE TABLE public.tournament_entries (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  member_id uuid REFERENCES public.club_members(id) ON DELETE SET NULL,
  finished_place integer
);

CREATE TABLE public.tournament_prizes (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  position integer NOT NULL,
  percentage numeric(5,2) NOT NULL DEFAULT 100,
  amount numeric(12,2) NOT NULL,
  UNIQUE (tournament_id, position)
);

-- Exact predecessor contract from 20261216000000, reduced to columns consumed
-- by the new migration and its public response compatibility.
CREATE TABLE public.tournament_prize_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id uuid NOT NULL,
  finished_place integer NOT NULL,
  prize_amount numeric(12,2) NOT NULL,
  recipient_ref uuid,
  recipient_name text,
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'returned', 'cancelled')),
  paid_by uuid REFERENCES auth.users(id),
  paid_at timestamptz NOT NULL DEFAULT now(),
  method text CHECK (method IN ('cash', 'bank', 'app', 'other')),
  proof_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_prize_paid_once
  ON public.tournament_prize_payments(tournament_id, finished_place)
  WHERE status = 'paid';

CREATE OR REPLACE FUNCTION public.floor_payout_test_assert(
  condition boolean,
  message text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'floor payout disposable assertion failed: %', message;
  END IF;
END;
$function$;

\ir ../../supabase/migrations/20270107000000_floor_payout_requests.sql

-- Disposable-only adapter: existing scenario calls behave like the browser by
-- reading the displayed snapshot immediately before sending its fingerprint.
-- Production exposes only the six-argument RPC from the migration.
CREATE OR REPLACE FUNCTION public.create_tournament_prize_payment_request(
  p_tournament_id uuid,
  p_finished_place integer,
  p_method text,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.create_tournament_prize_payment_request(
    p_tournament_id,
    p_finished_place,
    p_method,
    p_notes,
    p_idempotency_key,
    vinpoker_private.read_prize_snapshot(p_tournament_id, p_finished_place) ->> 'fingerprint'
  );
$function$;
REVOKE ALL ON FUNCTION public.create_tournament_prize_payment_request(
  uuid, integer, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_tournament_prize_payment_request(
  uuid, integer, text, text, text
) TO authenticated;

INSERT INTO auth.users(id)
VALUES
  (md5('owner-a')::uuid),
  (md5('cashier-a')::uuid),
  (md5('floor-a')::uuid),
  (md5('floor-no-grant')::uuid),
  (md5('floor-b')::uuid),
  (md5('owner-floor-a')::uuid),
  (md5('owner-b')::uuid),
  (md5('outsider')::uuid),
  (md5('player-create')::uuid),
  (md5('player-approve')::uuid),
  (md5('player-direct')::uuid),
  (md5('player-stale-recipient')::uuid),
  (md5('player-stale-prize')::uuid),
  (md5('player-removed')::uuid),
  (md5('player-revoked')::uuid),
  (md5('player-cancel')::uuid),
  (md5('player-concurrent')::uuid),
  (md5('player-reject')::uuid),
  (md5('player-same-reviewer')::uuid),
  (md5('player-cross')::uuid);

INSERT INTO public.clubs(id, owner_id, name)
VALUES
  (md5('club-a')::uuid, md5('owner-a')::uuid, 'CODEX_FLOOR_UAT_DB_A'),
  (md5('club-b')::uuid, md5('owner-b')::uuid, 'CODEX_FLOOR_UAT_DB_B');

INSERT INTO public.club_cashiers(club_id, user_id)
VALUES
  (md5('club-a')::uuid, md5('cashier-a')::uuid),
  (md5('club-a')::uuid, md5('owner-floor-a')::uuid);

INSERT INTO public.club_floors(club_id, user_id)
VALUES
  (md5('club-a')::uuid, md5('floor-a')::uuid),
  (md5('club-a')::uuid, md5('floor-no-grant')::uuid),
  (md5('club-a')::uuid, md5('owner-floor-a')::uuid),
  (md5('club-b')::uuid, md5('floor-b')::uuid);

INSERT INTO public.profiles(user_id, display_name)
VALUES
  (md5('owner-a')::uuid, 'CODEX_FLOOR_UAT_OWNER_A'),
  (md5('cashier-a')::uuid, 'CODEX_FLOOR_UAT_CASHIER_A'),
  (md5('floor-a')::uuid, 'CODEX_FLOOR_UAT_FLOOR_A'),
  (md5('floor-no-grant')::uuid, 'CODEX_FLOOR_UAT_FLOOR_NO_GRANT'),
  (md5('owner-floor-a')::uuid, 'CODEX_FLOOR_UAT_OWNER_FLOOR_A'),
  (md5('owner-b')::uuid, 'CODEX_FLOOR_UAT_OWNER_B'),
  (md5('floor-b')::uuid, 'CODEX_FLOOR_UAT_FLOOR_B');

WITH scenarios(name) AS (
  SELECT unnest(ARRAY[
    'create', 'approve', 'direct', 'stale-recipient', 'stale-prize',
    'removed', 'revoked', 'cancel', 'concurrent', 'reject',
    'same-reviewer', 'cross'
  ])
)
INSERT INTO public.tournaments(id, club_id, name)
SELECT
  md5('tour-' || name)::uuid,
  CASE WHEN name = 'cross' THEN md5('club-b')::uuid ELSE md5('club-a')::uuid END,
  'CODEX_FLOOR_UAT_DB_' || upper(name)
FROM scenarios;

WITH scenarios(name) AS (
  SELECT unnest(ARRAY[
    'create', 'approve', 'direct', 'stale-recipient', 'stale-prize',
    'removed', 'revoked', 'cancel', 'concurrent', 'reject',
    'same-reviewer', 'cross'
  ])
)
INSERT INTO public.club_members(id, club_id, full_name, player_user_id)
SELECT
  md5('member-' || name)::uuid,
  CASE WHEN name = 'cross' THEN md5('club-b')::uuid ELSE md5('club-a')::uuid END,
  'TEST Player ' || name,
  md5('player-' || name)::uuid
FROM scenarios;

WITH scenarios(name) AS (
  SELECT unnest(ARRAY[
    'create', 'approve', 'direct', 'stale-recipient', 'stale-prize',
    'removed', 'revoked', 'cancel', 'concurrent', 'reject',
    'same-reviewer', 'cross'
  ])
)
INSERT INTO public.tournament_entries(
  id, tournament_id, player_id, member_id, finished_place
)
SELECT
  md5('entry-' || name)::uuid,
  md5('tour-' || name)::uuid,
  md5('player-' || name)::uuid,
  md5('member-' || name)::uuid,
  1
FROM scenarios;

WITH scenarios(name) AS (
  SELECT unnest(ARRAY[
    'create', 'approve', 'direct', 'stale-recipient', 'stale-prize',
    'removed', 'revoked', 'cancel', 'concurrent', 'reject',
    'same-reviewer', 'cross'
  ])
)
INSERT INTO public.tournament_prizes(
  id, tournament_id, position, percentage, amount
)
SELECT
  md5('prize-' || name)::uuid,
  md5('tour-' || name)::uuid,
  1,
  100,
  1000000
FROM scenarios;

-- A second place on the create fixture exercises idempotency-key conflicts.
INSERT INTO public.tournament_entries(
  id, tournament_id, player_id, member_id, finished_place
)
VALUES (
  md5('entry-create-2')::uuid,
  md5('tour-create')::uuid,
  md5('player-approve')::uuid,
  md5('member-approve')::uuid,
  2
);
INSERT INTO public.tournament_prizes(
  id, tournament_id, position, percentage, amount
)
VALUES (
  md5('prize-create-2')::uuid,
  md5('tour-create')::uuid,
  2,
  50,
  500000
);

CREATE TEMP TABLE payout_results (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
);

-- Owner is not implicitly a Floor requester.
SELECT set_config('request.jwt.claim.sub', md5('owner-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'owner-not-floor',
  public.get_floor_payout_requestable_places(md5('tour-create')::uuid)
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'owner-not-floor')
    = 'floor_payout_grant_required',
  'owner must have a literal Floor membership and grant'
);

-- Owner grants only literal Floor memberships.
INSERT INTO payout_results
VALUES (
  'grant-missing-membership',
  public.set_floor_payout_request_grant(
    md5('club-a')::uuid,
    md5('outsider')::uuid,
    true
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'grant-missing-membership')
    = 'floor_membership_required',
  'grant requires a literal club_floors row'
);

INSERT INTO payout_results
VALUES
  (
    'grant-floor-a',
    public.set_floor_payout_request_grant(
      md5('club-a')::uuid, md5('floor-a')::uuid, true
    )
  ),
  (
    'grant-owner-floor',
    public.set_floor_payout_request_grant(
      md5('club-a')::uuid, md5('owner-floor-a')::uuid, true
    )
  );
SELECT public.floor_payout_test_assert(
  (SELECT count(*) FROM public.club_floor_payout_request_grants) = 2,
  'exactly two club A grants exist'
);
SELECT public.floor_payout_test_assert(
  (
    SELECT count(*)
    FROM public.tournament_prize_payment_request_events
    WHERE event_type = 'grant_added'
  ) = 2,
  'grant changes are append-only events'
);

SELECT set_config('request.jwt.claim.sub', md5('owner-b')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'grant-floor-b',
  public.set_floor_payout_request_grant(
    md5('club-b')::uuid, md5('floor-b')::uuid, true
  )
);

-- Missing grant and cross-club scope both fail closed.
SELECT set_config('request.jwt.claim.sub', md5('floor-no-grant')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'missing-grant',
  public.get_floor_payout_requestable_places(md5('tour-create')::uuid)
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'missing-grant')
    = 'floor_payout_grant_required',
  'Floor without grant is denied'
);

SELECT set_config('request.jwt.claim.sub', md5('floor-b')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'cross-club',
  public.get_floor_payout_requestable_places(md5('tour-create')::uuid)
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'cross-club')
    = 'floor_payout_grant_required',
  'cross-club Floor spoof is denied'
);

-- Create is server-derived and idempotent for the same requester/key/payload.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'create-stale-screen',
  public.create_tournament_prize_payment_request(
    md5('tour-create')::uuid,
    1,
    'cash',
    'TEST stale screen',
    'stale-screen-key',
    repeat('0', 32)
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'create-stale-screen')
    = 'snapshot_changed'
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_prize_payment_requests
      WHERE idempotency_key = 'stale-screen-key'
    ),
  'create rejects a snapshot that changed after the Floor screen loaded'
);
INSERT INTO payout_results
VALUES (
  'create',
  public.create_tournament_prize_payment_request(
    md5('tour-create')::uuid, 1, 'cash', 'TEST hand-off', 'create-key'
  )
);
INSERT INTO payout_results
VALUES (
  'create-retry',
  public.create_tournament_prize_payment_request(
    md5('tour-create')::uuid, 1, 'cash', 'TEST hand-off', 'create-key'
  )
);
INSERT INTO payout_results
VALUES (
  'create-key-conflict',
  public.create_tournament_prize_payment_request(
    md5('tour-create')::uuid, 2, 'cash', 'TEST hand-off', 'create-key'
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'create') = 'created'
    AND
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'create-retry') = 'idempotent',
  'create retry reuses one request'
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'create-key-conflict')
    = 'idempotency_key_conflict',
  'same key cannot describe a different payout intent'
);
SELECT public.floor_payout_test_assert(
  (
    SELECT snapshot_prize_amount
    FROM public.tournament_prize_payment_requests
    WHERE id = (
      SELECT (payload ->> 'requestId')::uuid
      FROM payout_results WHERE key = 'create'
    )
  ) = 1000000,
  'request amount is derived from the prize table'
);

-- Authenticated callers cannot bypass RPCs with direct table writes.
SET ROLE authenticated;
DO $blocked$
BEGIN
  BEGIN
    INSERT INTO public.tournament_prize_payment_requests (
      club_id, tournament_id, finished_place, requested_by, snapshot_entry_id,
      snapshot_prize_id, snapshot_prize_amount, snapshot_fingerprint,
      idempotency_key
    )
    VALUES (
      md5('club-a')::uuid, md5('tour-create')::uuid, 2,
      md5('floor-a')::uuid, md5('entry-create-2')::uuid,
      md5('prize-create-2')::uuid, 1, 'forged', 'forged'
    );
    RAISE EXCEPTION 'authenticated direct insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.tournament_prize_payment_request_events SET detail = '{}'::jsonb;
    RAISE EXCEPTION 'authenticated event update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$blocked$;
RESET ROLE;

-- Normal approval creates exactly one ledger row.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'approve-create',
  public.create_tournament_prize_payment_request(
    md5('tour-approve')::uuid, 1, 'bank', 'TEST approval', 'approve-key'
  )
);
SELECT set_config('request.jwt.claim.sub', md5('owner-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'approve',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'approve-create'),
    'approve',
    'Externally handed over'
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'approve') = 'recorded'
    AND
  (
    SELECT count(*) FROM public.tournament_prize_payments
    WHERE tournament_id = md5('tour-approve')::uuid AND status = 'paid'
  ) = 1,
  'approved request writes one paid ledger row'
);

-- Same requester/reviewer and unauthorized reviewer are denied.
SELECT set_config('request.jwt.claim.sub', md5('owner-floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'same-reviewer-create',
  public.create_tournament_prize_payment_request(
    md5('tour-same-reviewer')::uuid, 1, 'cash', NULL, 'same-reviewer-key'
  )
);
INSERT INTO payout_results
VALUES (
  'same-reviewer',
  public.review_tournament_prize_payment_request(
    (
      SELECT (payload ->> 'requestId')::uuid
      FROM payout_results WHERE key = 'same-reviewer-create'
    ),
    'approve',
    NULL
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'same-reviewer')
    = 'reviewer_must_differ',
  'requester cannot approve their own request'
);

SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'reject-create',
  public.create_tournament_prize_payment_request(
    md5('tour-reject')::uuid, 1, 'cash', NULL, 'reject-key'
  )
);
SELECT set_config('request.jwt.claim.sub', md5('outsider')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'unauthorized-review',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'reject-create'),
    'approve',
    NULL
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'unauthorized-review')
    = 'actor_not_allowed',
  'unauthorized reviewer is denied'
);
SELECT set_config('request.jwt.claim.sub', md5('cashier-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'null-decision',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'reject-create'),
    NULL,
    NULL
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM payout_results WHERE key = 'null-decision')
    = 'invalid_decision'
    AND
  (
    SELECT count(*) FROM public.tournament_prize_payments
    WHERE tournament_id = md5('tour-reject')::uuid
  ) = 0,
  'NULL review decision cannot fall through to approval'
);
INSERT INTO payout_results
VALUES (
  'reject',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'reject-create'),
    'reject',
    'TEST rejected'
  )
);
SELECT public.floor_payout_test_assert(
  (
    SELECT count(*) FROM public.tournament_prize_payments
    WHERE tournament_id = md5('tour-reject')::uuid
  ) = 0,
  'reject does not change the payment ledger'
);

-- Direct owner/cashier recording wins and supersedes a pending request.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'direct-create',
  public.create_tournament_prize_payment_request(
    md5('tour-direct')::uuid, 1, 'cash', NULL, 'direct-key'
  )
);
SELECT set_config('request.jwt.claim.sub', md5('owner-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'direct-payment',
  public.record_tournament_prize_payment(
    md5('tour-direct')::uuid, 1, 'cash', NULL, 'Direct TEST record'
  )
);
SELECT set_config('request.jwt.claim.sub', md5('cashier-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'direct-late-review',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'direct-create'),
    'approve',
    NULL
  )
);
SELECT public.floor_payout_test_assert(
  (
    SELECT status FROM public.tournament_prize_payment_requests
    WHERE id = (
      SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'direct-create'
    )
  ) = 'superseded'
    AND
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'direct-late-review')
    = 'already_paid'
    AND
  (
    SELECT count(*) FROM public.tournament_prize_payments
    WHERE tournament_id = md5('tour-direct')::uuid AND status = 'paid'
  ) = 1,
  'direct payment supersedes pending request without a duplicate ledger row'
);

-- Recipient and prize changes mark the old snapshot stale.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES
  (
    'stale-recipient-create',
    public.create_tournament_prize_payment_request(
      md5('tour-stale-recipient')::uuid, 1, 'cash', NULL, 'stale-recipient-key'
    )
  ),
  (
    'stale-prize-create',
    public.create_tournament_prize_payment_request(
      md5('tour-stale-prize')::uuid, 1, 'cash', NULL, 'stale-prize-key'
    )
  );
UPDATE public.club_members
SET full_name = 'TEST Player changed'
WHERE id = md5('member-stale-recipient')::uuid;
UPDATE public.tournament_prizes
SET amount = 1200000
WHERE id = md5('prize-stale-prize')::uuid;
SELECT set_config('request.jwt.claim.sub', md5('owner-a')::uuid::text, false);
INSERT INTO payout_results
VALUES
  (
    'stale-recipient',
    public.review_tournament_prize_payment_request(
      (
        SELECT (payload ->> 'requestId')::uuid
        FROM payout_results WHERE key = 'stale-recipient-create'
      ),
      'approve',
      NULL
    )
  ),
  (
    'stale-prize',
    public.review_tournament_prize_payment_request(
      (
        SELECT (payload ->> 'requestId')::uuid
        FROM payout_results WHERE key = 'stale-prize-create'
      ),
      'approve',
      NULL
    )
  );
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'stale-recipient') = 'stale'
    AND
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'stale-prize') = 'stale'
    AND
  (
    SELECT count(*) FROM public.tournament_prize_payments
    WHERE tournament_id IN (
      md5('tour-stale-recipient')::uuid,
      md5('tour-stale-prize')::uuid
    )
  ) = 0,
  'changed recipient/prize cannot be approved from a stale snapshot'
);

-- Revoked grant and removed membership both become stale at review time.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES
  (
    'removed-create',
    public.create_tournament_prize_payment_request(
      md5('tour-removed')::uuid, 1, 'cash', NULL, 'removed-key'
    )
  ),
  (
    'revoked-create',
    public.create_tournament_prize_payment_request(
      md5('tour-revoked')::uuid, 1, 'cash', NULL, 'revoked-key'
    )
  );
SELECT set_config('request.jwt.claim.sub', md5('owner-a')::uuid::text, false);
DELETE FROM public.club_floors
WHERE club_id = md5('club-a')::uuid
  AND user_id = md5('floor-a')::uuid;
INSERT INTO payout_results
VALUES (
  'removed-review',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'removed-create'),
    'approve',
    NULL
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'removed-review') = 'stale',
  'removed Floor membership invalidates approval'
);

-- Re-add/grant, create a separate request, then revoke only the grant.
INSERT INTO public.club_floors(club_id, user_id)
VALUES (md5('club-a')::uuid, md5('floor-a')::uuid);
SELECT public.set_floor_payout_request_grant(
  md5('club-a')::uuid, md5('floor-a')::uuid, true
);
SELECT public.set_floor_payout_request_grant(
  md5('club-a')::uuid, md5('floor-a')::uuid, false
);
INSERT INTO payout_results
VALUES (
  'revoked-review',
  public.review_tournament_prize_payment_request(
    (SELECT (payload ->> 'requestId')::uuid FROM payout_results WHERE key = 'revoked-create'),
    'approve',
    NULL
  )
);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'outcome' FROM payout_results WHERE key = 'revoked-review') = 'stale',
  'revoked Floor grant invalidates approval'
);

-- Restore the Floor grant for the concurrency fixtures.
SELECT public.set_floor_payout_request_grant(
  md5('club-a')::uuid, md5('floor-a')::uuid, true
);

-- Approval holds the literal membership/grant rows through ledger commit.
-- A concurrent revoke must wait and linearize after the approved write.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'revoke-race-create',
  public.create_tournament_prize_payment_request(
    md5('tour-revoked')::uuid, 1, 'cash', NULL, 'revoke-race-key'
  )
);
CREATE OR REPLACE FUNCTION public.floor_payout_test_hold_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tournament_id = md5('tour-revoked')::uuid THEN
    PERFORM pg_advisory_lock(701050001);
    PERFORM pg_advisory_unlock(701050001);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER floor_payout_test_hold_ledger_insert
BEFORE INSERT ON public.tournament_prize_payments
FOR EACH ROW
EXECUTE FUNCTION public.floor_payout_test_hold_ledger_insert();

SELECT pg_advisory_lock(701050001);
SELECT dblink_connect('approve_before_revoke', 'dbname=' || current_database());
SELECT dblink_connect('revoke_during_approve', 'dbname=' || current_database());
SELECT dblink_send_query(
  'approve_before_revoke',
  format(
    $query$
      SELECT public.review_tournament_prize_payment_request(
        %L::uuid, 'approve', 'approval owns grant lock'
      )
      FROM (
        SELECT set_config('request.jwt.claim.sub', %L, false)
      ) claim
    $query$,
    (SELECT payload ->> 'requestId' FROM payout_results WHERE key = 'revoke-race-create'),
    md5('owner-a')::uuid::text
  )
);
DO $wait_for_approval$
DECLARE
  attempt integer;
BEGIN
  FOR attempt IN 1..100 LOOP
    EXIT WHEN EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted IS FALSE
    );
    PERFORM pg_sleep(0.02);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_locks
    WHERE locktype = 'advisory' AND granted IS FALSE
  ) THEN
    RAISE EXCEPTION 'approval did not reach the controlled ledger seam';
  END IF;
END;
$wait_for_approval$;
SELECT dblink_send_query(
  'revoke_during_approve',
  format(
    $query$
      SELECT public.set_floor_payout_request_grant(
        %L::uuid, %L::uuid, false
      )
      FROM (
        SELECT set_config('request.jwt.claim.sub', %L, false)
      ) claim
    $query$,
    md5('club-a')::uuid::text,
    md5('floor-a')::uuid::text,
    md5('owner-a')::uuid::text
  )
);
SELECT pg_sleep(0.1);
SELECT public.floor_payout_test_assert(
  dblink_is_busy('revoke_during_approve') = 1,
  'grant revoke waits while approval owns the grant row'
);
SELECT pg_advisory_unlock(701050001);
CREATE TEMP TABLE revoke_approval_results(key text PRIMARY KEY, payload jsonb);
INSERT INTO revoke_approval_results
SELECT 'approve', result
FROM dblink_get_result('approve_before_revoke') AS response(result jsonb);
INSERT INTO revoke_approval_results
SELECT 'revoke', result
FROM dblink_get_result('revoke_during_approve') AS response(result jsonb);
SELECT dblink_disconnect('approve_before_revoke');
SELECT dblink_disconnect('revoke_during_approve');
DROP TRIGGER floor_payout_test_hold_ledger_insert ON public.tournament_prize_payments;
DROP FUNCTION public.floor_payout_test_hold_ledger_insert();
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'request_status' FROM revoke_approval_results WHERE key = 'approve')
    = 'approved'
    AND
  (SELECT (payload ->> 'changed')::boolean FROM revoke_approval_results WHERE key = 'revoke')
    IS TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.club_floor_payout_request_grants
      WHERE club_id = md5('club-a')::uuid
        AND floor_user_id = md5('floor-a')::uuid
    )
    AND (
      SELECT count(*)
      FROM public.tournament_prize_payments
      WHERE tournament_id = md5('tour-revoked')::uuid
        AND finished_place = 1
        AND status = 'paid'
    ) = 1,
  'revoke linearizes after approval without an unauthorized ledger race'
);

-- Restore the grant after the revoke race for the remaining fixtures.
SELECT set_config('request.jwt.claim.sub', md5('owner-a')::uuid::text, false);
SELECT public.set_floor_payout_request_grant(
  md5('club-a')::uuid, md5('floor-a')::uuid, true
);

-- Two concurrent reviewers serialize on tournament -> request and create at
-- most one paid ledger row.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'concurrent-create',
  public.create_tournament_prize_payment_request(
    md5('tour-concurrent')::uuid, 1, 'bank', NULL, 'concurrent-key'
  )
);
SELECT dblink_connect('review_owner', 'dbname=' || current_database());
SELECT dblink_connect('review_cashier', 'dbname=' || current_database());
SELECT dblink_send_query(
  'review_owner',
  format(
    $query$
      SELECT public.review_tournament_prize_payment_request(
        %L::uuid, 'approve', 'owner reviewer'
      )
      FROM (
        SELECT set_config('request.jwt.claim.sub', %L, false)
      ) claim
    $query$,
    (
      SELECT payload ->> 'requestId'
      FROM payout_results WHERE key = 'concurrent-create'
    ),
    md5('owner-a')::uuid::text
  )
);
SELECT dblink_send_query(
  'review_cashier',
  format(
    $query$
      SELECT public.review_tournament_prize_payment_request(
        %L::uuid, 'approve', 'cashier reviewer'
      )
      FROM (
        SELECT set_config('request.jwt.claim.sub', %L, false)
      ) claim
    $query$,
    (
      SELECT payload ->> 'requestId'
      FROM payout_results WHERE key = 'concurrent-create'
    ),
    md5('cashier-a')::uuid::text
  )
);
CREATE TEMP TABLE concurrent_review_results(payload jsonb);
INSERT INTO concurrent_review_results
SELECT result FROM dblink_get_result('review_owner') AS response(result jsonb);
INSERT INTO concurrent_review_results
SELECT result FROM dblink_get_result('review_cashier') AS response(result jsonb);
SELECT dblink_disconnect('review_owner');
SELECT dblink_disconnect('review_cashier');
SELECT public.floor_payout_test_assert(
  (
    SELECT count(*) FROM public.tournament_prize_payments
    WHERE tournament_id = md5('tour-concurrent')::uuid AND status = 'paid'
  ) = 1
    AND
  (SELECT count(*) FROM concurrent_review_results WHERE payload ->> 'ok' = 'true') = 2,
  'concurrent reviewers are idempotent and write one ledger row'
);

-- Cancel and approve racing on the same tournament produce one terminal
-- request; a non-approved outcome never adds a ledger row.
SELECT set_config('request.jwt.claim.sub', md5('floor-a')::uuid::text, false);
INSERT INTO payout_results
VALUES (
  'cancel-create',
  public.create_tournament_prize_payment_request(
    md5('tour-cancel')::uuid, 1, 'cash', NULL, 'cancel-key'
  )
);
SELECT dblink_connect('cancel_floor', 'dbname=' || current_database());
SELECT dblink_connect('cancel_owner', 'dbname=' || current_database());
SELECT dblink_send_query(
  'cancel_floor',
  format(
    $query$
      SELECT public.cancel_tournament_prize_payment_request(%L::uuid)
      FROM (
        SELECT set_config('request.jwt.claim.sub', %L, false)
      ) claim
    $query$,
    (SELECT payload ->> 'requestId' FROM payout_results WHERE key = 'cancel-create'),
    md5('floor-a')::uuid::text
  )
);
SELECT dblink_send_query(
  'cancel_owner',
  format(
    $query$
      SELECT public.review_tournament_prize_payment_request(
        %L::uuid, 'approve', 'racing review'
      )
      FROM (
        SELECT set_config('request.jwt.claim.sub', %L, false)
      ) claim
    $query$,
    (SELECT payload ->> 'requestId' FROM payout_results WHERE key = 'cancel-create'),
    md5('owner-a')::uuid::text
  )
);
CREATE TEMP TABLE cancel_review_results(payload jsonb);
INSERT INTO cancel_review_results
SELECT result FROM dblink_get_result('cancel_floor') AS response(result jsonb);
INSERT INTO cancel_review_results
SELECT result FROM dblink_get_result('cancel_owner') AS response(result jsonb);
SELECT dblink_disconnect('cancel_floor');
SELECT dblink_disconnect('cancel_owner');
SELECT public.floor_payout_test_assert(
  (
    (
      SELECT status = 'approved'
      FROM public.tournament_prize_payment_requests
      WHERE id = (
        SELECT (payload ->> 'requestId')::uuid
        FROM payout_results WHERE key = 'cancel-create'
      )
    )
    AND
    (
      SELECT count(*) FROM public.tournament_prize_payments
      WHERE tournament_id = md5('tour-cancel')::uuid AND status = 'paid'
    ) = 1
  )
  OR
  (
    (
      SELECT status = 'cancelled'
      FROM public.tournament_prize_payment_requests
      WHERE id = (
        SELECT (payload ->> 'requestId')::uuid
        FROM payout_results WHERE key = 'cancel-create'
      )
    )
    AND
    (
      SELECT count(*) FROM public.tournament_prize_payments
      WHERE tournament_id = md5('tour-cancel')::uuid AND status = 'paid'
    ) = 0
  ),
  'cancel-vs-approve resolves to one terminal state'
);

-- Terminal requests cannot be reopened, even by a direct database owner.
DO $terminal$
BEGIN
  BEGIN
    UPDATE public.tournament_prize_payment_requests
    SET status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL,
        decision_reason = NULL,
        payment_id = NULL
    WHERE id = (
      SELECT id
      FROM public.tournament_prize_payment_requests
      WHERE status = 'approved'
      ORDER BY id
      LIMIT 1
    );
    RAISE EXCEPTION 'terminal request unexpectedly reopened';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'terminal request unexpectedly reopened' THEN
      RAISE;
    END IF;
  END;
END;
$terminal$;

SELECT public.floor_payout_test_assert(
  NOT has_function_privilege(
    'authenticated',
    'vinpoker_private.record_prize_payment_internal(uuid,integer,uuid,text,text,text,uuid,text)',
    'EXECUTE'
  ),
  'private ledger writer is not executable by authenticated'
);
CREATE TEMP TABLE payout_rpc_acl (
  signature text PRIMARY KEY,
  authenticated_exec boolean NOT NULL,
  service_exec boolean NOT NULL
);
INSERT INTO payout_rpc_acl(signature, authenticated_exec, service_exec)
VALUES
  ('public.set_floor_payout_request_grant(uuid,uuid,boolean)', true, false),
  ('public.list_floor_payout_request_grants(uuid)', true, false),
  ('public.get_floor_payout_requestable_places(uuid)', true, false),
  ('public.create_tournament_prize_payment_request(uuid,integer,text,text,text,text)', true, false),
  ('public.cancel_tournament_prize_payment_request(uuid)', true, false),
  ('public.list_tournament_prize_payment_requests(uuid,text)', true, false),
  ('public.review_tournament_prize_payment_request(uuid,text,text)', true, false),
  ('public.record_tournament_prize_payment(uuid,integer,text,text,text)', true, false),
  ('public.cleanup_floor_payout_request_fixture(uuid,uuid[],uuid[],uuid[],uuid[],uuid[])', false, true);

DO $acl$
DECLARE
  check_row record;
BEGIN
  FOR check_row IN SELECT * FROM payout_rpc_acl LOOP
    IF has_function_privilege('authenticated', check_row.signature, 'EXECUTE')
      IS DISTINCT FROM check_row.authenticated_exec
    THEN
      RAISE EXCEPTION 'unexpected authenticated EXECUTE ACL: %', check_row.signature;
    END IF;
    IF has_function_privilege('anon', check_row.signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly has EXECUTE: %', check_row.signature;
    END IF;
    IF has_function_privilege('service_role', check_row.signature, 'EXECUTE')
      IS DISTINCT FROM check_row.service_exec
    THEN
      RAISE EXCEPTION 'unexpected service_role EXECUTE ACL: %', check_row.signature;
    END IF;
  END LOOP;
END;
$acl$;

SELECT public.floor_payout_test_assert(
  NOT has_schema_privilege('authenticated', 'vinpoker_private', 'USAGE')
    AND NOT has_schema_privilege('anon', 'vinpoker_private', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'vinpoker_private', 'USAGE'),
  'runtime roles cannot use the private schema'
);
SELECT public.floor_payout_test_assert(
  has_table_privilege(
    'authenticated', 'public.tournament_prize_payment_requests', 'SELECT'
  )
    AND NOT has_table_privilege(
      'authenticated', 'public.tournament_prize_payment_requests', 'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.tournament_prize_payment_requests', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.tournament_prize_payment_requests', 'DELETE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.tournament_prize_payment_requests', 'DELETE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.tournament_prize_payment_request_events', 'DELETE'
    ),
  'tables are SELECT-only for authenticated and have no service-role delete bypass'
);
SELECT public.floor_payout_test_assert(
  NOT EXISTS (
    SELECT 1
    FROM public.tournament_prize_payments
    WHERE status = 'paid'
    GROUP BY tournament_id, finished_place
    HAVING count(*) > 1
  ),
  'ledger has at most one paid row per tournament/place'
);

-- Cleanup refuses to infer grant-event ownership from a reusable actor ID.
-- The exact grant-event ledger must be supplied or nothing is deleted.
CREATE TEMP TABLE cleanup_guard_result(payload jsonb);
GRANT INSERT, SELECT ON cleanup_guard_result TO service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SET ROLE service_role;
INSERT INTO cleanup_guard_result(payload)
SELECT public.cleanup_floor_payout_request_fixture(
  md5('tour-cross')::uuid,
  '{}'::uuid[],
  '{}'::uuid[],
  ARRAY[md5('owner-b')::uuid, md5('floor-b')::uuid],
  ARRAY[md5('floor-b')::uuid],
  '{}'::uuid[]
);
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', false);
SELECT public.floor_payout_test_assert(
  (SELECT payload ->> 'error' FROM cleanup_guard_result)
    = 'cleanup_grant_event_ledger_incomplete'
    AND EXISTS (
      SELECT 1
      FROM public.tournament_prize_payment_request_events
      WHERE request_id IS NULL
        AND club_id = md5('club-b')::uuid
        AND floor_user_id = md5('floor-b')::uuid
    ),
  'cleanup fails closed instead of deleting another run grant history'
);
SELECT set_config('request.jwt.claim.sub', md5('owner-b')::uuid::text, false);
SELECT public.set_floor_payout_request_grant(
  md5('club-b')::uuid, md5('floor-b')::uuid, false
);
SELECT public.floor_payout_test_assert(
  NOT EXISTS (
    SELECT 1
    FROM public.club_floor_payout_request_grants
    WHERE club_id = md5('club-b')::uuid
      AND floor_user_id = md5('floor-b')::uuid
  ),
  'cleanup fixture includes a grant that was already revoked'
);

-- Build exact-ID commands before changing role. Each request/payment command
-- is bound to one immutable TEST tournament and all fixture actors are named
-- with the required TEST prefix.
CREATE TEMP TABLE payout_cleanup_commands (
  sequence integer PRIMARY KEY,
  command text NOT NULL
);
INSERT INTO payout_cleanup_commands(sequence, command)
SELECT
  row_number() OVER (ORDER BY r.tournament_id),
  format(
    $command$
      SELECT public.cleanup_floor_payout_request_fixture(
        %L::uuid,
        %L::uuid[],
        %L::uuid[],
        %L::uuid[],
        '{}'::uuid[],
        '{}'::uuid[]
      )
    $command$,
    r.tournament_id::text,
    array_agg(r.id ORDER BY r.id)::text,
    COALESCE(
      array_agg(DISTINCT r.payment_id) FILTER (WHERE r.payment_id IS NOT NULL),
      '{}'::uuid[]
    )::text,
    ARRAY[
      md5('owner-a')::uuid,
      md5('cashier-a')::uuid,
      md5('floor-a')::uuid,
      md5('owner-floor-a')::uuid
    ]::text
  )
FROM public.tournament_prize_payment_requests r
JOIN public.tournaments t ON t.id = r.tournament_id
WHERE t.club_id = md5('club-a')::uuid
GROUP BY r.tournament_id;

INSERT INTO payout_cleanup_commands(sequence, command)
VALUES
  (
    1000,
    format(
      $command$
        SELECT public.cleanup_floor_payout_request_fixture(
          %L::uuid,
          '{}'::uuid[],
          '{}'::uuid[],
          %L::uuid[],
          %L::uuid[],
          %L::uuid[]
        )
      $command$,
      md5('tour-create')::uuid::text,
      ARRAY[
        md5('owner-a')::uuid,
        md5('cashier-a')::uuid,
        md5('floor-a')::uuid,
        md5('owner-floor-a')::uuid
      ]::text,
      ARRAY[
        md5('floor-a')::uuid,
        md5('owner-floor-a')::uuid
      ]::text,
      ARRAY(
        SELECT e.id
        FROM public.tournament_prize_payment_request_events e
        WHERE e.request_id IS NULL
          AND e.club_id = md5('club-a')::uuid
          AND e.floor_user_id IN (
            md5('floor-a')::uuid,
            md5('owner-floor-a')::uuid
          )
          AND e.event_type IN ('grant_added', 'grant_removed')
        ORDER BY e.id
      )::text
    )
  ),
  (
    1001,
    format(
      $command$
        SELECT public.cleanup_floor_payout_request_fixture(
          %L::uuid,
          '{}'::uuid[],
          '{}'::uuid[],
          %L::uuid[],
          %L::uuid[],
          %L::uuid[]
        )
      $command$,
      md5('tour-cross')::uuid::text,
      ARRAY[
        md5('owner-b')::uuid,
        md5('floor-b')::uuid
      ]::text,
      ARRAY[md5('floor-b')::uuid]::text,
      ARRAY(
        SELECT e.id
        FROM public.tournament_prize_payment_request_events e
        WHERE e.request_id IS NULL
          AND e.club_id = md5('club-b')::uuid
          AND e.floor_user_id = md5('floor-b')::uuid
          AND e.event_type IN ('grant_added', 'grant_removed')
        ORDER BY e.id
      )::text
    )
  );
GRANT SELECT ON payout_cleanup_commands TO service_role;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
SET ROLE service_role;
SELECT command
FROM payout_cleanup_commands
ORDER BY sequence
\gexec
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', false);

SELECT public.floor_payout_test_assert(
  (SELECT count(*) FROM public.tournament_prize_payment_request_events) = 0
    AND
  (SELECT count(*) FROM public.tournament_prize_payment_requests) = 0
    AND
  (SELECT count(*) FROM public.club_floor_payout_request_grants) = 0
    AND
  (SELECT count(*) FROM public.tournament_prize_payments) = 0,
  'service-only exact cleanup leaves zero request/payment/grant/event rows'
);

\echo FLOOR_PAYOUT_DISPOSABLE_DB_PASS
