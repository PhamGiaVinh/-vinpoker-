\set ON_ERROR_STOP on

-- Disposable local actor-matrix test. Never run against the linked production project.
BEGIN;

-- Fixture setup runs as the local database owner. Every authorization assertion
-- below switches to the actual anon/authenticated database role.
DO $fixture$
DECLARE
  v_owner uuid := '9a000000-0000-4000-8000-000000000001';
  v_owner_b uuid := '9a000000-0000-4000-8000-000000000002';
  v_super uuid := '9a000000-0000-4000-8000-000000000003';
  v_manager uuid := '9a000000-0000-4000-8000-000000000004';
  v_ordinary uuid := '9a000000-0000-4000-8000-000000000005';
  v_outsider_admin uuid := '9a000000-0000-4000-8000-000000000006';
  v_club_a uuid := '9b000000-0000-4000-8000-000000000001';
  v_club_b uuid := '9b000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (v_owner, 'authenticated', 'authenticated', 'digest-owner-a@test.invalid', now(), now()),
    (v_owner_b, 'authenticated', 'authenticated', 'digest-owner-b@test.invalid', now(), now()),
    (v_super, 'authenticated', 'authenticated', 'digest-super@test.invalid', now(), now()),
    (v_manager, 'authenticated', 'authenticated', 'digest-manager@test.invalid', now(), now()),
    (v_ordinary, 'authenticated', 'authenticated', 'digest-ordinary@test.invalid', now(), now()),
    (v_outsider_admin, 'authenticated', 'authenticated', 'digest-outsider-admin@test.invalid', now(), now());

  UPDATE public.profiles SET display_name = CASE user_id
    WHEN v_owner THEN 'Owner A'
    WHEN v_owner_b THEN 'Owner B'
    WHEN v_super THEN 'Super Admin'
    WHEN v_manager THEN 'Quản lý đã chuẩn bị'
    WHEN v_ordinary THEN 'Người dùng thường'
    ELSE 'Admin ngoài phạm vi'
  END
  WHERE user_id IN (v_owner, v_owner_b, v_super, v_manager, v_ordinary, v_outsider_admin);

  INSERT INTO public.user_roles (user_id, role)
  VALUES
    (v_super, 'super_admin'),
    (v_manager, 'club_admin'),
    (v_outsider_admin, 'club_admin');

  INSERT INTO public.clubs (id, owner_id, name, region, status)
  VALUES
    (v_club_a, v_owner, 'Digest Actor Matrix A', 'TEST', 'approved'),
    (v_club_b, v_owner_b, 'Digest Actor Matrix B', 'TEST', 'approved');
  INSERT INTO public.club_settings (club_id, timezone)
  VALUES (v_club_a, 'Asia/Bangkok'), (v_club_b, 'Asia/Bangkok');
  INSERT INTO private.owner_daily_digest_settings_v2 (club_id, manager_access_enabled)
  VALUES (v_club_a, true), (v_club_b, true);

  IF private.generate_owner_daily_digest_snapshot_v2(
    v_club_a, '2026-08-01', 'MANUAL', v_owner, NULL, 'actor matrix snapshot'
  ) IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: fixture snapshot generation failed';
  END IF;

  IF has_function_privilege('anon', 'public.list_owner_daily_digest_clubs_v2()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: anon retains EXECUTE on V2 list RPC';
  END IF;
  IF has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_table_privilege('authenticated', 'private.owner_daily_digest_manager_events_v2', 'SELECT')
     OR has_table_privilege('authenticated', 'private.owner_daily_digest_manager_events_v2', 'INSERT') THEN
    RAISE EXCEPTION 'TEST_FAIL: authenticated retains direct private-ledger privilege';
  END IF;
END;
$fixture$;

-- Real authenticated Owner/Super Admin/Manager/outsider actor matrix.
SET LOCAL ROLE authenticated;
DO $authenticated_matrix$
DECLARE
  v_owner uuid := '9a000000-0000-4000-8000-000000000001';
  v_super uuid := '9a000000-0000-4000-8000-000000000003';
  v_manager uuid := '9a000000-0000-4000-8000-000000000004';
  v_ordinary uuid := '9a000000-0000-4000-8000-000000000005';
  v_outsider_admin uuid := '9a000000-0000-4000-8000-000000000006';
  v_club_a uuid := '9b000000-0000-4000-8000-000000000001';
  v_club_b uuid := '9b000000-0000-4000-8000-000000000002';
  v_payload jsonb;
  v_event uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Owner can read only their Club and cannot prepare arbitrary candidates.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_payload := public.get_owner_daily_digest_snapshot_v2(v_club_a, '2026-08-01');
  IF v_payload #>> '{snapshot,club_id}' <> v_club_a::text
     OR v_payload #>> '{snapshot,schema_version}' <> '2' THEN
    RAISE EXCEPTION 'TEST_FAIL: Owner did not receive canonical V2 snapshot';
  END IF;
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_b, NULL);
    RAISE EXCEPTION 'TEST_FAIL: Owner crossed Club boundary';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.prepare_owner_daily_digest_manager_candidate_v2(v_club_a, v_manager, 'OWNER_FORGE');
    RAISE EXCEPTION 'TEST_FAIL: Owner prepared a candidate without Super Admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.grant_owner_daily_digest_manager_v2(v_club_a, v_ordinary, 'OWNER_UI');
    RAISE EXCEPTION 'TEST_FAIL: ordinary user was promoted through Digest grant';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Super Admin prepares one existing Club Admin; Owner grants it idempotently.
  PERFORM set_config('request.jwt.claim.sub', v_super::text, true);
  v_event := public.prepare_owner_daily_digest_manager_candidate_v2(v_club_a, v_manager, 'SUPER_ADMIN_UI');
  IF v_event IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: candidate preparation failed'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF (SELECT count(*) FROM public.list_assignable_owner_daily_digest_managers_v2(v_club_a)) <> 1
     OR EXISTS (
       SELECT 1 FROM public.list_assignable_owner_daily_digest_managers_v2(v_club_a)
       WHERE user_id <> v_manager OR display_name IS NULL OR short_identifier IS NULL
     ) THEN
    RAISE EXCEPTION 'TEST_FAIL: candidate discovery leaked or omitted candidates';
  END IF;
  v_event := public.grant_owner_daily_digest_manager_v2(v_club_a, v_manager, 'OWNER_UI');
  IF v_event IS NULL OR public.grant_owner_daily_digest_manager_v2(v_club_a, v_manager, 'OWNER_UI') <> v_event THEN
    RAISE EXCEPTION 'TEST_FAIL: duplicate grant was not idempotent';
  END IF;

  -- An unrelated global Club Admin still has no access.
  PERFORM set_config('request.jwt.claim.sub', v_outsider_admin::text, true);
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
    RAISE EXCEPTION 'TEST_FAIL: global Club Admin read without Club scope';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- The granted Manager reads only Club A; V2 grant also preserves the live V1 boundary.
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  v_payload := public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
  IF v_payload #>> '{snapshot,club_id}' <> v_club_a::text
     OR NOT public.can_read_owner_daily_digest(v_manager, v_club_a) THEN
    RAISE EXCEPTION 'TEST_FAIL: scoped Manager did not receive both V1 and V2 access';
  END IF;
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_b, NULL);
    RAISE EXCEPTION 'TEST_FAIL: Manager changed URL to another Club';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- V1 revoke/grant after the seed must immediately mirror into V2.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.revoke_owner_daily_digest_club_admin_scope(v_club_a, v_manager);
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
    RAISE EXCEPTION 'TEST_FAIL: V1 revoke did not revoke V2 access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.grant_owner_daily_digest_club_admin_scope(v_club_a, v_manager);
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);

  -- A brand-new V1 grant after migration also enters V2, then revoke removes it.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.grant_owner_daily_digest_club_admin_scope(v_club_a, v_outsider_admin);
  PERFORM set_config('request.jwt.claim.sub', v_outsider_admin::text, true);
  PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.revoke_owner_daily_digest_club_admin_scope(v_club_a, v_outsider_admin);
  PERFORM set_config('request.jwt.claim.sub', v_outsider_admin::text, true);
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
    RAISE EXCEPTION 'TEST_FAIL: post-migration V1 revoke left stale V2 access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_matrix$;
RESET ROLE;

-- Removing the canonical role must take effect even with the same JWT subject.
-- The Owner must still be able to revoke the dormant ledger grant while the
-- role is absent; restoring the global role must not resurrect Club access.
DELETE FROM public.user_roles
WHERE user_id = '9a000000-0000-4000-8000-000000000004' AND role = 'club_admin';
SET LOCAL ROLE authenticated;
DO $stale_role$
DECLARE
  v_owner uuid := '9a000000-0000-4000-8000-000000000001';
  v_manager uuid := '9a000000-0000-4000-8000-000000000004';
  v_club_a uuid := '9b000000-0000-4000-8000-000000000001';
  v_revoke_event uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
    RAISE EXCEPTION 'TEST_FAIL: revoked role remained authorized with stale JWT';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_revoke_event := public.revoke_owner_daily_digest_manager_v2(
    v_club_a, v_manager, 'OWNER_UI'
  );
  IF v_revoke_event IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: Owner could not revoke dormant ledger grant';
  END IF;
END;
$stale_role$;
RESET ROLE;
INSERT INTO public.user_roles (user_id, role)
VALUES ('9a000000-0000-4000-8000-000000000004', 'club_admin');

SET LOCAL ROLE authenticated;
DO $restored_role_stays_revoked$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000004', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(
      '9b000000-0000-4000-8000-000000000001', NULL
    );
    RAISE EXCEPTION 'TEST_FAIL: restored role resurrected a revoked Club grant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$restored_role_stays_revoked$;
RESET ROLE;

-- V2 revoke mirrors back to V1 and Owner-only regeneration remains idempotent.
SET LOCAL ROLE authenticated;
DO $revoke_and_regenerate$
DECLARE
  v_owner uuid := '9a000000-0000-4000-8000-000000000001';
  v_manager uuid := '9a000000-0000-4000-8000-000000000004';
  v_club_a uuid := '9b000000-0000-4000-8000-000000000001';
  v_event uuid;
  v_request_1 jsonb;
  v_request_2 jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_event := public.revoke_owner_daily_digest_manager_v2(v_club_a, v_manager, 'OWNER_UI');
  IF v_event IS NULL OR public.revoke_owner_daily_digest_manager_v2(v_club_a, v_manager, 'OWNER_UI') <> v_event THEN
    RAISE EXCEPTION 'TEST_FAIL: V2 revoke was not idempotent';
  END IF;

  v_request_1 := public.request_owner_daily_digest_regeneration_v2(
    v_club_a, '2026-08-01', '9c000000-0000-4000-8000-000000000001', 'OWNER_UI_REGENERATION'
  );
  v_request_2 := public.request_owner_daily_digest_regeneration_v2(
    v_club_a, '2026-08-01', '9c000000-0000-4000-8000-000000000001', 'OWNER_UI_REGENERATION'
  );
  IF v_request_1 #>> '{request_id}' IS NULL
     OR v_request_1 #>> '{request_id}' <> v_request_2 #>> '{request_id}'
     OR v_request_1 #>> '{status}' <> 'PENDING' THEN
    RAISE EXCEPTION 'TEST_FAIL: regeneration request was not durable/idempotent';
  END IF;
  BEGIN
    PERFORM public.request_owner_daily_digest_regeneration_v2(
      v_club_a, ((clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date),
      '9c000000-0000-4000-8000-000000000002', 'OWNER_UI_REGENERATION'
    );
    RAISE EXCEPTION 'TEST_FAIL: open business day regeneration was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  IF public.can_read_owner_daily_digest(v_manager, v_club_a) THEN
    RAISE EXCEPTION 'TEST_FAIL: V2 revoke left the V1 scope active';
  END IF;
  BEGIN
    PERFORM public.get_owner_daily_digest_snapshot_v2(v_club_a, NULL);
    RAISE EXCEPTION 'TEST_FAIL: revoked V2 scope remained authorized';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$revoke_and_regenerate$;
RESET ROLE;

-- Even the database owner cannot erase append-only audit history through DML.
DO $immutable_ledger$
DECLARE
  v_event uuid;
BEGIN
  SELECT event_id INTO v_event
  FROM private.owner_daily_digest_manager_events_v2
  ORDER BY event_sequence DESC LIMIT 1;
  BEGIN
    DELETE FROM private.owner_daily_digest_manager_events_v2 WHERE event_id = v_event;
    RAISE EXCEPTION 'TEST_FAIL: manager event ledger was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM information_schema.parameters p
    WHERE p.specific_schema = 'public'
      AND p.specific_name LIKE 'list\_assignable\_owner\_daily\_digest\_managers\_v2%'
      AND p.parameter_name IN ('email', 'phone')
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: manager discovery exposes PII columns';
  END IF;
END;
$immutable_ledger$;

ROLLBACK;

SELECT 'OWNER_DAILY_DIGEST_REPORT_ACCESS_V2_PASS' AS result;
