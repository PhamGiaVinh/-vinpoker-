-- 05_settlement_writeback.sql  — PHASE D ONLY (service-role, READ-ONLY assertion).
-- Proves GE-2I (20260906000000) settlement seat writeback. Run AFTER a hand on the
-- disposable table 'GE2-DRILL-DISPOSABLE' has been played to completion (status='complete')
-- — e.g. step 2 of the GE-2H alpha acceptance plan. NO mutation; safe to re-run.
--
-- EXPECT: the SELECT shows every dealt seat with match=true (online_poker_seats.stack equals
--   the final online_poker_hand_seats.stack — winner delta>0, loser delta<0), and the DO block
--   raises NOTICE 'GE2I-VERIFY PASS …' (it RAISEs EXCEPTION on any mismatch / broken conservation).

SET LOCAL ROLE service_role;

-- (A) Per-seat writeback view: starting → final hand stack → table seat stack.
WITH t AS (
  SELECT id FROM public.online_poker_tables
  WHERE name = 'GE2-DRILL-DISPOSABLE' ORDER BY created_at DESC LIMIT 1
),
h AS (
  SELECT id FROM public.online_poker_hands
  WHERE table_id = (SELECT id FROM t) AND status = 'complete'
  ORDER BY hand_no DESC LIMIT 1
)
SELECT
  hs.seat_no,
  hs.user_id,
  hs.starting_stack,
  hs.stack                         AS final_hand_stack,
  s.stack                          AS seat_stack,
  (s.stack = hs.stack)             AS match,
  (hs.stack - hs.starting_stack)   AS delta          -- winner > 0, loser < 0
FROM public.online_poker_hand_seats hs
JOIN h ON hs.hand_id = h.id
JOIN public.online_poker_seats s
  ON s.table_id = (SELECT id FROM t)
 AND s.seat_no  = hs.seat_no
 AND s.user_id  = hs.user_id
ORDER BY hs.seat_no;

-- (B) Assertions: writeback applied to every still-seated dealt player + chip conservation.
DO $$
DECLARE
  v_table    uuid := (SELECT id FROM public.online_poker_tables
                      WHERE name = 'GE2-DRILL-DISPOSABLE' ORDER BY created_at DESC LIMIT 1);
  v_hand     uuid;
  v_mismatch int;
  v_start_sum bigint;
  v_final_sum bigint;
BEGIN
  SELECT id INTO v_hand FROM public.online_poker_hands
  WHERE table_id = v_table AND status = 'complete' ORDER BY hand_no DESC LIMIT 1;
  IF v_hand IS NULL THEN
    RAISE EXCEPTION 'GE2I-VERIFY: no completed hand on the disposable table — play a hand first';
  END IF;

  -- (1) Writeback applied: every still-seated dealt player's seat stack == final hand stack.
  SELECT count(*) INTO v_mismatch
  FROM public.online_poker_hand_seats hs
  JOIN public.online_poker_seats s
    ON s.table_id = v_table AND s.seat_no = hs.seat_no AND s.user_id = hs.user_id
  WHERE hs.hand_id = v_hand AND s.stack <> hs.stack;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'GE2I-VERIFY: % dealt seat(s) NOT written back to online_poker_seats', v_mismatch;
  END IF;

  -- (2) Chip conservation: the engine guarantees Σ(final) = Σ(starting) for the hand.
  SELECT COALESCE(SUM(starting_stack), 0), COALESCE(SUM(stack), 0)
    INTO v_start_sum, v_final_sum
  FROM public.online_poker_hand_seats WHERE hand_id = v_hand;
  IF v_start_sum <> v_final_sum THEN
    RAISE EXCEPTION 'GE2I-VERIFY: conservation broken: Σstart=% Σfinal=%', v_start_sum, v_final_sum;
  END IF;

  RAISE NOTICE 'GE2I-VERIFY PASS: writeback applied + chip conservation holds (table total=%)', v_final_sum;
END $$;
