-- 06_standup_guard.sql  — PHASE D ONLY (service-role probe of a self-RPC behaviour).
-- Proves GE-2J (20260908000000): a FOLDED player cannot stand up mid-hand.
-- Run while the disposable table 'GE2-DRILL-DISPOSABLE' has an ACTIVE hand in which at
-- least one seat has folded (status='folded'). NO mutation if the guard holds (the call
-- short-circuits at the in_active_hand check before any wallet/seat write).
--
-- op_stand_up binds to auth.uid(); to exercise it as a specific seated user from the
-- service-role console, impersonate that user's JWT claim for the call.
--
-- EXPECT: {"outcome":"in_active_hand"}  (pre-GE-2J this returned a successful cashout).
-- After the hand COMPLETES, the same call returns {"outcome":"ok", "cashed_out": <final
-- stack>} — verify cashed_out equals the seat's final online_poker_seats.stack (GE-2I).

-- Pick a folded seat in the current active hand on the disposable table.
WITH t AS (
  SELECT id FROM public.online_poker_tables
  WHERE name = 'GE2-DRILL-DISPOSABLE' ORDER BY created_at DESC LIMIT 1
),
h AS (
  SELECT id FROM public.online_poker_hands
  WHERE table_id = (SELECT id FROM t) AND status IN ('dealing','betting')
  ORDER BY hand_no DESC LIMIT 1
),
folded AS (
  SELECT hs.seat_no, hs.user_id
  FROM public.online_poker_hand_seats hs JOIN h ON hs.hand_id = h.id
  WHERE hs.status = 'folded' ORDER BY hs.seat_no LIMIT 1
)
SELECT
  (SELECT id FROM t)        AS table_id,
  folded.seat_no,
  folded.user_id,
  'expected: in_active_hand (GE-2J blocks folded mid-hand stand-up)' AS note
FROM folded;

-- Then, as that folded user (set request.jwt.claim.sub = folded.user_id), call:
--   SELECT public.op_stand_up(:table_id, 'ge2drill-standup-' || gen_random_uuid()::text);
-- EXPECT {"outcome":"in_active_hand"} while the hand is active;
-- EXPECT {"outcome":"ok","cashed_out":<final stack>} after the hand completes.
