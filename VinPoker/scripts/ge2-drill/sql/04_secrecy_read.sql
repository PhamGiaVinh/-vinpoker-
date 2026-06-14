-- 04_secrecy_read.sql  — PHASE D (read-only) secrecy proof on the public rail.
-- The public online_poker_hands.state must NEVER carry the deck or any hole cards;
-- secrets live ONLY in online_poker_hand_secrets and are reachable solely via
-- op_get_my_hole_cards (auth.uid()-scoped — proven through the Edge harness).
-- EXPECT: has_deck = false, has_holecards = false; secrets_kinds = {board_future,deck,hole}.

WITH t AS (
  SELECT id FROM public.online_poker_tables
  WHERE name = 'GE2-DRILL-DISPOSABLE' ORDER BY created_at DESC LIMIT 1
),
h AS (
  SELECT id, state FROM public.online_poker_hands
  WHERE table_id = (SELECT id FROM t) ORDER BY hand_no DESC LIMIT 1
)
SELECT
  h.id AS hand_id,
  (h.state ? 'deck') AS has_deck,
  EXISTS (SELECT 1 FROM jsonb_array_elements(h.state->'seats') x WHERE x ? 'holeCards') AS has_holecards,
  (SELECT array_agg(DISTINCT kind ORDER BY kind)
   FROM public.online_poker_hand_secrets WHERE hand_id = h.id) AS secrets_kinds
FROM h;
