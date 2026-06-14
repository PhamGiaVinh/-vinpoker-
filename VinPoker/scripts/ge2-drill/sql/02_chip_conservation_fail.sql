-- 02_chip_conservation_fail.sql  — PHASE D ONLY (service-role, ADVERSARIAL).
-- Submits a tampered new-state that CREATES 1000 chips (pot += 1000) for the
-- disposable table's current hand. Every other backstop is satisfied (the actor
-- owns the seat, hand active, version current, no negatives, no secrets), so the
-- ONLY thing that can reject it is G4(f) chip conservation — which is the N2-fixed
-- post-sum. A client (user JWT) cannot reach op_submit_action, hence service-role.
-- EXPECT: {"outcome":"rejected","detail":"chip conservation violated","pre":..,"post":..}

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
  jsonb_set(h.state, '{pot}', to_jsonb(((h.state->>'pot')::bigint + 1000)::text)),  -- +1000 chips → breaks conservation
  '[]'::jsonb,
  '[]'::jsonb,
  h.state_version,
  now() + interval '30 seconds',
  'ge2drill-ccfail-' || gen_random_uuid()::text
) AS result
FROM h, s;
