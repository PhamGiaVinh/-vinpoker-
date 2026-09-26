\set ON_ERROR_STOP on

-- Local/disposable PostgreSQL only. Run after the shared PR2A baseline, the
-- exact PR2A context migration, disposableDb.dependencies.sql and the exact
-- Tracker Voice V0 migration. Every UUID and row below is synthetic.

INSERT INTO auth.users(id) VALUES
  ('81100000-0000-4000-8000-000000000001'),
  ('81200000-0000-4000-8000-000000000001'),
  ('81300000-0000-4000-8000-000000000001'),
  ('81400000-0000-4000-8000-000000000001'),
  ('81500000-0000-4000-8000-000000000001'),
  ('81600000-0000-4000-8000-000000000001'),
  ('81700000-0000-4000-8000-000000000001');

INSERT INTO public.clubs(id, owner_id) VALUES
  ('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001');

INSERT INTO public.club_trackers(club_id, user_id) VALUES
  ('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001');
INSERT INTO public.club_floors(club_id, user_id) VALUES
  ('81000000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001');

INSERT INTO public.tournaments(id, club_id, name, status) VALUES
  ('85000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Voice V0 TEST', 'active'),
  ('85000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Other Club TEST', 'active');

INSERT INTO public.game_tables(id, club_id, table_name) VALUES
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Voice Table 1'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'Voice Table 2'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', 'Other Club Table');

INSERT INTO public.table_sessions(
  id, club_id, game_table_id, session_type, tournament_id, control_mode, control_epoch
) VALUES
  ('83500000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'tournament', '85000000-0000-4000-8000-000000000001', 'tracker', 1),
  ('83500000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002', 'tournament', '85000000-0000-4000-8000-000000000001', 'tracker', 1),
  ('83500000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000003', 'tournament', '85000000-0000-4000-8000-000000000002', 'tracker', 1);

INSERT INTO public.tournament_tables(
  id, tournament_id, table_id, game_table_id, table_session_id,
  table_number, status, table_name, floor_control_mode
) VALUES
  ('84000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '83500000-0000-4000-8000-000000000001', 1, 'active', 'Voice Table 1', 'tracker'),
  ('84000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', '83500000-0000-4000-8000-000000000002', 2, 'active', 'Voice Table 2', 'tracker'),
  ('84000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000003', '83500000-0000-4000-8000-000000000003', 1, 'active', 'Other Club Table', 'tracker');

INSERT INTO public.dealers(id, club_id, user_id, full_name, status) VALUES
  ('87000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', 'Dealer Voice A', 'active'),
  ('87000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '81500000-0000-4000-8000-000000000001', 'Dealer Other Club', 'active'),
  ('87000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', '81700000-0000-4000-8000-000000000001', 'Dealer Voice B', 'active'),
  ('87000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', NULL, 'Dealer Repair Fixture', 'active');

INSERT INTO public.dealer_attendance(id, dealer_id, current_state, status) VALUES
  ('87500000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', 'assigned', 'checked_in'),
  ('87500000-0000-4000-8000-000000000002', '87000000-0000-4000-8000-000000000002', 'assigned', 'checked_in'),
  ('87500000-0000-4000-8000-000000000003', '87000000-0000-4000-8000-000000000003', 'pre_assigned', 'checked_in'),
  ('87500000-0000-4000-8000-000000000004', '87000000-0000-4000-8000-000000000004', 'assigned', 'checked_in');

INSERT INTO public.dealer_assignments(
  id, dealer_id, attendance_id, table_id, table_session_id, club_id, assigned_at, status
) VALUES
  ('88000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', '87500000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '83500000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', now(), 'assigned'),
  ('88000000-0000-4000-8000-000000000002', '87000000-0000-4000-8000-000000000002', '87500000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000003', '83500000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', now(), 'assigned'),
  ('88000000-0000-4000-8000-000000000009', '87000000-0000-4000-8000-000000000004', '87500000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000002', NULL, '81000000-0000-4000-8000-000000000001', now() - interval '5 minutes', 'assigned');

INSERT INTO public.tournament_hands(
  id, tournament_id, table_id, tournament_table_id, table_session_id,
  hand_number, status, button_seat, created_by
) VALUES (
  '86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',
  1,
  'in_progress',
  1,
  '81400000-0000-4000-8000-000000000001'
);

INSERT INTO public.hand_players(
  hand_id, tournament_id, player_id, entry_number, seat_number,
  starting_stack, ending_stack, player_name
) VALUES
  ('86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 1, 1, 30000, 30000, 'Player A'),
  ('86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 1, 2, 30000, 30000, 'Player B');

INSERT INTO public.tracker_voice_configs(
  club_id, tournament_id, tournament_table_id, physical_table_id,
  table_session_id, control_epoch,
  enabled, configured_mode, provider_model, spoken_amount_unit,
  amount_unit_confirmed, server_auto_allowed
) VALUES (
  '81000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001', 1,
  false, 'assist', 'gemini-3.5-transcribe-live', 1, false, false
);

INSERT INTO public.tracker_voice_configs(
  club_id, tournament_id, tournament_table_id, physical_table_id,
  table_session_id, control_epoch, enabled, configured_mode, provider_model,
  spoken_amount_unit, amount_unit_confirmed, server_auto_allowed
) VALUES (
  '81000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002',
  '83000000-0000-4000-8000-000000000002',
  '83500000-0000-4000-8000-000000000002', 1,
  false, 'assist', 'gemini-3.5-transcribe-live', 1, false, false
);

-- Production repair shape: exact row/version/session guard, triggers enabled.
SELECT assigned_at AS assigned_at_before, version AS version_before, updated_at AS updated_at_before
FROM public.dealer_assignments
WHERE id = '88000000-0000-4000-8000-000000000009' \gset repair_
SELECT total_worked_minutes_today AS worked_before, overtime_minutes AS ot_before
FROM public.dealer_attendance
WHERE id = '87500000-0000-4000-8000-000000000004' \gset repair_attendance_
WITH repaired AS (
  UPDATE public.dealer_assignments
  SET table_session_id = '83500000-0000-4000-8000-000000000002'
  WHERE id = '88000000-0000-4000-8000-000000000009'
    AND version = :repair_version_before::INTEGER
    AND status = 'assigned'
    AND released_at IS NULL
    AND club_id = '81000000-0000-4000-8000-000000000001'
    AND table_id = '83000000-0000-4000-8000-000000000002'
    AND table_session_id IS NULL
  RETURNING 1
)
SELECT pg_catalog.count(*) AS repaired_count FROM repaired \gset repair_result_
SELECT public.tracker_voice_test_assert(
  :repair_result_repaired_count::INTEGER = 1
  AND (SELECT table_session_id = '83500000-0000-4000-8000-000000000002'::UUID
       AND version = :repair_version_before::INTEGER + 1
       AND assigned_at = :'repair_assigned_at_before'::TIMESTAMPTZ
       AND updated_at >= :'repair_updated_at_before'::TIMESTAMPTZ
       FROM public.dealer_assignments WHERE id = '88000000-0000-4000-8000-000000000009')
  AND (SELECT total_worked_minutes_today = :repair_attendance_worked_before::INTEGER
       AND overtime_minutes = :repair_attendance_ot_before::INTEGER
       FROM public.dealer_attendance WHERE id = '87500000-0000-4000-8000-000000000004')
  AND NOT (SELECT enabled FROM public.tracker_voice_configs
           WHERE tournament_table_id = '84000000-0000-4000-8000-000000000002'),
  'one-row repair preserves business fields while version/sync triggers run'
);

SELECT public.tracker_voice_test_assert(
  (SELECT value = 'false'::JSONB FROM public.app_settings WHERE key = 'tracker_voice_global_enabled'),
  'global Voice gate defaults false after the rollout migration'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}', false);
UPDATE public.app_settings
SET value = 'true'::JSONB
WHERE key = 'tracker_voice_global_enabled';
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (SELECT value = 'false'::JSONB FROM public.app_settings WHERE key = 'tracker_voice_global_enabled'),
  'legacy media policy cannot enable the global Voice gate'
);
UPDATE public.app_settings
SET value = 'true'::JSONB
WHERE key = 'tracker_voice_global_enabled';
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.reconcile_tracker_voice_floor_config(
  '83500000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset canary_reconcile_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'canary_reconcile_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'canary_reconcile_payload'::JSONB->>'voice_enabled')::BOOLEAN
  AND (SELECT enabled FROM public.tracker_voice_configs
       WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001')
  AND NOT (SELECT enabled FROM public.tracker_voice_configs
           WHERE tournament_table_id = '84000000-0000-4000-8000-000000000002'),
  'one service-only canary reconcile enables only its exact assigned tracker session while auto-provision remains off'
);

-- Catalog and least-privilege gates.
SELECT public.tracker_voice_test_assert(
  has_function_privilege(
    'service_role',
    'public._tracker_voice_register_validated_event(uuid,uuid,uuid,uuid,text,text,text,numeric,text,jsonb,text,text,text,text,text,boolean,text)',
    'EXECUTE'
  ),
  'service role can register one validated event'
);
SELECT public.tracker_voice_test_assert(
  NOT has_function_privilege(
    'authenticated',
    'public._tracker_voice_register_validated_event(uuid,uuid,uuid,uuid,text,text,text,numeric,text,jsonb,text,text,text,text,text,boolean,text)',
    'EXECUTE'
  ),
  'browser cannot register a validated event directly'
);
SELECT public.tracker_voice_test_assert(
  NOT has_function_privilege('anon', 'public.get_tracker_voice_runtime_context(uuid,uuid)', 'EXECUTE'),
  'anon cannot read Voice runtime context'
);
SELECT public.tracker_voice_test_assert(
  NOT has_table_privilege('anon', 'public.tracker_voice_events', 'SELECT'),
  'anon cannot read Voice event rows'
);
SELECT public.tracker_voice_test_assert(
  NOT has_table_privilege('authenticated', 'public.tracker_voice_events', 'UPDATE,DELETE'),
  'browser cannot mutate immutable Voice events'
);

-- Exact assignment and canonical/physical identity behavior.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.get_tracker_voice_runtime_context(
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset runtime_ok_
SELECT public.tracker_voice_test_assert(
  (:'runtime_ok_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'runtime_ok_payload'::JSONB->>'can_mint_session')::BOOLEAN
  AND (:'runtime_ok_payload'::JSONB->>'physical_table_id')::UUID = '83000000-0000-4000-8000-000000000001',
  'assigned Dealer resolves exact canonical table and physical table'
);
SELECT public.get_tracker_voice_runtime_context(
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset runtime_wrong_
SELECT public.tracker_voice_test_assert(
  :'runtime_wrong_payload'::JSONB->>'error' = 'voice_config_disabled'
  AND (:'runtime_wrong_payload'::JSONB->>'read_only')::BOOLEAN,
  'disabled table is read-only and cannot mint a Voice session'
);
RESET ROLE;

-- The production writer itself performs A -> B. Migration 15's real trigger
-- keeps the reviewed capability, then public runtime entrypoints re-authorize
-- both identities against the new exact-session assignment.
SELECT public.execute_pre_assigned_swing_rpc(
  '88000000-0000-4000-8000-000000000001',
  '87500000-0000-4000-8000-000000000003',
  pg_catalog.now() + interval '30 minutes',
  30,
  false,
  15
)::TEXT AS payload \gset voice_swing_
SELECT public.tracker_voice_test_assert(
  :'voice_swing_payload'::JSONB->>'status' = 'success',
  'real Swing RPC completes the Voice Dealer handoff'
);
SELECT total_worked_minutes_today AS value
FROM public.dealer_attendance
WHERE id = '87500000-0000-4000-8000-000000000001' \gset voice_swing_minutes_
SELECT pg_catalog.count(*) AS value
FROM public.dealer_assignments
WHERE idempotency_key = 'pre_assign_88000000-0000-4000-8000-000000000001' \gset voice_swing_count_
SELECT public.execute_pre_assigned_swing_rpc(
  '88000000-0000-4000-8000-000000000001',
  '87500000-0000-4000-8000-000000000003',
  pg_catalog.now() + interval '30 minutes',
  30,
  false,
  15
)::TEXT AS payload \gset voice_swing_retry_
SELECT public.tracker_voice_test_assert(
  :'voice_swing_retry_payload'::JSONB->>'error' = 'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED'
  AND (SELECT pg_catalog.count(*) = :voice_swing_count_value::BIGINT
       FROM public.dealer_assignments
       WHERE idempotency_key = 'pre_assign_88000000-0000-4000-8000-000000000001')
  AND (SELECT total_worked_minutes_today = :voice_swing_minutes_value::INTEGER
       FROM public.dealer_attendance
       WHERE id = '87500000-0000-4000-8000-000000000001'),
  'Swing retry creates no assignment and credits no worked minutes twice'
);
SELECT public.tracker_voice_test_assert(
  (public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81700000-0000-4000-8000-000000000001'
  )->>'ok')::BOOLEAN
  AND public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81200000-0000-4000-8000-000000000001'
  )->>'error' = 'dealer_assignment_missing'
  AND (SELECT enabled FROM public.tracker_voice_configs
       WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001')
  AND NOT (SELECT enabled FROM public.tracker_voice_configs
           WHERE tournament_table_id = '84000000-0000-4000-8000-000000000002'),
  'Dealer B receives authority, old Dealer A is denied, and the other table is unchanged'
);

-- A request prepared by Dealer A before the handoff is re-authorized when it
-- reaches the server. It cannot become a persisted event after B takes over.
SELECT public._tracker_voice_hand_state_version(
  '86000000-0000-4000-8000-000000000001'
) AS value \gset handoff_state_
SELECT pg_catalog.count(*) AS value FROM public.tracker_voice_events \gset handoff_event_count_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-handoff-old-a', NULL, 'Player A call 100',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"street":"preflop","action_order":1,"action_amount":100}'::JSONB,
  :'handoff_state_value', 'assist', 'voice-handoff-old-a-01', 'trace-handoff-old-a-01',
  'enforce', true, NULL
)::TEXT AS payload \gset handoff_old_write_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'handoff_old_write_payload'::JSONB->>'error' = 'dealer_assignment_missing'
  AND (SELECT pg_catalog.count(*) = :handoff_event_count_value::BIGINT FROM public.tracker_voice_events),
  'pending write from the old Dealer is rechecked server-side and leaves zero events'
);

-- Two different Dealers must be counted across the whole session. Filtering by
-- caller first would incorrectly allow each actor to observe a count of one.
INSERT INTO public.dealer_assignments(
  id, dealer_id, table_id, table_session_id, assigned_at, status
) VALUES (
  '88000000-0000-4000-8000-000000000004',
  '87000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',
  now() + interval '1 second',
  'assigned'
);
SELECT public.tracker_voice_test_assert(
  public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81200000-0000-4000-8000-000000000001'
  )->>'error' = 'dealer_assignment_ambiguous'
  AND public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81700000-0000-4000-8000-000000000001'
  )->>'error' = 'dealer_assignment_ambiguous',
  'multiple active assignments fail closed for both actors, including different Dealers'
);
UPDATE public.dealer_assignments
SET status = 'released', released_at = pg_catalog.now()
WHERE id = '88000000-0000-4000-8000-000000000004';

-- A disabled config is an administrative decision. Even with auto-provision on,
-- assignment churn cannot revive it; only the explicit service reconcile can.
UPDATE public.tracker_voice_configs
SET enabled = FALSE
WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001';
UPDATE public.app_settings
SET value = 'true'::JSONB
WHERE key = 'tracker_voice_auto_provision_enabled';
UPDATE public.dealer_assignments
SET status = 'released', released_at = pg_catalog.now()
WHERE attendance_id = '87500000-0000-4000-8000-000000000003'
  AND status = 'assigned'
  AND released_at IS NULL;
INSERT INTO public.dealer_assignments(
  id, dealer_id, table_id, table_session_id, assigned_at, status
) VALUES (
  '88000000-0000-4000-8000-000000000005',
  '87000000-0000-4000-8000-000000000003',
  '83000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',
  pg_catalog.now(),
  'assigned'
);
SELECT public.tracker_voice_test_assert(
  NOT (SELECT enabled FROM public.tracker_voice_configs
       WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001')
  AND public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81700000-0000-4000-8000-000000000001'
  )->>'error' = 'voice_config_disabled',
  'assignment changes and auto-provision do not revive an administratively disabled config'
);
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.reconcile_tracker_voice_floor_config(
  '83500000-0000-4000-8000-000000000001'
);
SELECT public.reconcile_tracker_voice_floor_config(
  '83500000-0000-4000-8000-000000000001'
);
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (SELECT enabled FROM public.tracker_voice_configs
   WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001')
  AND (SELECT pg_catalog.count(*) = 1 FROM public.tracker_voice_configs
       WHERE tournament_id = '85000000-0000-4000-8000-000000000001'
         AND tournament_table_id = '84000000-0000-4000-8000-000000000001')
  AND NOT (SELECT enabled FROM public.tracker_voice_configs
           WHERE tournament_table_id = '84000000-0000-4000-8000-000000000002'),
  'exact reconcile is idempotent and does not change another table'
);
UPDATE public.app_settings
SET value = 'false'::JSONB
WHERE key = 'tracker_voice_auto_provision_enabled';

-- Restore Dealer A for the remaining canonical writer/idempotency suite.
UPDATE public.dealer_assignments
SET status = 'released', released_at = pg_catalog.now()
WHERE id = '88000000-0000-4000-8000-000000000005';
INSERT INTO public.dealer_assignments(
  id, dealer_id, table_id, table_session_id, assigned_at, status
) VALUES (
  '88000000-0000-4000-8000-000000000006',
  '87000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',
  pg_catalog.now(),
  'assigned'
);
SELECT public.tracker_voice_test_assert(
  (public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81200000-0000-4000-8000-000000000001'
  )->>'ok')::BOOLEAN
  AND public._tracker_voice_assignment_context(
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81700000-0000-4000-8000-000000000001'
  )->>'error' = 'dealer_assignment_missing',
  'restored sole Dealer A is allowed and stale Dealer B session requests are denied'
);

-- Service-only session mint limiter: five accepts, sixth deny, no browser seam.
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
DO $$
DECLARE
  v_result JSONB;
BEGIN
  FOR i IN 1..5 LOOP
    v_result := public._tracker_voice_consume_session_rate_limit(
      '81200000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001'
    );
    PERFORM public.tracker_voice_test_assert(
      COALESCE((v_result->>'ok')::BOOLEAN, false),
      'session request within fixed-window limit succeeds'
    );
  END LOOP;
  v_result := public._tracker_voice_consume_session_rate_limit(
    '81200000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001'
  );
  PERFORM public.tracker_voice_test_assert(
    v_result->>'error' = 'voice_session_rate_limited',
    'sixth session request is rate limited'
  );
END;
$$;

-- Register one final transcript using the server-derived assignment/state.
SELECT public._tracker_voice_hand_state_version(
  '86000000-0000-4000-8000-000000000001'
) AS value \gset initial_state_

SET ROLE service_role;
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-event-1', NULL, 'Player A call 100',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"street":"preflop","action_order":1,"action_amount":100}'::JSONB,
  :'initial_state_value', 'assist', 'voice-event-call-0001', 'trace-call-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset event_one_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'event_one_payload'::JSONB->>'ok')::BOOLEAN
  AND :'event_one_payload'::JSONB->>'execution_result' = 'validated'
  AND EXISTS (
    SELECT 1
    FROM public.tracker_voice_events
    WHERE id = (:'event_one_payload'::JSONB->>'voice_event_id')::UUID
      AND event_kind = 'final_transcript'
      AND final_transcript = 'Player A call 100'
  ),
  'final transcript persists only after server validation'
);

-- Canonical action write: Dealer can only write through the matching immutable
-- event; duplicate callback returns the same action and creates no second row.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.heartbeat_lock(
  '86000000-0000-4000-8000-000000000001',
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset voice_lock_
SELECT public.tracker_voice_test_assert(
  :'voice_lock_payload'::JSONB->>'status' = 'success'
  AND (:'voice_lock_payload'::JSONB->>'locked_by')::UUID = '81200000-0000-4000-8000-000000000001',
  'assigned Dealer claims the canonical hand before the Voice action write'
);
SELECT public.record_action(
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'call', 1, 1, 'preflop', 100,
  'voice-event-call-0001', 'trace-call-0001',
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset action_one_
SELECT public.record_action(
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'call', 1, 1, 'preflop', 100,
  'voice-event-call-0001', 'trace-call-retry',
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset action_retry_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'action_one_payload'::JSONB->>'status' = 'success'
  AND :'action_one_payload'::JSONB->>'source' = 'voice'
  AND (:'action_retry_payload'::JSONB->>'duplicate')::BOOLEAN
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = '86000000-0000-4000-8000-000000000001'),
  'duplicate Voice callback produces exactly one canonical action'
);
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) = 1 FROM public.tracker_voice_events WHERE event_kind = 'canonical_receipt'),
  'canonical receipt is appended once'
);

-- A known idempotency key is not an authorization bypass, and an existing
-- canonical action cannot be replayed with a changed payload.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81500000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81500000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.record_action(
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'call', 1, 1, 'preflop', 100,
  'voice-event-call-0001', 'trace-cross-actor-retry',
  '81500000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset action_cross_actor_
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.record_action(
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'call', 1, 1, 'preflop', 101,
  'voice-event-call-0001', 'trace-changed-retry',
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset action_changed_retry_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'action_cross_actor_payload'::JSONB->>'error' = 'tracker_lock_owned_by_another'
  AND :'action_changed_retry_payload'::JSONB->>'error' = 'idempotency_key_conflict'
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = '86000000-0000-4000-8000-000000000001'),
  'canonical retry rejects a foreign operator before idempotency and preserves the immutable payload'
);

-- A retry of the identical validated event remains idempotent even after the
-- canonical action changed hand state. Different input with the same key must
-- fail as idempotency_mismatch, not be mistaken for a stale-state retry.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-event-1', NULL, 'Player A call 100',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"street":"preflop","action_order":1,"action_amount":100}'::JSONB,
  :'initial_state_value', 'assist', 'voice-event-call-0001', 'trace-call-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset event_retry_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-event-1', NULL, 'Player A call 200',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"street":"preflop","action_order":1,"action_amount":200}'::JSONB,
  :'initial_state_value', 'assist', 'voice-event-call-0001', 'trace-call-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset event_mismatch_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-event-1', NULL, 'Player A call 100',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"street":"preflop","action_order":1,"action_amount":100}'::JSONB,
  :'initial_state_value', 'assist', 'voice-provider-replay-0001', 'trace-provider-replay-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset provider_replay_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-event-1', NULL, 'Player A call 200',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000001","entry_number":1,"street":"preflop","action_order":1,"action_amount":200}'::JSONB,
  :'initial_state_value', 'assist', 'voice-provider-reuse-0001', 'trace-provider-reuse-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset provider_reuse_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'event_retry_payload'::JSONB->>'duplicate')::BOOLEAN,
  'same validated event retry returns original receipt after hand advances'
);
SELECT public.tracker_voice_test_assert(
  :'event_mismatch_payload'::JSONB->>'error' = 'idempotency_mismatch',
  'same idempotency key with different event payload is rejected'
);
SELECT public.tracker_voice_test_assert(
  (:'provider_replay_payload'::JSONB->>'duplicate')::BOOLEAN
  AND :'provider_replay_payload'::JSONB->>'voice_event_id' = :'event_retry_payload'::JSONB->>'voice_event_id',
  'same provider event with a new idempotency key returns the original receipt'
);
SELECT public.tracker_voice_test_assert(
  :'provider_reuse_payload'::JSONB->>'error' = 'provider_event_mismatch',
  'same provider event cannot authorize a changed payload'
);

-- Exercise the unique-violation retry branch under real row locking. Session A
-- sleeps during insert while holding the hand lock; session B passes the first
-- lookup, waits, then must reject its changed payload after A commits.
INSERT INTO public.tournament_hands(
  id, tournament_id, table_id, hand_number, status, button_seat, created_by
) VALUES (
  '86000000-0000-4000-8000-000000000002',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  2, 'in_progress', 1, '81400000-0000-4000-8000-000000000001'
);
INSERT INTO public.hand_players(
  hand_id, tournament_id, player_id, entry_number, seat_number,
  starting_stack, ending_stack, player_name
) VALUES (
  '86000000-0000-4000-8000-000000000002',
  '85000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  1, 1, 30000, 30000, 'Player A'
);
UPDATE public.tournament_hands
SET locked_by_user_id = '81400000-0000-4000-8000-000000000001', locked_at = now()
WHERE id = '86000000-0000-4000-8000-000000000002';

CREATE OR REPLACE FUNCTION public.tracker_voice_test_delay_manual_action()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('tracker_voice.test_action_delay', true) = 'on' THEN
    PERFORM pg_sleep(0.5);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tracker_voice_test_delay_manual_action
  BEFORE INSERT ON public.hand_actions
  FOR EACH ROW EXECUTE FUNCTION public.tracker_voice_test_delay_manual_action();

CREATE OR REPLACE FUNCTION public.tracker_voice_test_manual_action_race(
  p_action TEXT,
  p_delay BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '81400000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"81400000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  PERFORM set_config('tracker_voice.test_action_delay', CASE WHEN p_delay THEN 'on' ELSE 'off' END, true);
  RETURN public.record_action(
    '86000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000001',
    p_action, 1, 1, 'preflop', 0,
    'manual-action-race-0001', 'trace-manual-race',
    '81400000-0000-4000-8000-000000000001'
  );
END;
$$;

CREATE TEMP TABLE tracker_voice_action_race_results(payload JSONB);
SELECT dblink_connect('voice_action_a', 'dbname=' || current_database());
SELECT dblink_connect('voice_action_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'voice_action_a',
  $$SELECT public.tracker_voice_test_manual_action_race('check', true)::TEXT$$
);
SELECT pg_sleep(0.1);
SELECT dblink_send_query(
  'voice_action_b',
  $$SELECT public.tracker_voice_test_manual_action_race('fold', false)::TEXT$$
);
INSERT INTO tracker_voice_action_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('voice_action_a') AS t(result TEXT);
INSERT INTO tracker_voice_action_race_results(payload)
SELECT result::JSONB FROM dblink_get_result('voice_action_b') AS t(result TEXT);
SELECT dblink_disconnect('voice_action_a');
SELECT dblink_disconnect('voice_action_b');
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) = 1 FROM tracker_voice_action_race_results WHERE payload->>'status' = 'success')
  AND (SELECT count(*) = 1 FROM tracker_voice_action_race_results WHERE payload->>'error' = 'idempotency_key_conflict')
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = '86000000-0000-4000-8000-000000000002'),
  'concurrent same-key different-payload action returns one success and one conflict'
);
DROP TRIGGER trg_tracker_voice_test_delay_manual_action ON public.hand_actions;
DROP FUNCTION public.tracker_voice_test_delay_manual_action();
DROP FUNCTION public.tracker_voice_test_manual_action_race(TEXT, BOOLEAN);
UPDATE public.tournament_hands
SET status = 'completed'
WHERE id = '86000000-0000-4000-8000-000000000002';

-- Stale state, missing confidence for Auto and actor impersonation all fail
-- before any event/action write.
SELECT count(*) AS value FROM public.tracker_voice_events \gset before_denials_
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset current_state_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-stale', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  repeat('0', 64), 'assist', 'voice-event-stale-0001', 'trace-stale-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset stale_event_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-auto', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  :'current_state_value', 'auto', 'voice-event-auto-0001', 'trace-auto-0001',
  'enforce', true, 'voice-cap-v0'
)::TEXT AS payload \gset auto_event_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'stale_event_payload'::JSONB->>'error' = 'stale_state_version'
  AND :'auto_event_payload'::JSONB->>'error' = 'auto_capability_missing'
  AND (SELECT count(*) = :before_denials_value::BIGINT FROM public.tracker_voice_events),
  'stale state and confidence-less Auto are zero-write denials'
);

-- The current-P0 chain deliberately proves record_action before the Gemini
-- provider migration. Run the Gemini-specific assertion only when 12008 has
-- installed its provider constraint; the exact final Voice-chain workflow
-- requires that condition and therefore always executes this block.
SELECT EXISTS (
  SELECT 1
  FROM pg_constraint c
  WHERE c.conrelid = 'public.tracker_voice_events'::regclass
    AND c.conname = 'tracker_voice_events_provider_name_check'
    AND pg_get_constraintdef(c.oid) LIKE '%gemini_live%'
) AS gemini_provider_available \gset
\if :gemini_provider_available
-- Gemini Live may create a Shadow proposal with the reviewed model, but it
-- cannot fabricate the compatible confidence required to enter Auto.
UPDATE public.tracker_voice_configs
SET configured_mode = 'auto',
    provider_model = 'gemini-3.1-flash-live-preview',
    server_auto_allowed = true,
    auto_turn_order_compatible = true,
    provider_confidence_threshold = 0.9000,
    auto_capability_version = 'voice-cap-v0'
WHERE tournament_id = '85000000-0000-4000-8000-000000000001'
  AND tournament_table_id = '84000000-0000-4000-8000-000000000001';
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset gemini_state_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.1-flash-live-preview', 'provider-gemini-shadow', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  :'gemini_state_value', 'shadow', 'voice-event-gemini-shadow-0001', 'trace-gemini-shadow-0001',
  'enforce', true, 'voice-cap-v0'
)::TEXT AS payload \gset gemini_shadow_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.1-flash-live-preview', 'provider-gemini-auto', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  :'gemini_state_value', 'auto', 'voice-event-gemini-auto-0001', 'trace-gemini-auto-0001',
  'enforce', true, 'voice-cap-v0'
)::TEXT AS payload \gset gemini_auto_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'gemini_shadow_payload'::JSONB->>'ok')::BOOLEAN
  AND :'gemini_shadow_payload'::JSONB->>'execution_mode' = 'shadow'
  AND :'gemini_auto_payload'::JSONB->>'error' = 'auto_capability_missing'
  AND (SELECT count(*) = 0 FROM public.hand_actions WHERE idempotency_key = 'voice-event-gemini-auto-0001'),
  'Gemini Shadow is allowed while confidence-less Auto remains impossible'
);

-- Transcribe 3.5 is valid only when the server-side config selects it. A
-- caller cannot substitute the legacy model or an OpenAI provider.
UPDATE public.tracker_voice_configs
SET configured_mode = 'shadow',
    provider_model = 'gemini-3.5-transcribe-live',
    server_auto_allowed = false,
    auto_turn_order_compatible = false,
    provider_confidence_threshold = NULL,
    auto_capability_version = NULL
WHERE tournament_id = '85000000-0000-4000-8000-000000000001'
  AND tournament_table_id = '84000000-0000-4000-8000-000000000001';
SELECT count(*) AS value FROM public.tracker_voice_events \gset transcribe35_before_
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset transcribe35_state_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-gemini-transcribe35-shadow', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  :'transcribe35_state_value', 'shadow', 'voice-event-gemini-transcribe35-shadow-0001', 'trace-gemini-transcribe35-shadow-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset transcribe35_ok_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.1-flash-live-preview', 'provider-gemini-transcribe35-model-mismatch', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  :'transcribe35_state_value', 'shadow', 'voice-event-gemini-transcribe35-model-mismatch-0001', 'trace-gemini-transcribe35-model-mismatch-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset transcribe35_model_mismatch_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'openai_realtime', 'gemini-3.5-transcribe-live', 'provider-gemini-transcribe35-provider-mismatch', NULL, 'Player B check',
  '{"kind":"check","canonical_action":"check","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":0}'::JSONB,
  :'transcribe35_state_value', 'shadow', 'voice-event-gemini-transcribe35-provider-mismatch-0001', 'trace-gemini-transcribe35-provider-mismatch-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset transcribe35_provider_mismatch_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'transcribe35_ok_payload'::JSONB->>'ok')::BOOLEAN
  AND :'transcribe35_model_mismatch_payload'::JSONB->>'error' = 'voice_provider_config_mismatch'
  AND :'transcribe35_provider_mismatch_payload'::JSONB->>'error' = 'voice_provider_config_mismatch'
  AND (SELECT count(*) = :transcribe35_before_value::BIGINT + 1 FROM public.tracker_voice_events),
  'Transcribe 3.5 requires exact configured model and provider with zero writes on mismatch'
);
\else
SELECT 'TRACKER_VOICE_GEMINI_AUTO_TEST_SKIPPED_PRE_12008' AS result;
\endif

-- Restore a matching Assist config for the correction-pending lifecycle tests.
UPDATE public.tracker_voice_configs
SET configured_mode = 'assist',
    provider_model = 'gemini-3.5-transcribe-live'
WHERE tournament_id = '85000000-0000-4000-8000-000000000001'
  AND tournament_table_id = '84000000-0000-4000-8000-000000000001';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.record_action(
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000002',
  'check', 2, 1, 'preflop', 0,
  NULL, 'trace-manual-deny',
  '81400000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset impersonation_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'impersonation_payload'::JSONB->>'error' = 'actor_mismatch'
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = '86000000-0000-4000-8000-000000000001'),
  'client-supplied actor cannot impersonate Tracker'
);

-- Prepare a second valid Assist proposal, then report a wrong action. The
-- pending proposal must be blocked at the canonical writer until Floor closes
-- the correction alert.
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset pending_state_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-pending', NULL, 'Player B call 200',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":200}'::JSONB,
  :'pending_state_value', 'assist', 'voice-event-pending-01', 'trace-pending-01',
  'enforce', true, NULL
)::TEXT AS payload \gset pending_event_
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-wrong', NULL, 'Bao sai action vua nhap',
  '{"kind":"report_wrong_action"}'::JSONB,
  :'pending_state_value', 'assist', 'voice-event-wrong-0001', 'trace-wrong-0001',
  'enforce', true, NULL
)::TEXT AS payload \gset wrong_event_
RESET ROLE;
SELECT id AS value FROM public.tracker_floor_alerts
WHERE alert_kind = 'wrong_action' ORDER BY created_at DESC LIMIT 1 \gset wrong_alert_
SELECT public.tracker_voice_test_assert(
  (:'pending_event_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'wrong_event_payload'::JSONB->>'correction_pending')::BOOLEAN
  AND (SELECT correction_state = 'correction_pending'
       FROM public.tracker_voice_configs
       WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001')
  AND (SELECT status = 'in_progress' FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001'),
  'wrong-action alert pauses Voice only and does not pause the hand'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.record_action(
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000002',
  'call', 2, 1, 'preflop', 200,
  'voice-event-pending-01', 'trace-pending-01',
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset blocked_action_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'blocked_action_payload'::JSONB->>'error' = 'correction_pending'
  AND (SELECT count(*) = 1 FROM public.hand_actions WHERE hand_id = '86000000-0000-4000-8000-000000000001'),
  'canonical Voice writer is fail-closed while correction is pending'
);

SELECT count(*) AS value FROM public.tracker_voice_events \gset correction_count_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'provider-blocked', NULL, 'Player B call 200',
  '{"kind":"call","canonical_action":"call","actor_player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"street":"preflop","action_order":2,"action_amount":200}'::JSONB,
  :'pending_state_value', 'assist', 'voice-event-blocked-01', 'trace-blocked-01',
  'enforce', true, NULL
)::TEXT AS payload \gset blocked_event_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'blocked_event_payload'::JSONB->>'error' = 'correction_pending'
  AND (SELECT count(*) = :correction_count_value::BIGINT FROM public.tracker_voice_events),
  'buffered proposal is not persisted or auto-committed while correction is pending'
);

-- Real row-lock race: exactly one Floor acknowledgement wins and the other
-- receives stale_alert_version. A disposable trigger holds the first row lock.
CREATE OR REPLACE FUNCTION public.tracker_voice_test_delay_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('tracker_voice.test_delay', true) = 'on' THEN
    PERFORM pg_sleep(0.6);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tracker_voice_test_delay_alert
  BEFORE UPDATE ON public.tracker_floor_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tracker_voice_test_delay_alert();

CREATE OR REPLACE FUNCTION public.tracker_voice_test_transition_as(
  p_actor UUID,
  p_alert UUID,
  p_key TEXT,
  p_delay BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('tracker_voice.test_delay', CASE WHEN p_delay THEN 'on' ELSE 'off' END, true);
  RETURN public.transition_tracker_floor_alert(p_alert, 1, 'acknowledge', NULL, p_key);
END;
$$;

CREATE TEMP TABLE tracker_voice_concurrency_results(payload JSONB);
SELECT dblink_connect('voice_alert_a', 'dbname=' || current_database());
SELECT dblink_connect('voice_alert_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'voice_alert_a',
  format(
    'SELECT public.tracker_voice_test_transition_as(%L::uuid,%L::uuid,%L,true)::text',
    '81300000-0000-4000-8000-000000000001', :'wrong_alert_value', 'voice-alert-ack-a-01'
  )
);
SELECT pg_sleep(0.1);
SELECT dblink_send_query(
  'voice_alert_b',
  format(
    'SELECT public.tracker_voice_test_transition_as(%L::uuid,%L::uuid,%L,false)::text',
    '81300000-0000-4000-8000-000000000001', :'wrong_alert_value', 'voice-alert-ack-b-01'
  )
);
INSERT INTO tracker_voice_concurrency_results(payload)
SELECT result::JSONB FROM dblink_get_result('voice_alert_a') AS t(result TEXT);
INSERT INTO tracker_voice_concurrency_results(payload)
SELECT result::JSONB FROM dblink_get_result('voice_alert_b') AS t(result TEXT);
SELECT dblink_disconnect('voice_alert_a');
SELECT dblink_disconnect('voice_alert_b');

SELECT public.tracker_voice_test_assert(
  (SELECT count(*) = 1 FROM tracker_voice_concurrency_results WHERE payload->>'ok' = 'true')
  AND (SELECT count(*) = 1 FROM tracker_voice_concurrency_results WHERE payload->>'error' = 'stale_alert_version')
  AND (SELECT status = 'acknowledged' AND version = 2 FROM public.tracker_floor_alerts WHERE id = :'wrong_alert_value'::UUID),
  'concurrent Floor transition serializes to one winner and one stale response'
);

DROP TRIGGER trg_tracker_voice_test_delay_alert ON public.tracker_floor_alerts;
DROP FUNCTION public.tracker_voice_test_delay_alert();

-- Finish correction, prove transition retry semantics and immutable audit.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.transition_tracker_floor_alert(
  :'wrong_alert_value'::UUID, 2, 'start', NULL, 'voice-alert-start-01'
)::TEXT AS payload \gset alert_start_
SELECT public.transition_tracker_floor_alert(
  :'wrong_alert_value'::UUID, 3, 'resolve', 'Floor checked canonical action', 'voice-alert-resolve-01'
)::TEXT AS payload \gset alert_resolve_
SELECT public.transition_tracker_floor_alert(
  :'wrong_alert_value'::UUID, 3, 'resolve', 'Floor checked canonical action', 'voice-alert-resolve-01'
)::TEXT AS payload \gset alert_resolve_retry_
SELECT public.transition_tracker_floor_alert(
  :'wrong_alert_value'::UUID, 3, 'resolve', 'different note', 'voice-alert-resolve-01'
)::TEXT AS payload \gset alert_resolve_mismatch_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'alert_start_payload'::JSONB->>'status' = 'in_progress'
  AND :'alert_resolve_payload'::JSONB->>'status' = 'resolved'
  AND (:'alert_resolve_retry_payload'::JSONB->>'duplicate')::BOOLEAN
  AND :'alert_resolve_mismatch_payload'::JSONB->>'error' = 'idempotency_mismatch'
  AND (SELECT correction_state = 'ready' AND correction_alert_id IS NULL
       FROM public.tracker_voice_configs
       WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001'),
  'Floor resolution is audited, idempotent and releases Voice back to Assist'
);
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) >= 3 FROM public.audit_logs WHERE action = 'tracker_floor_alert_transition'),
  'every successful Floor transition appends audit evidence'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.tracker_voice_events
    SET final_transcript = 'mutated'
    WHERE id = (
      SELECT id FROM public.tracker_voice_events
      WHERE event_kind = 'final_transcript'
      ORDER BY created_at, id
      LIMIT 1
    );
    RAISE EXCEPTION 'immutable event update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END;
$$;
SELECT public.tracker_voice_test_assert(
  NOT EXISTS (SELECT 1 FROM public.tracker_voice_events WHERE final_transcript = 'mutated'),
  'Voice event UPDATE is blocked by immutable trigger'
);

-- RLS matrix: Dealer sees only own stream; assigned Floor/Tracker see club
-- stream; cross-club actor sees none. Tables have no public write policy.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) > 0 FROM public.tracker_voice_events),
  'assigned Dealer can read own Voice events'
);
SELECT set_config('request.jwt.claim.sub', '81500000-0000-4000-8000-000000000001', false);
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) = 0 FROM public.tracker_voice_events),
  'cross-club Dealer cannot read another club Voice events'
);
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000001', false);
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) > 0 FROM public.tracker_voice_events)
  AND (SELECT count(*) > 0 FROM public.tracker_floor_alerts),
  'same-club Floor can read queue and Voice evidence'
);
RESET ROLE;

-- Analytics authorization returns scope only. Assigned Dealer, Tracker and
-- Floor pass; cross-club Floor fails. No raw hand/action payload is projected.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.authorize_tracker_player_analytics(
  '85000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset analytics_dealer_
SELECT set_config('request.jwt.claim.sub', '81400000-0000-4000-8000-000000000001', false);
SELECT public.authorize_tracker_player_analytics(
  '85000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset analytics_tracker_
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000001', false);
SELECT public.authorize_tracker_player_analytics(
  '85000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset analytics_floor_
SELECT set_config('request.jwt.claim.sub', '81600000-0000-4000-8000-000000000001', false);
SELECT public.authorize_tracker_player_analytics(
  '85000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset analytics_cross_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'analytics_dealer_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'analytics_tracker_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'analytics_floor_payload'::JSONB->>'ok')::BOOLEAN
  AND :'analytics_cross_payload'::JSONB->>'error' = 'actor_not_allowed'
  AND NOT (:'analytics_dealer_payload'::JSONB ? 'actions')
  AND NOT (:'analytics_dealer_payload'::JSONB ? 'hands'),
  'analytics auth is operational-only, club-scoped and aggregate-safe'
);

-- Inject a failure after alert/event/config writes but before commit. The
-- caught statement must roll back every intermediate row and config mutation.
CREATE OR REPLACE FUNCTION public.tracker_voice_test_fail_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action = 'tracker_floor_alert_opened' THEN
    RAISE EXCEPTION 'TRACKER_VOICE_INJECTED_AUDIT_FAILURE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tracker_voice_test_fail_audit
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tracker_voice_test_fail_audit();

SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
DO $$
DECLARE
  v_event_count BIGINT;
  v_alert_count BIGINT;
  v_audit_count BIGINT;
  v_state TEXT;
  v_failed BOOLEAN := false;
BEGIN
  SELECT count(*) INTO v_event_count FROM public.tracker_voice_events;
  SELECT count(*) INTO v_alert_count FROM public.tracker_floor_alerts;
  SELECT count(*) INTO v_audit_count FROM public.audit_logs;
  v_state := public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001');

  BEGIN
    PERFORM public._tracker_voice_register_validated_event(
      '81200000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000001',
      'gemini_live', 'gemini-3.5-transcribe-live', 'provider-injected', NULL, 'Goi Floor injected failure',
      '{"kind":"call_floor"}'::JSONB,
      v_state, 'assist', 'voice-event-inject-001', 'trace-inject-001',
      'enforce', true, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TRACKER_VOICE_INJECTED_AUDIT_FAILURE' THEN
      v_failed := true;
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM public.tracker_voice_test_assert(v_failed, 'injected failure was reached');
  PERFORM public.tracker_voice_test_assert(
    (SELECT count(*) = v_event_count FROM public.tracker_voice_events)
    AND (SELECT count(*) = v_alert_count FROM public.tracker_floor_alerts)
    AND (SELECT count(*) = v_audit_count FROM public.audit_logs)
    AND (SELECT correction_state = 'ready'
         FROM public.tracker_voice_configs
         WHERE tournament_table_id = '84000000-0000-4000-8000-000000000001'),
    'injected failure leaves zero partial event, alert, audit or config writes'
  );
END;
$$;

DROP TRIGGER trg_tracker_voice_test_fail_audit ON public.audit_logs;
DROP FUNCTION public.tracker_voice_test_fail_audit();

-- Floor V3 is the runtime authority. The test changes only synthetic rows and
-- proves that global/session/epoch failures deny Voice before any writer path.
UPDATE public.app_settings
SET value = 'false'::JSONB
WHERE key = 'tracker_voice_global_enabled';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.get_tracker_voice_runtime_context(
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset runtime_global_off_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'runtime_global_off_payload'::JSONB->>'error' = 'voice_global_disabled',
  'global Voice gate denies the exact assigned Dealer'
);

UPDATE public.app_settings
SET value = 'true'::JSONB
WHERE key = 'tracker_voice_global_enabled';
UPDATE public.table_sessions
SET control_mode = 'manual', control_epoch = control_epoch + 1
WHERE id = '83500000-0000-4000-8000-000000000002';
SELECT public.tracker_voice_test_assert(
  NOT (SELECT enabled FROM public.tracker_voice_configs WHERE tournament_table_id = '84000000-0000-4000-8000-000000000002'),
  'Manual transition disables its exact Voice config without deleting audit history'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.get_tracker_voice_runtime_context(
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset runtime_manual_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'runtime_manual_payload'::JSONB->>'error' = 'voice_table_session_not_tracker',
  'Manual session is an immediate server-side Voice kill path'
);

UPDATE public.table_sessions
SET control_mode = 'tracker', control_epoch = control_epoch + 1
WHERE id = '83500000-0000-4000-8000-000000000002';
UPDATE public.tracker_voice_configs
SET enabled = TRUE,
    control_epoch = 1
WHERE tournament_table_id = '84000000-0000-4000-8000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.get_tracker_voice_runtime_context(
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset runtime_stale_epoch_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'runtime_stale_epoch_payload'::JSONB->>'error' = 'voice_config_stale',
  'stale config epoch cannot authorize a reopened Tracker mode'
);

UPDATE public.tracker_voice_configs config_row
SET control_epoch = session_row.control_epoch
FROM public.table_sessions session_row
WHERE config_row.tournament_table_id = '84000000-0000-4000-8000-000000000002'
  AND session_row.id = config_row.table_session_id;
UPDATE public.table_sessions
SET closed_at = now()
WHERE id = '83500000-0000-4000-8000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT public.get_tracker_voice_runtime_context(
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
)::TEXT AS payload \gset runtime_closed_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'runtime_closed_payload'::JSONB->>'error' = 'voice_table_session_not_tracker',
  'closed session denies Voice even if its historical config remains'
);

SELECT 'TRACKER_VOICE_DISPOSABLE_DB_PASS' AS result;
