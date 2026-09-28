\set ON_ERROR_STOP on

-- Disposable PostgreSQL 17 only. All identities and rows are synthetic.
DO $catalog$
DECLARE
  v_report oid := pg_catalog.to_regprocedure(
    'public.report_tracker_wrong_hand_v1(uuid,uuid,uuid,bigint,uuid)'
  );
BEGIN
  IF v_report IS NULL THEN RAISE EXCEPTION 'wrong_hand_report_missing'; END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_report, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_report, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_report, 'EXECUTE') THEN
    RAISE EXCEPTION 'wrong_hand_report_grants_wrong';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracker_floor_alerts'
      AND column_name IN ('dealer_id', 'assignment_id') AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'whole_hand_alert_references_not_nullable';
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id) VALUES
  ('91100000-0000-4000-8000-000000000001'),
  ('91100000-0000-4000-8000-000000000002'),
  ('91100000-0000-4000-8000-000000000003'),
  ('91100000-0000-4000-8000-000000000004'),
  ('91100000-0000-4000-8000-000000000005');

INSERT INTO public.clubs(id, owner_id, name, region) VALUES
  ('91000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'Correction TEST Club', 'TEST'),
  ('91000000-0000-4000-8000-000000000002', '91100000-0000-4000-8000-000000000005', 'Correction Other TEST Club', 'TEST');
INSERT INTO public.club_floors(club_id, user_id) VALUES
  ('91000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000003'),
  ('91000000-0000-4000-8000-000000000002', '91100000-0000-4000-8000-000000000005');
INSERT INTO public.club_trackers(club_id, user_id, granted_by) VALUES
  ('91000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000004', '91100000-0000-4000-8000-000000000001');

INSERT INTO public.tournaments(id, club_id, name, status) VALUES
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Correction S1 TEST', 'active'),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'Other Club TEST', 'active');
INSERT INTO public.game_tables(id, club_id, table_name) VALUES
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Correction Table 1'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Correction Table 2');
INSERT INTO public.table_sessions(
  id, club_id, game_table_id, session_type, tournament_id, control_mode, control_epoch
) VALUES
  ('93500000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'tournament', '95000000-0000-4000-8000-000000000001', 'tracker', 1),
  ('93500000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'tournament', '95000000-0000-4000-8000-000000000001', 'tracker', 1);
INSERT INTO public.tournament_tables(
  id, tournament_id, table_id, game_table_id, table_session_id,
  table_number, status, table_name, floor_control_mode
) VALUES
  ('94000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '93500000-0000-4000-8000-000000000001', 1, 'active', 'Correction Table 1', 'tracker'),
  ('94000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', '93500000-0000-4000-8000-000000000002', 2, 'active', 'Correction Table 2', 'tracker');

INSERT INTO public.dealers(id, club_id, user_id, full_name, status) VALUES
  ('97000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000004', 'Tracker TEST', 'active');
INSERT INTO public.dealer_attendance(id, dealer_id, current_state, status) VALUES
  ('97500000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'assigned', 'checked_in');
INSERT INTO public.dealer_assignments(
  id, dealer_id, attendance_id, table_id, table_session_id, club_id, assigned_at, status
) VALUES (
  '98000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001',
  '97500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
  '93500000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', now(), 'assigned'
);

INSERT INTO public.tournament_hands(
  id, tournament_id, table_id, tournament_table_id, table_session_id,
  hand_number, status, button_seat, created_by, source_revision,
  locked_by_user_id, locked_at
) VALUES
  ('96000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '93500000-0000-4000-8000-000000000001', 1, 'in_progress', 1, '91100000-0000-4000-8000-000000000004', 7, '91100000-0000-4000-8000-000000000004', now()),
  ('96000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', '93500000-0000-4000-8000-000000000002', 2, 'in_progress', 1, '91100000-0000-4000-8000-000000000004', 3, '91100000-0000-4000-8000-000000000004', now());

INSERT INTO public.tracker_correction_uat_scopes(
  club_id, tournament_id, tournament_table_id, user_id, capability, enabled
) VALUES
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'report_wrong_action', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000002', 'report_wrong_action', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000002', 'undo_open_hand', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000003', 'report_wrong_action', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000004', 'report_wrong_action', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000004', 'undo_open_hand', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'undo_open_hand', true),
  ('91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000005', 'report_wrong_action', true);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000002', false);
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000001'
)::text AS payload \gset floor_report_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'floor_report_payload'::jsonb->>'ok')::boolean
  AND NOT (:'floor_report_payload'::jsonb->>'duplicate')::boolean
  AND (:'floor_report_payload'::jsonb->>'voice_config_updated')::boolean IS FALSE
  AND :'floor_report_payload'::jsonb->>'progression_guard' = 'tracker_floor_alert'
  AND NOT EXISTS (SELECT 1 FROM public.tracker_voice_configs WHERE tournament_table_id = '94000000-0000-4000-8000-000000000001')
  AND EXISTS (
    SELECT 1 FROM public.tracker_floor_alerts
    WHERE id = (:'floor_report_payload'::jsonb->>'alert_id')::uuid
      AND dealer_id IS NULL AND assignment_id IS NULL AND source_action_id IS NULL
  ),
  'Floor whole-hand report succeeds without Dealer, assignment, action, or Voice config'
);

-- Response-loss retry returns the original receipt; changing any request
-- identity behind the same key is rejected before another write.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000002', false);
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000001'
)::text AS payload \gset floor_retry_
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000001'
)::text AS payload \gset floor_conflict_
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 6,
  '99000000-0000-4000-8000-000000000002'
)::text AS payload \gset floor_stale_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'floor_retry_payload'::jsonb->>'duplicate')::boolean
  AND :'floor_retry_payload'::jsonb->>'alert_id' = :'floor_report_payload'::jsonb->>'alert_id'
  AND :'floor_conflict_payload'::jsonb->>'error' = 'request_key_conflict'
  AND :'floor_stale_payload'::jsonb->>'error' = 'stale_source_revision'
  AND (SELECT count(*) = 1 FROM public.tracker_floor_alerts WHERE reported_by = '91100000-0000-4000-8000-000000000002'),
  'whole-hand report is idempotent, payload-bound, and revision-fenced'
);

-- The helper's two original callers retain exact Tracker + Dealer assignment
-- + live-lock authority. Tracker whole-hand reporting also remains lock-bound.
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000004', false);
SELECT public._tracker_correction_uat_context(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 'report_wrong_action'
)::text AS payload \gset tracker_action_context_
SELECT public._tracker_correction_uat_context(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 'undo_open_hand'
)::text AS payload \gset tracker_undo_context_
UPDATE public.tournament_hands
SET locked_by_user_id = '91100000-0000-4000-8000-000000000001'
WHERE id = '96000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000009'
)::text AS payload \gset tracker_without_lock_
RESET ROLE;
UPDATE public.tournament_hands
SET locked_by_user_id = '91100000-0000-4000-8000-000000000004', locked_at = now()
WHERE id = '96000000-0000-4000-8000-000000000001';
SELECT public.tracker_voice_test_assert(
  (:'tracker_action_context_payload'::jsonb->>'ok')::boolean
  AND (:'tracker_undo_context_payload'::jsonb->>'ok')::boolean
  AND :'tracker_without_lock_payload'::jsonb->>'error' = 'tracker_lock_not_owned',
  'original action and undo authority remains exact while Tracker whole-hand report requires the lock'
);

-- Exact tenant and session fences reject a scoped actor from another club and
-- a hand whose persisted session does not match the table's current session.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000005', false);
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000003'
)::text AS payload \gset cross_club_
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000002', false);
SELECT public.report_tracker_wrong_hand_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000002', 3,
  '99000000-0000-4000-8000-000000000004'
)::text AS payload \gset wrong_session_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'cross_club_payload'::jsonb->>'error' = 'actor_not_allowed'
  AND :'wrong_session_payload'::jsonb->>'error' = 'stale_tracker_context',
  'whole-hand report enforces tenant and exact table-session-hand lineage'
);

-- A Floor reporting scope cannot be reused for action-level report or undo.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000002', false);
SELECT public.report_tracker_wrong_action_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '99900000-0000-4000-8000-000000000001', '{}'::jsonb, 7,
  '99000000-0000-4000-8000-000000000010'
)::text AS payload \gset floor_action_
SELECT public.undo_tracker_last_action_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '99900000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000011'
)::text AS payload \gset floor_undo_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'floor_action_payload'::jsonb->>'error' = 'actor_not_allowed'
  AND :'floor_undo_payload'::jsonb->>'error' = 'actor_not_allowed',
  'Floor whole-hand reporting does not grant action report or undo authority'
);

-- Canonical is_club_tracker includes the club owner. Preserve that old helper
-- meaning, then fail closed because the owner has no exact Dealer assignment.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000001', false);
SELECT public.report_tracker_wrong_action_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '99900000-0000-4000-8000-000000000001', '{}'::jsonb, 7,
  '99000000-0000-4000-8000-000000000005'
)::text AS payload \gset owner_action_
SELECT public.undo_tracker_last_action_v1(
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '99900000-0000-4000-8000-000000000001', 7,
  '99000000-0000-4000-8000-000000000006'
)::text AS payload \gset owner_undo_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'owner_action_payload'::jsonb->>'error' = 'dealer_assignment_not_unique'
  AND :'owner_undo_payload'::jsonb->>'error' = 'dealer_assignment_not_unique',
  'Owner without an exact Dealer assignment cannot report an action or undo'
);

-- The alert row, not tracker_voice_configs, is the canonical progression
-- pause. Both the action writer and hand progression trigger fail closed.
DO $progression$
DECLARE
  v_action_blocked boolean := false;
  v_hand_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.hand_actions(
      hand_id, player_id, entry_number, street, action_type, action_amount, action_order
    ) VALUES (
      '96000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001', 1, 'preflop', 'check', 0, 1
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'tracker_correction_pending' THEN v_action_blocked := true; ELSE RAISE; END IF;
  END;
  BEGIN
    UPDATE public.tournament_hands
    SET community_cards = '["As","Kd","Qc"]'::jsonb
    WHERE id = '96000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'tracker_correction_pending' THEN v_hand_blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT v_action_blocked OR NOT v_hand_blocked THEN
    RAISE EXCEPTION 'whole_hand_report_progression_guard_failed';
  END IF;
END;
$progression$;

-- Two independent Floor users can report the same exact hand concurrently;
-- each request remains actor-scoped and gets its own durable receipt.
CREATE OR REPLACE FUNCTION public.tracker_correction_test_report_as(
  p_actor uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text,
    true
  );
  RETURN public.report_tracker_wrong_hand_v1(
    '95000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001', 7, p_request_id
  );
END;
$$;
CREATE TEMP TABLE tracker_correction_concurrency_results(payload jsonb);
SELECT dblink_connect('correction_floor_a', 'dbname=' || current_database());
SELECT dblink_connect('correction_floor_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'correction_floor_a',
  $$SELECT public.tracker_correction_test_report_as(
    '91100000-0000-4000-8000-000000000002',
    '99000000-0000-4000-8000-000000000007'
  )::text$$
);
SELECT dblink_send_query(
  'correction_floor_b',
  $$SELECT public.tracker_correction_test_report_as(
    '91100000-0000-4000-8000-000000000003',
    '99000000-0000-4000-8000-000000000008'
  )::text$$
);
INSERT INTO tracker_correction_concurrency_results(payload)
SELECT result::jsonb FROM dblink_get_result('correction_floor_a') AS t(result text);
INSERT INTO tracker_correction_concurrency_results(payload)
SELECT result::jsonb FROM dblink_get_result('correction_floor_b') AS t(result text);
SELECT dblink_disconnect('correction_floor_a');
SELECT dblink_disconnect('correction_floor_b');
SELECT public.tracker_voice_test_assert(
  (SELECT count(*) = 2 FROM tracker_correction_concurrency_results WHERE payload->>'ok' = 'true')
  AND (SELECT count(DISTINCT payload->>'alert_id') = 2 FROM tracker_correction_concurrency_results)
  AND (SELECT count(*) = 2 FROM public.tracker_floor_alerts
       WHERE request_id IN (
         '99000000-0000-4000-8000-000000000007',
         '99000000-0000-4000-8000-000000000008'
       )),
  'two concurrent Floor reporters receive separate actor-scoped receipts'
);

-- Owner direct RLS and the shared reader both preserve NULL references.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000001', false);
SELECT count(*) AS value FROM public.tracker_floor_alerts
WHERE id = (:'floor_report_payload'::jsonb->>'alert_id')::uuid \gset owner_rls_
SELECT public.list_tracker_floor_alerts(
  '95000000-0000-4000-8000-000000000001', NULL
)::text AS payload \gset owner_list_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :owner_rls_value::integer = 1
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(:'owner_list_payload'::jsonb->'alerts') item
    WHERE item->>'id' = :'floor_report_payload'::jsonb->>'alert_id'
      AND item ? 'dealer_id' AND item->'dealer_id' = 'null'::jsonb
      AND item ? 'assignment_id' AND item->'assignment_id' = 'null'::jsonb
      AND item ? 'source_action_id' AND item->'source_action_id' = 'null'::jsonb
  ),
  'Owner readers retain whole-hand alerts with nullable references'
);

DROP FUNCTION public.tracker_correction_test_report_as(uuid, uuid);

SELECT 'TRACKER_CORRECTION_FLOOR_TRACKER_AUTHORITY_PG17_PASS' AS result;
