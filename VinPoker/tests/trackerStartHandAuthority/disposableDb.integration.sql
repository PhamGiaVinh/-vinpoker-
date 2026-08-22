\set ON_ERROR_STOP on

-- Local/disposable PostgreSQL only. The workflow applies the current legacy
-- start function, takeover function, this hotfix, then 12004 before this suite.

INSERT INTO auth.users(id) VALUES
  ('b1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000004');

INSERT INTO public.clubs(id, owner_id) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004');
INSERT INTO public.club_trackers(club_id, user_id) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004');
INSERT INTO public.club_floors(club_id, user_id) VALUES
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003');

INSERT INTO public.tournaments(id, club_id, name, status) VALUES
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Start authority TEST', 'active'),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Other club TEST', 'active');
INSERT INTO public.game_tables(id, club_id, table_name) VALUES
  ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Start one'),
  ('b4000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'Start two'),
  ('b4000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'Start three'),
  ('b4000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000001', 'Start race'),
  ('b4000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000002', 'Other table');
INSERT INTO public.tournament_tables(id, tournament_id, table_id, table_number, status, table_name, floor_control_mode) VALUES
  ('b5000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 1, 'active', 'Start one', 'tracker'),
  ('b5000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000002', 2, 'active', 'Start two', 'tracker'),
  ('b5000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000003', 3, 'active', 'Start three', 'tracker'),
  ('b5000000-0000-4000-8000-000000000004', 'b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000004', 4, 'active', 'Start race', 'tracker'),
  ('b5000000-0000-4000-8000-000000000005', 'b3000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000005', 1, 'active', 'Other table', 'tracker');

INSERT INTO public.tournament_seats(
  id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status
) VALUES
  ('b6000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 1, 'b5000000-0000-4000-8000-000000000001', 1, 30000, true, 'seated'),
  ('b6000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 1, 'b5000000-0000-4000-8000-000000000001', 2, 30000, true, 'seated');
INSERT INTO public.tournament_chip_counts(tournament_id, player_id, entry_number, chip_count) VALUES
  ('b3000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 1, 30000),
  ('b3000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 1, 30000);

GRANT SELECT ON public.tournaments, public.tournament_tables, public.tournament_seats, public.tournament_chip_counts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tournament_hands TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.hand_players TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.hand_actions TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;

CREATE OR REPLACE FUNCTION public.tracker_start_authority_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TRACKER_START_AUTHORITY_ASSERTION_FAILED: %', p_message;
  END IF;
END;
$$;

-- The minimal baseline intentionally omits card validation. This stub only
-- exercises the auth-bound writer's successful path; card validation itself is
-- covered by its dedicated Tracker suite.
CREATE OR REPLACE FUNCTION public.validate_cards(p_cards JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT 'ok'::TEXT $$;

SELECT public.tracker_start_authority_assert(
  NOT has_function_privilege('anon', 'public.start_hand(uuid,uuid,integer,timestamp with time zone,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_community_cards(uuid,jsonb,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.show_hole_cards(uuid,jsonb,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.delete_last_action(uuid,uuid)', 'EXECUTE'),
  'anon cannot execute protected hand writers'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 1, now(), NULL, 1
)::TEXT AS payload \gset unauth_
SELECT public.tracker_start_authority_assert(
  :'unauth_payload'::JSONB->>'error' = 'unauthenticated'
  AND (SELECT count(*) = 0 FROM public.tournament_hands),
  'unauthenticated start is zero-write denied'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000004', false);
SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 1, now(), NULL, 1
)::TEXT AS payload \gset cross_club_
SELECT public.tracker_start_authority_assert(
  :'cross_club_payload'::JSONB->>'error' = 'actor_not_allowed'
  AND (SELECT count(*) = 0 FROM public.tournament_hands),
  'cross-club tracker is zero-write denied'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000003', false);
SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 1, now(), NULL, 1
)::TEXT AS payload \gset floor_
SELECT public.tracker_start_authority_assert(
  :'floor_payload'::JSONB->>'error' = 'actor_not_allowed'
  AND (SELECT count(*) = 0 FROM public.tournament_hands),
  'same-club Floor cannot start a tracker hand'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', false);
SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 1, now(),
  'b1000000-0000-4000-8000-000000000002', 1
)::TEXT AS payload \gset forged_
SELECT public.tracker_start_authority_assert(
  :'forged_payload'::JSONB->>'error' = 'actor_mismatch'
  AND (SELECT count(*) = 0 FROM public.tournament_hands),
  'forged created_by is zero-write denied'
);

SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 1, now(),
  'b1000000-0000-4000-8000-000000000001', 1
)::TEXT AS payload \gset self_
SELECT public.tracker_start_authority_assert(
  :'self_payload'::JSONB->>'status' = 'success'
  AND (SELECT locked_by_user_id = 'b1000000-0000-4000-8000-000000000001'::UUID
       AND created_by = 'b1000000-0000-4000-8000-000000000001'::UUID
       AND locked_at IS NOT NULL
       FROM public.tournament_hands WHERE id = (:'self_payload'::JSONB->>'hand_id')::UUID),
  'self identity creates an auth-bound lock'
);

SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002', 1, now(), NULL, 1
)::TEXT AS payload \gset null_
SELECT public.tracker_start_authority_assert(
  :'null_payload'::JSONB->>'status' = 'success'
  AND (SELECT locked_by_user_id = 'b1000000-0000-4000-8000-000000000001'::UUID
       AND created_by = 'b1000000-0000-4000-8000-000000000001'::UUID
       FROM public.tournament_hands WHERE id = (:'null_payload'::JSONB->>'hand_id')::UUID),
  'null compatibility parameter resolves only to auth.uid'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', false);
SELECT public.start_hand(
  'b3000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000003', 1, now(),
  'b1000000-0000-4000-8000-000000000001', 1
)::TEXT AS payload \gset second_forged_
SELECT public.tracker_start_authority_assert(
  :'second_forged_payload'::JSONB->>'error' = 'actor_mismatch'
  AND NOT EXISTS (
    SELECT 1 FROM public.tournament_hands
    WHERE table_id = 'b5000000-0000-4000-8000-000000000003'
  ),
  'second tracker cannot forge the first tracker as lock owner'
);

SELECT (:'self_payload'::JSONB->>'hand_id')::UUID AS hand_id \gset table_one_
SELECT public.record_action(
  :'table_one_hand_id'::UUID, 'b7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'start-authority-b-forged', 'trace-b-forged',
  'b1000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset b_action_forged_
SELECT public.record_action(
  :'table_one_hand_id'::UUID, 'b7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'start-authority-b-null', 'trace-b-null', NULL
)::TEXT AS payload \gset b_action_null_
SELECT public.tracker_start_authority_assert(
  :'b_action_forged_payload'::JSONB->>'error' = 'actor_mismatch'
  AND :'b_action_null_payload'::JSONB->>'error' = 'tracker_lock_owned_by_another'
  AND (SELECT count(*) = 0 FROM public.hand_actions WHERE hand_id = :'table_one_hand_id'::UUID),
  'second tracker cannot use forged or null identity to write another fresh lock'
);

SELECT public.update_community_cards(
  :'table_one_hand_id'::UUID, '[]'::JSONB, 'b1000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset b_board_forged_
SELECT public.show_hole_cards(
  :'table_one_hand_id'::UUID, '[]'::JSONB, 'b1000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset b_show_forged_
SELECT public.delete_last_action(
  :'table_one_hand_id'::UUID, 'b1000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset b_delete_forged_
SELECT public.tracker_start_authority_assert(
  :'b_board_forged_payload'::JSONB->>'error' = 'actor_mismatch'
  AND :'b_show_forged_payload'::JSONB->>'error' = 'actor_mismatch'
  AND :'b_delete_forged_payload'::JSONB->>'error' = 'actor_mismatch'
  AND (SELECT community_cards = '[]'::JSONB FROM public.tournament_hands WHERE id = :'table_one_hand_id'::UUID)
  AND (SELECT count(*) = 0 FROM public.hand_actions WHERE hand_id = :'table_one_hand_id'::UUID),
  'peer writers cannot refresh or mutate another tracker lock with a forged id'
);

RESET ROLE;
UPDATE public.tournament_hands
SET locked_at = now() - interval '6 minutes'
WHERE id = :'table_one_hand_id'::UUID;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', false);
SELECT public.takeover_hand_lock(
  :'table_one_hand_id'::UUID, false, 'b1000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset takeover_
SELECT public.tracker_start_authority_assert(
  :'takeover_payload'::JSONB->>'ok' = 'true'
  AND (SELECT locked_by_user_id = 'b1000000-0000-4000-8000-000000000002'::UUID
       FROM public.tournament_hands WHERE id = :'table_one_hand_id'::UUID),
  'stale takeover assigns lock ownership only to the authenticated taker'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', false);
SELECT public.record_action(
  :'table_one_hand_id'::UUID, 'b7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'start-authority-a-after-takeover', 'trace-a-after', NULL
)::TEXT AS payload \gset a_after_takeover_
SELECT public.tracker_start_authority_assert(
  :'a_after_takeover_payload'::JSONB->>'error' = 'tracker_lock_owned_by_another'
  AND (SELECT count(*) = 0 FROM public.hand_actions WHERE hand_id = :'table_one_hand_id'::UUID),
  'old owner is denied after valid stale takeover'
);

SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', false);
SELECT public.record_action(
  :'table_one_hand_id'::UUID, 'b7000000-0000-4000-8000-000000000001',
  'check', 1, 1, 'preflop', 0, 'start-authority-b-after-takeover', 'trace-b-after', NULL
)::TEXT AS payload \gset b_after_takeover_
SELECT public.tracker_start_authority_assert(
  :'b_after_takeover_payload'::JSONB->>'status' = 'success'
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = :'table_one_hand_id'::UUID),
  'new lock owner writes through record_action after takeover'
);

SELECT public.update_community_cards(
  :'table_one_hand_id'::UUID, '[]'::JSONB, 'b1000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset b_board_self_
SELECT public.show_hole_cards(
  :'table_one_hand_id'::UUID, '[]'::JSONB, 'b1000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset b_show_self_
SELECT public.tracker_start_authority_assert(
  :'b_board_self_payload'::JSONB->>'status' = 'success'
  AND :'b_show_self_payload'::JSONB->>'status' = 'success'
  AND (SELECT locked_by_user_id = 'b1000000-0000-4000-8000-000000000002'::UUID
       AND locked_at > now() - interval '1 minute'
       FROM public.tournament_hands WHERE id = :'table_one_hand_id'::UUID),
  'new lock owner can continue normal board and showdown writes immediately'
);

RESET ROLE;
CREATE OR REPLACE FUNCTION public.tracker_start_authority_race(p_actor UUID, p_table UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, true);
  RETURN public.start_hand(
    'b3000000-0000-4000-8000-000000000001', p_table, 1, now(), p_actor, 1
  );
END;
$$;

CREATE TEMP TABLE tracker_start_authority_race_results(payload JSONB);
SELECT dblink_connect('start_authority_a', 'dbname=' || current_database());
SELECT dblink_connect('start_authority_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'start_authority_a',
  $$SELECT public.tracker_start_authority_race('b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000004')::TEXT$$
);
SELECT dblink_send_query(
  'start_authority_b',
  $$SELECT public.tracker_start_authority_race('b1000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000004')::TEXT$$
);
INSERT INTO tracker_start_authority_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('start_authority_a') AS t(result TEXT);
INSERT INTO tracker_start_authority_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('start_authority_b') AS t(result TEXT);
SELECT dblink_disconnect('start_authority_a');
SELECT dblink_disconnect('start_authority_b');
SELECT public.tracker_start_authority_assert(
  (SELECT count(*) = 1 FROM tracker_start_authority_race_results WHERE payload->>'status' = 'success')
  AND (SELECT count(*) = 1 FROM public.tournament_hands WHERE table_id = 'b5000000-0000-4000-8000-000000000004')
  AND (SELECT locked_by_user_id IN (
    'b1000000-0000-4000-8000-000000000001'::UUID,
    'b1000000-0000-4000-8000-000000000002'::UUID
  ) FROM public.tournament_hands WHERE table_id = 'b5000000-0000-4000-8000-000000000004'),
  'concurrent starts create one canonical hand with an authenticated owner'
);
DROP FUNCTION public.tracker_start_authority_race(UUID, UUID);

SELECT 'TRACKER_START_HAND_AUTHORITY_DISPOSABLE_DB_PASS' AS result;
