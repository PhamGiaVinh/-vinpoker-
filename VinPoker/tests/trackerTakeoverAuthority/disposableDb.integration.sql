\set ON_ERROR_STOP on

-- Local/disposable PostgreSQL only. The workflow creates the current-schema
-- baseline and shared lock helpers before applying the exact P0 migration.

INSERT INTO auth.users(id) VALUES
  ('c1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000002'),
  ('c1000000-0000-4000-8000-000000000003'),
  ('c1000000-0000-4000-8000-000000000004');

INSERT INTO public.clubs(id, owner_id) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004');
INSERT INTO public.club_trackers(club_id, user_id) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004');
INSERT INTO public.club_floors(club_id, user_id) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003');

INSERT INTO public.tournaments(id, club_id, name, status) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Takeover TEST', 'active'),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'Other TEST', 'active');
INSERT INTO public.tournament_hands(id, tournament_id, table_id, hand_number, status, is_voided, locked_by_user_id, locked_at) VALUES
  ('c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 1, 'in_progress', false, NULL, NULL),
  ('c4000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', 1, 'in_progress', false, NULL, NULL),
  ('c4000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 2, 'voided', true, NULL, NULL),
  ('c4000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 3, 'in_progress', false, NULL, NULL);
INSERT INTO public.tournament_chip_counts(tournament_id, player_id, entry_number, chip_count) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 1, 30000);

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.takeover_hand_lock(uuid,boolean,uuid)'::regprocedure, 'EXECUTE'), 'anon can take over';
  ASSERT NOT has_function_privilege('service_role', 'public.takeover_hand_lock(uuid,boolean,uuid)'::regprocedure, 'EXECUTE'), 'service role can take over';
  ASSERT has_function_privilege('authenticated', 'public.takeover_hand_lock(uuid,boolean,uuid)'::regprocedure, 'EXECUTE'), 'authenticated cannot call guarded takeover';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid='public.takeover_hand_lock(uuid,boolean,uuid)'::regprocedure), 'takeover is not SECURITY DEFINER';
  ASSERT (SELECT array_to_string(proconfig, ',') = 'search_path=public' FROM pg_proc WHERE oid='public.takeover_hand_lock(uuid,boolean,uuid)'::regprocedure), 'takeover search_path regressed';
END $$;

-- No authenticated subject and a spoofed actor both fail without changing the lock.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', false, NULL)::TEXT AS payload \gset unauth_
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', false, 'c1000000-0000-4000-8000-000000000002')::TEXT AS payload \gset spoof_
RESET ROLE;
SELECT public.tracker_test_assert(
  :'unauth_payload'::JSONB->>'error' = 'unauthenticated'
  AND :'spoof_payload'::JSONB->>'error' = 'actor_mismatch'
  AND (SELECT locked_by_user_id IS NULL FROM public.tournament_hands WHERE id='c4000000-0000-4000-8000-000000000001'),
  'unauthenticated and spoofed callers are zero-write denied'
);

-- Cross-club access is denied before the lock changes.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', false, NULL)::TEXT AS payload \gset cross_
RESET ROLE;
SELECT public.tracker_test_assert(
  :'cross_payload'::JSONB->>'error' = 'actor_not_authorized'
  AND (SELECT locked_by_user_id IS NULL FROM public.tournament_hands WHERE id='c4000000-0000-4000-8000-000000000001'),
  'cross-club tracker is zero-write denied'
);

-- A tracker takes an unowned lock. Another tracker cannot displace a fresh lock.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', false, NULL)::TEXT AS payload \gset self_
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', false, NULL)::TEXT AS payload \gset fresh_
RESET ROLE;
SELECT public.tracker_test_assert(
  :'self_payload'::JSONB->>'ok' = 'true'
  AND :'fresh_payload'::JSONB->>'error' = 'lock_fresh'
  AND (SELECT locked_by_user_id = 'c1000000-0000-4000-8000-000000000001'::UUID FROM public.tournament_hands WHERE id='c4000000-0000-4000-8000-000000000001'),
  'fresh lock remains bound to its authenticated owner'
);

-- A stale lock can be taken by another tracker, but force remains Floor-only.
UPDATE public.tournament_hands
SET locked_at = now() - interval '6 minutes'
WHERE id='c4000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', false, NULL)::TEXT AS payload \gset stale_
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', true, NULL)::TEXT AS payload \gset force_tracker_
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', false);
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000001', true, NULL)::TEXT AS payload \gset force_floor_
SELECT public.takeover_hand_lock('c4000000-0000-4000-8000-000000000003', false, NULL)::TEXT AS payload \gset voided_
RESET ROLE;
SELECT public.tracker_test_assert(
  :'stale_payload'::JSONB->>'ok' = 'true'
  AND :'force_tracker_payload'::JSONB->>'error' = 'force_requires_floor'
  AND :'force_floor_payload'::JSONB->>'ok' = 'true'
  AND :'voided_payload'::JSONB->>'error' = 'hand_not_in_progress'
  AND (SELECT locked_by_user_id = 'c1000000-0000-4000-8000-000000000003'::UUID FROM public.tournament_hands WHERE id='c4000000-0000-4000-8000-000000000001'),
  'stale and Floor force semantics preserve authenticated ownership'
);

-- Two concurrent trackers serialize on the same hand row: one acquires, one sees fresh lock.
CREATE OR REPLACE FUNCTION public.tracker_takeover_authority_race(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, true);
  RETURN public.takeover_hand_lock('c4000000-0000-4000-8000-000000000004', false, p_actor);
END;
$$;
CREATE TEMP TABLE tracker_takeover_race_results(payload jsonb);
SELECT dblink_connect('takeover_a', 'dbname=' || current_database());
SELECT dblink_connect('takeover_b', 'dbname=' || current_database());
SELECT dblink_send_query('takeover_a', $$SELECT public.tracker_takeover_authority_race('c1000000-0000-4000-8000-000000000001')::TEXT$$);
SELECT dblink_send_query('takeover_b', $$SELECT public.tracker_takeover_authority_race('c1000000-0000-4000-8000-000000000002')::TEXT$$);
INSERT INTO tracker_takeover_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('takeover_a') AS t(result TEXT);
INSERT INTO tracker_takeover_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('takeover_b') AS t(result TEXT);
SELECT dblink_disconnect('takeover_a');
SELECT dblink_disconnect('takeover_b');
SELECT public.tracker_test_assert(
  (SELECT count(*) = 1 FROM tracker_takeover_race_results WHERE payload->>'ok' = 'true')
  AND (SELECT count(*) = 1 FROM tracker_takeover_race_results WHERE payload->>'error' = 'lock_fresh')
  AND (SELECT locked_by_user_id IN ('c1000000-0000-4000-8000-000000000001'::UUID, 'c1000000-0000-4000-8000-000000000002'::UUID) FROM public.tournament_hands WHERE id='c4000000-0000-4000-8000-000000000004'),
  'concurrent takeover has one authenticated owner and no dual success'
);
DROP FUNCTION public.tracker_takeover_authority_race(uuid);

SELECT public.tracker_test_assert(
  (SELECT count(*) = 0 FROM public.hand_actions)
  AND (SELECT chip_count = 30000 FROM public.tournament_chip_counts WHERE tournament_id='c3000000-0000-4000-8000-000000000001'),
  'takeover mutates no actions or chip projections'
);

SELECT jsonb_build_object(
  'status', 'PASS',
  'auth_bound_takeover', true,
  'acl_hardened', true,
  'cross_club_zero_write', true,
  'concurrent_takeover_serialized', true,
  'no_action_or_chip_mutation', true
) AS tracker_takeover_authority;
