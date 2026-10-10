\set ON_ERROR_STOP on
BEGIN;
SELECT public.show_hole_cards('10000000-0000-4000-8000-000000000030',
 '[{"player_id":"10000000-0000-4000-8000-000000000060","entry_number":1,"hole_cards":["Ah","As"]},{"player_id":"10000000-0000-4000-8000-000000000099","entry_number":1,"hole_cards":["Kh","Ks"]}]'::jsonb,auth.uid());
SELECT player_id,hole_cards FROM hand_players ORDER BY player_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM hand_players WHERE hole_cards<>'[]'::jsonb) THEN
  RAISE EXCEPTION 'REPRO_FAIL: error response left partial hole-card mutation';
 END IF;
END $$;
ROLLBACK;
