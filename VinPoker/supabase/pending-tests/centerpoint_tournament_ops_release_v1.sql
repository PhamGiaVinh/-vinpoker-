-- Disposable Postgres only. Apply the base gate migration first.
-- This verifies gate defaults, service-only configuration access, and the
-- private assertion contract. Consumer write-path tests belong with the later
-- TV/Satellite integration migration because those tables are not in this slice.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_message text;
BEGIN
  IF (SELECT count(*) FROM public.centerpoint_tournament_ops_release) <> 1
     OR (SELECT enabled FROM public.centerpoint_tournament_ops_release WHERE id)
     IS DISTINCT FROM false
     OR (SELECT allowed_club_ids FROM public.centerpoint_tournament_ops_release WHERE id)
     IS DISTINCT FROM '{}'::uuid[] THEN
    RAISE EXCEPTION 'centerpoint gate must seed exactly one disabled, empty row';
  END IF;

  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.centerpoint_tournament_ops_release', 'SELECT,INSERT,UPDATE,DELETE'
     ) OR pg_catalog.has_table_privilege(
       'anon', 'public.centerpoint_tournament_ops_release', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'client role has direct gate table access';
  END IF;
  IF pg_catalog.has_function_privilege(
       'authenticated', 'centerpoint_private.assert_tournament_ops_release_v1(uuid)', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon', 'centerpoint_private.assert_tournament_ops_release_v1(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'client role can execute the private assertion';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
       'service_role', 'public.centerpoint_tournament_ops_release', 'SELECT,UPDATE'
     ) THEN
    RAISE EXCEPTION 'service role cannot read and update the gate record';
  END IF;

  IF centerpoint_private.tournament_ops_release_allowed_v1(
       'c1000000-0000-4000-8000-000000000001'
     ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'disabled gate allowed a club';
  END IF;
  BEGIN
    PERFORM centerpoint_private.assert_tournament_ops_release_v1(
      'c1000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'disabled gate assertion unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN
      RAISE;
    END IF;
  END;
END
$test$;

SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  BEGIN
    UPDATE public.centerpoint_tournament_ops_release
    SET enabled = true;
    RAISE EXCEPTION 'authenticated role changed the gate while it was disabled';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$test$;
RESET ROLE;

-- Simulate the owner-controlled server configuration on a disposable database.
UPDATE public.centerpoint_tournament_ops_release
SET enabled = true,
    allowed_club_ids = ARRAY['c1000000-0000-4000-8000-000000000001'::uuid];

DO $test$
DECLARE
  v_message text;
BEGIN
  IF centerpoint_private.tournament_ops_release_allowed_v1(
       'c1000000-0000-4000-8000-000000000001'
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'enabled gate did not allow the listed club';
  END IF;
  IF centerpoint_private.tournament_ops_release_allowed_v1(
       'c1000000-0000-4000-8000-000000000002'
     ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'enabled gate allowed a club outside the allowlist';
  END IF;
  BEGIN
    PERFORM centerpoint_private.assert_tournament_ops_release_v1(
      'c1000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'non-allowlisted club passed the assertion';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN
      RAISE;
    END IF;
  END;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(
    'c1000000-0000-4000-8000-000000000001'
  );
END
$test$;

-- The base gate installs no trigger on existing production writer tables.
DO $test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS tr
    JOIN pg_catalog.pg_class AS rel ON rel.oid = tr.tgrelid
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = rel.relnamespace
    WHERE NOT tr.tgisinternal
      AND tr.tgname LIKE 'trg_centerpoint_%'
      AND ns.nspname = 'public'
      AND rel.relname IN (
        'tournaments', 'tournament_entries', 'tournament_seats',
        'tournament_registrations'
      )
  ) THEN
    RAISE EXCEPTION 'base gate unexpectedly guards an existing production writer';
  END IF;
END
$test$;

ROLLBACK;
