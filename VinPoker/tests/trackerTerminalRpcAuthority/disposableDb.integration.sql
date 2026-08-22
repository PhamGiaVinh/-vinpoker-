\set ON_ERROR_STOP on

INSERT INTO public.clubs(id, owner_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '99999999-9999-4999-8999-999999999999');
INSERT INTO public.club_trackers(club_id, user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333');
INSERT INTO public.tournaments(id, club_id) VALUES
  ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- owner=111, tracker=222, other tracker=333, cashier=444, dealer=555, outsider=666.
INSERT INTO public.tournament_hands(id,tournament_id,table_id,hand_number,status,is_voided,locked_by_user_id,locked_at,created_at) VALUES
  ('aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaa0001-0000-4000-8000-aaaaaaaaaaaa',1,'in_progress',false,'22222222-2222-4222-8222-222222222222',now(),now()),
  ('aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaa0002-0000-4000-8000-aaaaaaaaaaaa',1,'in_progress',false,'33333333-3333-4333-8333-333333333333',now(),now()),
  ('aaaaaaa3-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaa0003-0000-4000-8000-aaaaaaaaaaaa',1,'in_progress',false,'22222222-2222-4222-8222-222222222222',now()-interval '30 minutes',now()-interval '1 hour'),
  ('aaaaaaa4-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaa0004-0000-4000-8000-aaaaaaaaaaaa',1,'in_progress',false,'33333333-3333-4333-8333-333333333333',now()-interval '30 minutes',now()-interval '1 hour'),
  ('aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaa0005-0000-4000-8000-aaaaaaaaaaaa',1,'completed',false,null,null,now()-interval '1 hour'),
  ('bbbbbbb1-0000-4000-8000-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb','bbbb0001-0000-4000-8000-bbbbbbbbbbbb',1,'in_progress',false,'99999999-9999-4999-8999-999999999999',now(),now());

INSERT INTO public.hand_actions(id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order) VALUES
  ('a0000001-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',1,'preflop','bet',10,1),
  ('a0000002-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002',1,'preflop','bet',10,1),
  ('a0000003-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa3-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',1,'preflop','bet',10,1),
  ('a0000004-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa4-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004',1,'preflop','bet',10,1),
  ('a0000005-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000005',1,'river','all_in',100,1);

INSERT INTO public.hand_players(id,hand_id,tournament_id,player_id,entry_number,starting_stack,ending_stack,is_eliminated,hole_cards) VALUES
  ('aa000001-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',1,100,null,false,'["Ah","Ad"]'),
  ('aa000002-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002',1,100,null,false,'["Kh","Kd"]'),
  ('aa000003-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa3-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',1,100,null,false,'["Qh","Qd"]'),
  ('aa000004-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa4-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004',1,100,null,false,'["Jh","Jd"]'),
  ('aa000005-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000005',1,100,0,true,'["Th","Td"]');

INSERT INTO public.tournament_eliminations(id,hand_id,tournament_id) VALUES
  ('ea000005-0000-4000-8000-aaaaaaaaaaaa','aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa');
INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count) VALUES
  ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',1,90),
  ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002',1,90),
  ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',1,90),
  ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004',1,90),
  ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000005',1,0);
INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,chip_count,is_active) VALUES
  ('a5000001-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',1,90,true),
  ('a5000002-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002',1,90,true),
  ('a5000003-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',1,90,true),
  ('a5000004-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004',1,90,true),
  ('a5000005-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000005',1,0,false);

-- The auth grants are independently asserted before testing authenticated calls.
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.void_last_hand(uuid)'::regprocedure, 'EXECUTE'), 'anon can void';
  ASSERT has_function_privilege('authenticated', 'public.void_last_hand(uuid)'::regprocedure, 'EXECUTE'), 'authenticated cannot call guarded void';
  ASSERT NOT has_function_privilege('service_role', 'public.void_last_hand(uuid)'::regprocedure, 'EXECUTE'), 'service role has void grant';
  ASSERT NOT has_function_privilege('anon', 'public.cleanup_orphan_hands(interval)'::regprocedure, 'EXECUTE'), 'anon can cleanup';
  ASSERT has_function_privilege('authenticated', 'public.cleanup_orphan_hands(interval)'::regprocedure, 'EXECUTE'), 'authenticated cannot call guarded cleanup';
  ASSERT NOT has_function_privilege('authenticated', 'public.undo_last_action(uuid)'::regprocedure, 'EXECUTE'), 'legacy undo remains callable';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure), 'void is not SECURITY DEFINER';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid='public.cleanup_orphan_hands(interval)'::regprocedure), 'cleanup is not SECURITY DEFINER';
  ASSERT (SELECT array_to_string(proconfig, ',') = 'search_path=public' FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure), 'void search path regressed';
END $$;

-- Authenticated callers without a subject never reach terminal writes.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.void_last_hand('aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa');
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa'), 'unauthenticated write occurred';
END $$;

-- Cashier and dealer are both denied and leave a completed hand untouched.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
SELECT public.void_last_hand('aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa');
SELECT public.cleanup_orphan_hands(interval '10 minutes');
SELECT set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', false);
SELECT public.void_last_hand('aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa');
SELECT public.cleanup_orphan_hands(interval '10 minutes');
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa'), 'non-tracker void occurred';
  ASSERT (SELECT chip_count FROM public.tournament_chip_counts WHERE player_id='10000000-0000-4000-8000-000000000005') = 0, 'non-tracker chip restore occurred';
  ASSERT NOT (SELECT is_active FROM public.tournament_seats WHERE id='a5000005-0000-4000-8000-aaaaaaaaaaaa'), 'non-tracker seat restore occurred';
  ASSERT NOT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa3-0000-4000-8000-aaaaaaaaaaaa'), 'non-tracker cleanup occurred';
END $$;

-- A tracker can void only its own active lock and cannot cross club boundaries.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
SELECT public.void_last_hand('aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa');
SELECT public.void_last_hand('aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa');
SELECT public.void_last_hand('bbbbbbb1-0000-4000-8000-bbbbbbbbbbbb');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa1-0000-4000-8000-aaaaaaaaaaaa'), 'tracker could not void own lock';
  ASSERT NOT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa'), 'tracker voided another tracker lock';
  ASSERT NOT (SELECT is_voided FROM public.tournament_hands WHERE id='bbbbbbb1-0000-4000-8000-bbbbbbbbbbbb'), 'tracker voided cross-club hand';
END $$;

-- Cleanup rejects unsafe intervals and never clears another tracker's stale lock.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
SELECT public.cleanup_orphan_hands(interval '1 minute');
SELECT public.cleanup_orphan_hands(interval '10 minutes');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa3-0000-4000-8000-aaaaaaaaaaaa'), 'tracker cleanup did not void own stale lock';
  ASSERT NOT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa4-0000-4000-8000-aaaaaaaaaaaa'), 'tracker cleanup voided another tracker lock';
END $$;

-- The owner may explicitly recover another tracker lock and restore a completed hand atomically.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SELECT public.void_last_hand('aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa');
SELECT public.cleanup_orphan_hands(interval '10 minutes');
SELECT public.void_last_hand('aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa2-0000-4000-8000-aaaaaaaaaaaa'), 'owner could not recover another lock';
  ASSERT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa4-0000-4000-8000-aaaaaaaaaaaa'), 'owner cleanup did not recover stale lock';
  ASSERT (SELECT is_voided FROM public.tournament_hands WHERE id='aaaaaaa5-0000-4000-8000-aaaaaaaaaaaa'), 'owner could not void completed hand';
  ASSERT (SELECT chip_count FROM public.tournament_chip_counts WHERE player_id='10000000-0000-4000-8000-000000000005') = 100, 'owner completed void did not restore chip count';
  ASSERT (SELECT is_active FROM public.tournament_seats WHERE id='a5000005-0000-4000-8000-aaaaaaaaaaaa'), 'owner completed void did not restore seat';
  ASSERT (SELECT players_remaining FROM public.tournaments WHERE id='aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa') = (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa' AND is_active), 'aggregate player count diverged';
END $$;

SELECT jsonb_build_object(
  'status', 'PASS',
  'non_tracker_terminal_writes_zero', true,
  'tracker_lock_and_club_scope_enforced', true,
  'owner_recovery_and_projection_sync_pass', true,
  'legacy_undo_revoked', true
) AS tracker_terminal_rpc_authority;
