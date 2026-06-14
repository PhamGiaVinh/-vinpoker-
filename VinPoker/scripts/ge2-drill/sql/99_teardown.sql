-- 99_teardown.sql  — PHASE D cleanup. Removes the disposable drill table and its
-- hands/seats/secrets/events/ledger, scoped to 'GE2-DRILL-DISPOSABLE' ONLY.
-- Touches NOTHING outside the disposable play-money table. Children first (no
-- assumed ON DELETE CASCADE). Run as service_role / postgres via the keyring helper.
-- Optionally also clears the two test wallets — set __P1_UID__/__P2_UID__ first,
-- or skip that final block (the wallets are harmless play-money rows).

SET LOCAL ROLE service_role;
WITH t AS (
  SELECT id FROM public.online_poker_tables WHERE name = 'GE2-DRILL-DISPOSABLE'
),
hh AS (
  SELECT id FROM public.online_poker_hands WHERE table_id IN (SELECT id FROM t)
)
DELETE FROM public.online_poker_hand_events  WHERE hand_id IN (SELECT id FROM hh);
DELETE FROM public.online_poker_hand_secrets WHERE hand_id IN
  (SELECT id FROM public.online_poker_hands WHERE table_id IN
    (SELECT id FROM public.online_poker_tables WHERE name = 'GE2-DRILL-DISPOSABLE'));
DELETE FROM public.online_poker_hand_seats   WHERE hand_id IN
  (SELECT id FROM public.online_poker_hands WHERE table_id IN
    (SELECT id FROM public.online_poker_tables WHERE name = 'GE2-DRILL-DISPOSABLE'));
DELETE FROM public.online_poker_chip_ledger  WHERE table_id IN
  (SELECT id FROM public.online_poker_tables WHERE name = 'GE2-DRILL-DISPOSABLE');
DELETE FROM public.online_poker_hands        WHERE table_id IN
  (SELECT id FROM public.online_poker_tables WHERE name = 'GE2-DRILL-DISPOSABLE');
DELETE FROM public.online_poker_seats        WHERE table_id IN
  (SELECT id FROM public.online_poker_tables WHERE name = 'GE2-DRILL-DISPOSABLE');
DELETE FROM public.online_poker_tables       WHERE name = 'GE2-DRILL-DISPOSABLE';

-- Optional test-wallet cleanup (uncomment + fill the two test user UUIDs):
-- DELETE FROM public.online_poker_chip_ledger     WHERE user_id IN ('__P1_UID__','__P2_UID__');
-- DELETE FROM public.online_poker_player_accounts  WHERE user_id IN ('__P1_UID__','__P2_UID__');
