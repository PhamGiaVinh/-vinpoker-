-- ============================================================
-- UAT Test Scripts: Real-time Hand Tracking
-- Run these manually against your Supabase database (SQL Editor)
-- to verify race conditions, card validation, lock expiry, orphan cleanup.
-- ============================================================
-- Prerequisites:
--   - A tournament with at least 1 table and 2+ seated players
--   - Replace placeholder UUIDs below with actual IDs from your DB
-- ============================================================

-- ====================
-- 0. SETUP: Find test data
-- ====================
-- Replace these with actual values from your DB:
-- SELECT id FROM tournaments LIMIT 1;
-- SELECT id FROM tournament_tables WHERE tournament_id = '<tournament_id>' LIMIT 1;
-- SELECT player_id, entry_number, seat_number FROM tournament_seats WHERE tournament_id = '<tournament_id>' AND is_active = true LIMIT 2;

-- ====================
-- 1. validate_cards RPC Tests
-- ====================

-- 1a. Valid cards
SELECT public.validate_cards('["As","Kh","7d"]'::jsonb) AS result; -- Expected: 'ok'

-- 1b. Invalid card format
SELECT public.validate_cards('["Xs","Kh"]'::jsonb) AS result; -- Expected: 'Invalid card format'

-- 1c. Duplicate cards
SELECT public.validate_cards('["As","As"]'::jsonb) AS result; -- Expected: 'Duplicate cards in array'

-- 1d. Empty array
SELECT public.validate_cards('[]'::jsonb) AS result; -- Expected: 'ok'

-- 1e. NULL
SELECT public.validate_cards(NULL) AS result; -- Expected: 'ok'

-- 1f. All 4 suits of same rank
SELECT public.validate_cards('["As","Ah","Ad","Ac"]'::jsonb) AS result; -- Expected: 'ok'

-- 1g. Single card (invalid for hole cards, but validate_cards allows)
SELECT public.validate_cards('["As"]'::jsonb) AS result; -- Expected: 'ok'

-- ====================
-- 2. start_hand RPC Tests
-- ====================
-- Use actual IDs from step 0

-- 2a. Start a new hand (should succeed)
/*
SELECT public.start_hand(
  p_tournament_id := '<tournament_id>'::uuid,
  p_table_id := '<table_id>'::uuid,
  p_hand_number := 1,
  p_hand_time := NOW(),
  p_created_by := '<user_id>'::uuid
);
-- Expected: {"status": "success", "hand_id": "<uuid>"}
*/

-- 2b. Start second hand on same table while first is in_progress (should fail with "Table already has an active hand")
/*
SELECT public.start_hand(
  p_tournament_id := '<tournament_id>'::uuid,
  p_table_id := '<table_id>'::uuid,
  p_hand_number := 2,
  p_hand_time := NOW(),
  p_created_by := '<user_id>'::uuid
);
-- Expected: {"error": "Table already has an active hand", "hand_id": "<existing_hand_id>"}
*/

-- 2c. Verify hand was created with correct status
/*
SELECT id, status, created_by, locked_by_user_id, locked_at
FROM tournament_hands
WHERE tournament_id = '<tournament_id>'
ORDER BY created_at DESC LIMIT 1;
-- Expected: status = 'in_progress', created_by = user_id, locked_by_user_id = user_id, locked_at = recent timestamp
*/

-- ====================
-- 3. update_community_cards RPC Tests
-- ====================

-- 3a. Valid flop (3 cards)
/*
SELECT public.update_community_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_community_cards := '["As","Kh","7d"]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"status": "success"}
*/

-- 3b. Valid turn (4 cards)
/*
SELECT public.update_community_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_community_cards := '["As","Kh","7d","Tc"]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"status": "success"}
*/

-- 3c. Invalid card count (2 cards)
/*
SELECT public.update_community_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_community_cards := '["As","Kh"]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"error": "Invalid number of community cards", "count": 2}
*/

-- 3d. Duplicate cards in community
/*
SELECT public.update_community_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_community_cards := '["As","As","7d"]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"error": "Duplicate cards in array"}
*/

-- 3e. Wrong user tries to update (lock check)
/*
SELECT public.update_community_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_community_cards := '["As","Kh","7d","Tc","2h"]'::jsonb,
  p_user_id := '<different_user_id>'::uuid
);
-- Expected: {"error": "Hand is locked by another tracker", "locked_by": "<original_user_id>"}
*/

-- 3f. Update on completed hand (should fail)
/*
SELECT public.update_community_cards(
  p_hand_id := '<completed_hand_id>'::uuid,
  p_community_cards := '["As","Kh","7d"]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"error": "Hand is not in progress", "status": "completed"}
*/

-- ====================
-- 4. record_action RPC Tests
-- ====================

-- 4a. Record a valid preflop action
/*
SELECT public.record_action(
  p_hand_id := '<hand_id>'::uuid,
  p_player_id := '<player1_id>'::uuid,
  p_entry_number := 1,
  p_street := 'preflop',
  p_action_type := 'post_sb',
  p_action_amount := 500,
  p_action_order := 1
);
-- Expected: {"status": "success"}
*/

-- 4b. Record duplicate action_order (should silently succeed due to ON CONFLICT DO NOTHING)
/*
SELECT public.record_action(
  p_hand_id := '<hand_id>'::uuid,
  p_player_id := '<player1_id>'::uuid,
  p_entry_number := 1,
  p_street := 'preflop',
  p_action_type := 'post_sb',
  p_action_amount := 500,
  p_action_order := 1
);
-- Expected: {"status": "success"} (idempotent)
*/

-- 4c. Record action for player not in hand (should fail)
/*
SELECT public.record_action(
  p_hand_id := '<hand_id>'::uuid,
  p_player_id := '<random_uuid>'::uuid,
  p_entry_number := 1,
  p_street := 'preflop',
  p_action_type := 'fold',
  p_action_amount := 0,
  p_action_order := 2
);
-- Expected: {"error": "Player not found in this hand"}
*/

-- 4d. Record action on completed hand (should fail)
/*
SELECT public.record_action(
  p_hand_id := '<completed_hand_id>'::uuid,
  p_player_id := '<player1_id>'::uuid,
  p_entry_number := 1,
  p_street := 'preflop',
  p_action_type := 'fold',
  p_action_amount := 0,
  p_action_order := 99
);
-- Expected: {"error": "Hand is not in progress"}
*/

-- ====================
-- 5. show_hole_cards RPC Tests
-- ====================

-- 5a. Show valid hole cards (2 cards per player)
/*
SELECT public.show_hole_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_player_hole_cards := '[{"player_id": "<player1_id>", "entry_number": 1, "hole_cards": ["Ah", "Ks"]}]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"status": "success"}
*/

-- 5b. Duplicate card (same card in hole + community)
/*
SELECT public.show_hole_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_player_hole_cards := '[{"player_id": "<player1_id>", "entry_number": 1, "hole_cards": ["As", "Ks"]}]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- If As is in community_cards: {"error": "Card already used by another player or in community cards"}
*/

-- 5c. Not exactly 2 hole cards
/*
SELECT public.show_hole_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_player_hole_cards := '[{"player_id": "<player1_id>", "entry_number": 1, "hole_cards": ["Ah"]}]'::jsonb,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"error": "Must provide exactly 2 hole cards per player"}
*/

-- 5d. Wrong user (lock check)
/*
SELECT public.show_hole_cards(
  p_hand_id := '<hand_id>'::uuid,
  p_player_hole_cards := '[{"player_id": "<player1_id>", "entry_number": 1, "hole_cards": ["Ah", "Ks"]}]'::jsonb,
  p_user_id := '<different_user_id>'::uuid
);
-- Expected: {"error": "Hand is locked by another tracker"}
*/

-- ====================
-- 6. heartbeat_lock RPC Tests
-- ====================

-- 6a. Heartbeat by lock owner (should succeed)
/*
SELECT public.heartbeat_lock(
  p_hand_id := '<hand_id>'::uuid,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"status": "success", "locked_at": "<timestamp>"}
*/

-- 6b. Heartbeat by different user (should fail)
/*
SELECT public.heartbeat_lock(
  p_hand_id := '<hand_id>'::uuid,
  p_user_id := '<different_user_id>'::uuid
);
-- Expected: {"error": "Unauthorized: Hand is locked by another user"}
*/

-- 6c. Heartbeat on completed hand (should fail)
/*
SELECT public.heartbeat_lock(
  p_hand_id := '<completed_hand_id>'::uuid,
  p_user_id := '<user_id>'::uuid
);
-- Expected: {"error": "Hand is not in progress"}
*/

-- ====================
-- 7. Lock Expiry Simulation Tests
-- ====================

-- 7a. Simulate expired lock by manually setting locked_at to 11 minutes ago
/*
UPDATE tournament_hands
SET locked_at = NOW() - INTERVAL '11 minutes'
WHERE id = '<hand_id>'::uuid;

-- Now try start_hand on the same table - should void the expired hand and succeed
SELECT public.start_hand(
  p_tournament_id := '<tournament_id>'::uuid,
  p_table_id := '<table_id>'::uuid,
  p_hand_number := 999,
  p_hand_time := NOW(),
  p_created_by := '<user_id>'::uuid
);
-- Expected: {"status": "success", "hand_id": "<new_uuid>"}
-- The old hand should be voided, actions deleted, players reset
*/

-- 7b. Verify the old hand is voided
/*
SELECT id, status, is_voided, locked_by_user_id, locked_at
FROM tournament_hands
WHERE id = '<old_hand_id>'::uuid;
-- Expected: status = 'voided', is_voided = true, locked_by_user_id = NULL, locked_at = NULL
*/

-- ====================
-- 8. cleanup_orphan_hands Tests
-- ====================

-- 8a. Create an orphan hand (simulate by starting a hand, then check if cleanup catches it)
-- First set locked_at to older than 10 minutes:
/*
UPDATE tournament_hands
SET locked_at = NOW() - INTERVAL '15 minutes',
    created_at = NOW() - INTERVAL '15 minutes'
WHERE status = 'in_progress';

SELECT public.cleanup_orphan_hands('10 minutes'::interval);
-- Expected: voided_count > 0, voided_ids containing the orphan hand ids
*/

-- 8b. Hard cap test: hand older than 60 minutes
/*
UPDATE tournament_hands
SET locked_at = NOW() - INTERVAL '5 minutes',
    created_at = NOW() - INTERVAL '61 minutes'
WHERE status = 'in_progress';

SELECT public.cleanup_orphan_hands('10 minutes'::interval);
-- Expected: voided_count > 0 (should be caught by hard cap)
*/

-- 8c. Active hand (should NOT be cleaned up)
/*
UPDATE tournament_hands
SET locked_at = NOW()
WHERE status = 'in_progress';

SELECT public.cleanup_orphan_hands('10 minutes'::interval);
-- Expected: voided_count = 0
*/

-- ====================
-- 9. void_last_hand RPC Tests
-- ====================

-- 9a. Void a completed hand (should restore chips)
/*
SELECT public.void_last_hand('<completed_hand_id>'::uuid);
-- Expected: {"status": "success", "message": "Hand voided successfully"}
-- Verify chips were restored:
SELECT hp.player_id, hp.starting_stack, cc.chip_count
FROM hand_players hp
JOIN tournament_chip_counts cc ON cc.tournament_id = hp.tournament_id
  AND cc.player_id = hp.player_id
  AND cc.entry_number = hp.entry_number
WHERE hp.hand_id = '<completed_hand_id>'::uuid;
-- Expected: chip_count should match starting_stack
*/

-- 9b. Void an in_progress hand (should NOT restore chips, but delete actions)
/*
SELECT public.void_last_hand('<in_progress_hand_id>'::uuid);
-- Expected: {"status": "success", "message": "Hand voided successfully"}
-- Verify:
SELECT COUNT(*) FROM hand_actions WHERE hand_id = '<in_progress_hand_id>'::uuid;
-- Expected: 0 (actions deleted)
SELECT hole_cards, ending_stack, is_eliminated
FROM hand_players WHERE hand_id = '<in_progress_hand_id>'::uuid;
-- Expected: hole_cards = '[]', ending_stack = NULL, is_eliminated = false
*/

-- 9c. Void already voided hand
/*
SELECT public.void_last_hand('<voided_hand_id>'::uuid);
-- Expected: {"error": "Hand already voided"}
*/

-- ====================
-- 10. Race Condition Simulation
-- ====================
-- To test the unique_violation retry logic, open TWO SQL Editor tabs
-- and run start_hand simultaneously for the same table:

-- Tab 1:
/*
SELECT public.start_hand(
  p_tournament_id := '<tournament_id>'::uuid,
  p_table_id := '<table_id>'::uuid,
  p_hand_number := 100,
  p_hand_time := NOW(),
  p_created_by := '<user1_id>'::uuid
);
*/

-- Tab 2 (run immediately after):
/*
SELECT public.start_hand(
  p_tournament_id := '<tournament_id>'::uuid,
  p_table_id := '<table_id>'::uuid,
  p_hand_number := 101,
  p_hand_time := NOW(),
  p_created_by := '<user2_id>'::uuid
);
*/

-- Expected: Only one should succeed. The second should get:
-- {"error": "Table already has an active hand", "hand_id": "<winner_hand_id>"}

-- ====================
-- 11. record_hand UPSERT Tests
-- ====================

-- 11a. Submit a completed hand with players, actions, community cards
/*
SELECT public.record_hand(
  p_tournament_id := '<tournament_id>'::uuid,
  p_table_id := '<table_id>'::uuid,
  p_hand_number := 1,
  p_hand_time := NOW(),
  p_players := '[
    {"player_id": "<p1_id>", "entry_number": 1, "seat_number": 1, "starting_stack": 50000, "ending_stack": 65000, "is_eliminated": false, "hole_cards": [], "side_pots": []},
    {"player_id": "<p2_id>", "entry_number": 1, "seat_number": 2, "starting_stack": 50000, "ending_stack": 0, "is_eliminated": true, "hole_cards": [], "side_pots": []}
  ]'::jsonb,
  p_actions := '[
    {"player_id": "<p1_id>", "entry_number": 1, "street": "preflop", "action_type": "post_sb", "action_amount": 500, "action_order": 1},
    {"player_id": "<p2_id>", "entry_number": 1, "street": "preflop", "action_type": "post_bb", "action_amount": 1000, "action_order": 2}
  ]'::jsonb,
  p_community_cards := '["As","Kh","7d","Tc","2h"]'::jsonb,
  p_pot_size := 35000,
  p_created_by := '<user_id>'::uuid
);
-- Expected: {"hand_id": "<uuid>", "status": "success"}
*/

-- 11b. Verify players_remaining and average_stack were recalculated
/*
SELECT players_remaining, average_stack FROM tournaments WHERE id = '<tournament_id>'::uuid;
*/

-- 11c. Verify elimination was recorded
/*
SELECT * FROM tournament_eliminations WHERE tournament_id = '<tournament_id>'::uuid ORDER BY created_at DESC LIMIT 5;
*/

-- 11d. Verify tournament_chip_counts updated
/*
SELECT player_id, entry_number, chip_count FROM tournament_chip_counts WHERE tournament_id = '<tournament_id>'::uuid;
*/