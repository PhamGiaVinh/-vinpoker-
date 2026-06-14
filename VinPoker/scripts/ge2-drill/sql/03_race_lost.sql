-- 03_race_lost.sql  — PHASE D ONLY (service-role, ADVERSARIAL).
-- Submits the disposable table's current hand with a STALE expected_state_version
-- (one behind live). The unchanged state conserves chips, so the only failing
-- backstop is G4(a) optimistic CAS → race_lost (returned before any write).
-- EXPECT: {"outcome":"race_lost","expected":<N-1>,"actual":<N>}

SET LOCAL ROLE service_role;
WITH h AS (
  SELECT id, state, state_version
  FROM public.online_poker_hands
  WHERE table_id = (SELECT id FROM public.online_poker_tables
                    WHERE name = 'GE2-DRILL-DISPOSABLE' ORDER BY created_at DESC LIMIT 1)
    AND status IN ('dealing','betting')
  ORDER BY hand_no DESC LIMIT 1
),
s AS (
  SELECT hs.seat_no, hs.user_id
  FROM public.online_poker_hand_seats hs JOIN h ON hs.hand_id = h.id
  WHERE hs.status = 'active' ORDER BY hs.seat_no LIMIT 1
)
SELECT public.op_submit_action(
  h.id,
  s.user_id,
  jsonb_build_object('type','check','seat',s.seat_no),
  h.state,                       -- unchanged → conservation holds
  '[]'::jsonb,
  '[]'::jsonb,
  h.state_version - 1,           -- STALE → CAS mismatch
  now() + interval '30 seconds',
  'ge2drill-race-' || gen_random_uuid()::text
) AS result
FROM h, s;
