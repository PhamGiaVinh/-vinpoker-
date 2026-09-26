\set ON_ERROR_STOP on

-- Extend the focused assignment fixture with the columns used by the exact
-- production Dealer Swing executor. All rows are synthetic/disposable.
ALTER TABLE public.dealer_attendance
  ADD COLUMN check_in_time timestamptz NOT NULL DEFAULT now() - interval '30 minutes',
  ADD COLUMN overtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN priority_break_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN worked_minutes_since_last_break integer NOT NULL DEFAULT 0,
  ADD COLUMN total_worked_minutes_today integer NOT NULL DEFAULT 0,
  ADD COLUMN last_released_at timestamptz,
  ADD COLUMN pool_entered_at timestamptz;

ALTER TABLE public.dealer_assignments
  ADD COLUMN pre_assigned_attendance_id uuid,
  ADD COLUMN pre_assigned_at timestamptz,
  ADD COLUMN swing_processed_at timestamptz,
  ADD COLUMN overtime_started_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX swing_test_one_active_per_dealer
  ON public.dealer_assignments(attendance_id)
  WHERE released_at IS NULL AND status IN ('assigned', 'on_break');

CREATE TABLE public.dealers (
  id uuid PRIMARY KEY,
  full_name text NOT NULL
);
CREATE TABLE public.dealer_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  break_start timestamptz NOT NULL,
  break_end timestamptz,
  expected_duration_minutes integer,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.swing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid,
  outcome text,
  club_id uuid,
  table_id uuid,
  triggered_by text,
  metadata jsonb
);

\ir ../../supabase/migrations/20260817000003_fix_executor_step9_incoming_credit.sql
\ir ../../supabase/migrations/20270115000017_dealer_assignment_session_binding.sql
\ir ../../supabase/migration-archive/historical-never-replay/20260801000007_resolve_execute_pre_assigned_rpc_ambiguity.sql

INSERT INTO public.dealers(id, full_name) VALUES
  ('41000000-0000-4000-8000-000000000001', 'Swing A'),
  ('41000000-0000-4000-8000-000000000002', 'Swing B'),
  ('41000000-0000-4000-8000-000000000003', 'Swing C'),
  ('41000000-0000-4000-8000-000000000004', 'Swing D'),
  ('41000000-0000-4000-8000-000000000005', 'Swing E'),
  ('41000000-0000-4000-8000-000000000006', 'Swing F'),
  ('41000000-0000-4000-8000-000000000007', 'Swing G'),
  ('41000000-0000-4000-8000-000000000008', 'Swing H');

INSERT INTO public.game_tables(id, club_id, table_name, status) VALUES
  ('11000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Swing Session', 'active'),
  ('11000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Swing Legacy', 'active'),
  ('11000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Swing Ambiguous', 'active'),
  ('11000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Swing Rollover', 'active');

INSERT INTO public.table_sessions(id, club_id, game_table_id, session_type, control_mode) VALUES
  ('51000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'tournament', 'tracker'),
  ('51000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'tournament', 'tracker'),
  ('51000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'tournament', 'tracker'),
  ('51000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'tournament', 'tracker');
UPDATE public.table_sessions SET closed_at = now()
WHERE id = '51000000-0000-4000-8000-000000000041';
INSERT INTO public.table_sessions(id, club_id, game_table_id, session_type, control_mode) VALUES
  ('51000000-0000-4000-8000-000000000042', '20000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'tournament', 'tracker');

INSERT INTO public.dealer_attendance(id, dealer_id, current_state, status) VALUES
  ('31000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'pre_assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000003', 'assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000004', 'pre_assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000005', '41000000-0000-4000-8000-000000000005', 'assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000006', '41000000-0000-4000-8000-000000000006', 'pre_assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000007', '41000000-0000-4000-8000-000000000007', 'assigned', 'checked_in'),
  ('31000000-0000-4000-8000-000000000008', '41000000-0000-4000-8000-000000000008', 'pre_assigned', 'checked_in');

INSERT INTO public.dealer_assignments(id, attendance_id, table_id, club_id, status, assigned_at, idempotency_key) VALUES
  ('61000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'assigned', now() - interval '30 minutes', 'old-session'),
  ('61000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'assigned', now() - interval '30 minutes', 'old-legacy'),
  ('61000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'assigned', now() - interval '30 minutes', 'old-ambiguous'),
  ('61000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'assigned', now() - interval '30 minutes', 'old-rollover');
UPDATE public.dealer_assignments
SET table_session_id = '51000000-0000-4000-8000-000000000041'
WHERE id = '61000000-0000-4000-8000-000000000004';

SELECT public.execute_pre_assigned_swing_rpc(
  '61000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', now() + interval '30 minutes', 30, false, 15
) AS result \gset exact_
SELECT public.assert_true(:'exact_result'::jsonb->>'status' = 'success', 'exact session swing succeeds');
SELECT public.assert_true(
  (SELECT table_session_id = '51000000-0000-4000-8000-000000000001'::uuid
   FROM public.dealer_assignments WHERE id = (:'exact_result'::jsonb->>'new_assignment_id')::uuid),
  'swing assignment binds the active exact session'
);
SELECT public.assert_true(
  (SELECT attendance_id = '31000000-0000-4000-8000-000000000002'::uuid
   FROM public.dealer_assignments
   WHERE table_session_id = '51000000-0000-4000-8000-000000000001' AND status = 'assigned' AND released_at IS NULL),
  'runtime authority transfers from outgoing A to incoming B'
);

-- A retry cannot create a duplicate or credit worked time twice.
SELECT public.execute_pre_assigned_swing_rpc(
  '61000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', now() + interval '30 minutes', 30, false, 15
) AS result \gset retry_
SELECT public.assert_true(:'retry_result'::jsonb->>'error' = 'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED', 'retry fails closed');
SELECT public.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_assignments WHERE idempotency_key = 'pre_assign_61000000-0000-4000-8000-000000000001'),
  'retry creates no duplicate assignment'
);

SELECT public.execute_pre_assigned_swing_rpc(
  '61000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000004', now() + interval '30 minutes', 30, false, 15
) AS result \gset legacy_
SELECT public.assert_true(:'legacy_result'::jsonb->>'status' = 'success', 'legacy swing succeeds');
SELECT public.assert_true(
  (SELECT table_session_id IS NULL FROM public.dealer_assignments WHERE id = (:'legacy_result'::jsonb->>'new_assignment_id')::uuid),
  'zero-session legacy swing remains sessionless'
);

SELECT public.execute_pre_assigned_swing_rpc(
  '61000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000006', now() + interval '30 minutes', 30, false, 15
) AS result \gset ambiguous_
SELECT public.assert_true(:'ambiguous_result'::jsonb->>'error' = 'TABLE_SESSION_AMBIGUOUS', 'ambiguous session fails closed');
SELECT public.assert_true(
  (SELECT status = 'assigned' AND released_at IS NULL FROM public.dealer_assignments WHERE id = '61000000-0000-4000-8000-000000000003'),
  'ambiguous failure leaves outgoing assignment untouched'
);
SELECT public.assert_true(
  (SELECT current_state = 'pre_assigned' FROM public.dealer_attendance WHERE id = '31000000-0000-4000-8000-000000000006'),
  'ambiguous failure leaves incoming attendance untouched'
);
UPDATE public.table_sessions
SET closed_at = now()
WHERE game_table_id = '11000000-0000-4000-8000-000000000003';
SELECT public.execute_pre_assigned_swing_rpc(
  '61000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000006', now() + interval '30 minutes', 30, false, 15
) AS result \gset closed_
SELECT public.assert_true(:'closed_result'::jsonb->>'error' = 'TABLE_SESSION_CLOSED', 'closed session fails closed');
SELECT public.assert_true(
  NOT EXISTS (SELECT 1 FROM public.dealer_assignments WHERE idempotency_key = 'pre_assign_61000000-0000-4000-8000-000000000003'),
  'closed session failure creates no assignment'
);

SELECT public.assert_true(
  (SELECT id = '51000000-0000-4000-8000-000000000042'::uuid
   FROM public.table_sessions
   WHERE game_table_id = '11000000-0000-4000-8000-000000000004' AND closed_at IS NULL),
  'close-reopen fixture exposes only the new session identity'
);
SELECT public.execute_pre_assigned_swing_rpc(
  '61000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000008', now() + interval '30 minutes', 30, false, 15
) AS result \gset rollover_
SELECT public.assert_true(:'rollover_result'::jsonb->>'error' = 'TABLE_SESSION_STALE', 'close-reopen stale assignment fails closed');
SELECT public.assert_true(
  NOT EXISTS (SELECT 1 FROM public.dealer_assignments WHERE idempotency_key = 'pre_assign_61000000-0000-4000-8000-000000000004'),
  'close-reopen stale failure creates no assignment on B'
);

SELECT 'SWING_EXECUTOR_SESSION_BINDING=PASS';
