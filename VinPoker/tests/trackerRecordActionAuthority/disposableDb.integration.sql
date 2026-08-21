\set ON_ERROR_STOP on

-- Local/disposable PostgreSQL only. The workflow applies the shared Tracker
-- baseline, 080 dependencies and the exact hotfix before this synthetic suite.

INSERT INTO auth.users(id) VALUES
  ('a1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000004');

INSERT INTO public.clubs(id, owner_id) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004');
INSERT INTO public.club_trackers(club_id, user_id) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002');
INSERT INTO public.club_floors(club_id, user_id) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003');

INSERT INTO public.tournaments(id, club_id, name, status) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Authority TEST', 'active'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'Other TEST', 'active');
INSERT INTO public.game_tables(id, club_id, table_name) VALUES
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Authority Table'),
  ('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'Other Table');
INSERT INTO public.tournament_tables(id, tournament_id, table_id, table_number, status, table_name, floor_control_mode) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 1, 'active', 'Authority Table', 'tracker'),
  ('a5000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 1, 'active', 'Other Table', 'tracker');

INSERT INTO public.tournament_hands(id, tournament_id, table_id, hand_number, status, created_by) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 1, 'in_progress', 'a1000000-0000-4000-8000-000000000001'),
  ('a6000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 2, 'in_progress', 'a1000000-0000-4000-8000-000000000001');
INSERT INTO public.hand_players(hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 1, 1, 30000, 30000),
  ('a6000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 1, 1, 30000, 30000);

-- The production writer is Security Invoker. These are the narrow table grants
-- its server-authenticated write path needs in this isolated baseline.
GRANT SELECT, UPDATE ON public.tournament_hands TO authenticated;
GRANT SELECT ON public.tournaments, public.hand_players, public.hand_actions TO authenticated;
GRANT INSERT ON public.hand_actions TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;

CREATE OR REPLACE FUNCTION public.tracker_authority_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TRACKER_AUTHORITY_ASSERTION_FAILED: %', p_message;
  END IF;
END;
$$;

-- Unauthenticated and non-Tracker callers produce no action writes.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'authority-unauth-1', 'trace-unauth', NULL
)::TEXT AS payload \gset unauth_
SELECT public.tracker_authority_assert(
  :'unauth_payload'::JSONB->>'error' = 'unauthorized'
  AND (SELECT count(*) = 0 FROM public.hand_actions),
  'unauthenticated record_action is zero-write denied'
);

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'authority-cross-club-1', 'trace-cross', NULL
)::TEXT AS payload \gset cross_club_
SELECT public.tracker_authority_assert(
  :'cross_club_payload'::JSONB->>'error' = 'actor_not_allowed'
  AND (SELECT count(*) = 0 FROM public.hand_actions),
  'cross-club actor is zero-write denied'
);

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'authority-floor-1', 'trace-floor', NULL
)::TEXT AS payload \gset floor_
SELECT public.tracker_authority_assert(
  :'floor_payload'::JSONB->>'error' = 'actor_not_allowed'
  AND (SELECT count(*) = 0 FROM public.hand_actions),
  'Floor has no direct record_action authority'
);

-- No lock means no action. A null p_user_id is only ABI compatibility: claim
-- and action are still attributed to auth.uid().
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'authority-no-lock-1', 'trace-no-lock', NULL
)::TEXT AS payload \gset no_lock_
SELECT public.tracker_authority_assert(
  :'no_lock_payload'::JSONB->>'error' = 'tracker_lock_required'
  AND (SELECT count(*) = 0 FROM public.hand_actions),
  'record_action never claims a missing lock'
);

SELECT public.heartbeat_lock('a6000000-0000-4000-8000-000000000001', NULL)::TEXT AS payload \gset claim_
SELECT public.tracker_authority_assert(
  :'claim_payload'::JSONB->>'status' = 'success'
  AND (:'claim_payload'::JSONB->>'locked_by')::UUID = 'a1000000-0000-4000-8000-000000000001'
  AND (SELECT locked_by_user_id = 'a1000000-0000-4000-8000-000000000001'::UUID FROM public.tournament_hands WHERE id = 'a6000000-0000-4000-8000-000000000001'),
  'null p_user_id claims only for auth.uid'
);
CREATE TEMP TABLE tracker_authority_lock_snapshot AS
SELECT locked_by_user_id, locked_at FROM public.tournament_hands WHERE id = 'a6000000-0000-4000-8000-000000000001';
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'authority-self-1', 'trace-self', NULL
)::TEXT AS payload \gset self_
SELECT public.tracker_authority_assert(
  :'self_payload'::JSONB->>'status' = 'success'
  AND (SELECT count(*) = 1 FROM public.hand_actions)
  AND (SELECT h.locked_by_user_id = s.locked_by_user_id AND h.locked_at = s.locked_at FROM public.tournament_hands h CROSS JOIN tracker_authority_lock_snapshot s WHERE h.id = 'a6000000-0000-4000-8000-000000000001'),
  'fresh self lock succeeds without record_action refreshing or rewriting the lock'
);

SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'authority-self-1', 'trace-self-retry', NULL
)::TEXT AS payload \gset retry_
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'call', 1, 1, 'preflop', 10, 'authority-self-1', 'trace-self-mismatch', NULL
)::TEXT AS payload \gset retry_mismatch_
SELECT public.tracker_authority_assert(
  (:'retry_payload'::JSONB->>'duplicate')::BOOLEAN
  AND :'retry_mismatch_payload'::JSONB->>'error' = 'idempotency_key_conflict'
  AND (SELECT count(*) = 1 FROM public.hand_actions),
  'same-key retry is stable and changed payload is rejected'
);

SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 2, 1, 'preflop', 0, 'authority-mismatch-1', 'trace-mismatch',
  'a1000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset actor_mismatch_
SELECT public.tracker_authority_assert(
  :'actor_mismatch_payload'::JSONB->>'error' = 'actor_mismatch'
  AND (SELECT count(*) = 1 FROM public.hand_actions),
  'arbitrary p_user_id cannot impersonate another tracker'
);

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 2, 1, 'preflop', 0, 'authority-other-1', 'trace-other', NULL
)::TEXT AS payload \gset other_fresh_
SELECT public.tracker_authority_assert(
  :'other_fresh_payload'::JSONB->>'error' = 'tracker_lock_owned_by_another'
  AND (SELECT count(*) = 1 FROM public.hand_actions),
  'fresh lock held by another tracker is zero-write denied'
);

RESET ROLE;
UPDATE public.tournament_hands SET locked_at = now() - interval '6 minutes'
WHERE id = 'a6000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 2, 1, 'preflop', 0, 'authority-stale-1', 'trace-stale', NULL
)::TEXT AS payload \gset stale_
SELECT public.tracker_authority_assert(
  :'stale_payload'::JSONB->>'error' = 'tracker_lock_expired'
  AND (SELECT count(*) = 1 FROM public.hand_actions),
  'stale lock never becomes an implicit action claim'
);

RESET ROLE;
UPDATE public.tournament_hands
SET locked_by_user_id = 'a1000000-0000-4000-8000-000000000001', locked_at = NULL
WHERE id = 'a6000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', false);
SELECT public.record_action(
  'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
  'check', 2, 1, 'preflop', 0, 'authority-ambiguous-1', 'trace-ambiguous', NULL
)::TEXT AS payload \gset ambiguous_
SELECT public.tracker_authority_assert(
  :'ambiguous_payload'::JSONB->>'error' = 'tracker_lock_ambiguous'
  AND (SELECT count(*) = 1 FROM public.hand_actions),
  'null locked_at is fail-closed with zero action writes'
);

-- Real concurrent same-key callbacks serialize on the exact hand row. One write
-- is inserted and the second returns the cached receipt; neither changes the lock.
RESET ROLE;
UPDATE public.tournament_hands
SET locked_by_user_id = 'a1000000-0000-4000-8000-000000000001', locked_at = now()
WHERE id = 'a6000000-0000-4000-8000-000000000002';
CREATE OR REPLACE FUNCTION public.tracker_authority_action_race()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
  RETURN public.record_action(
    'a6000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001',
    'check', 1, 1, 'preflop', 0, 'authority-race-1', 'trace-race', NULL
  );
END;
$$;
CREATE TEMP TABLE tracker_authority_race_results(payload JSONB);
SELECT dblink_connect('authority_a', 'dbname=' || current_database());
SELECT dblink_connect('authority_b', 'dbname=' || current_database());
SELECT dblink_send_query('authority_a', $$SELECT public.tracker_authority_action_race()::TEXT$$);
SELECT dblink_send_query('authority_b', $$SELECT public.tracker_authority_action_race()::TEXT$$);
INSERT INTO tracker_authority_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('authority_a') AS t(result TEXT);
INSERT INTO tracker_authority_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('authority_b') AS t(result TEXT);
SELECT dblink_disconnect('authority_a');
SELECT dblink_disconnect('authority_b');
SELECT public.tracker_authority_assert(
  (SELECT count(*) = 2 FROM tracker_authority_race_results WHERE payload->>'status' = 'success')
  AND (SELECT count(*) = 1 FROM tracker_authority_race_results WHERE COALESCE((payload->>'duplicate')::BOOLEAN, false))
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = 'a6000000-0000-4000-8000-000000000002'),
  'concurrent duplicate callback yields one insert and one cached receipt'
);

DROP FUNCTION public.tracker_authority_action_race();
RESET ROLE;
SELECT 'TRACKER_RECORD_ACTION_AUTHORITY_DISPOSABLE_DB_PASS' AS result;
