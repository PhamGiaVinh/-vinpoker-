-- Floor permits positive equal blinds (e.g. its standard 100/100 opening level).
-- Align only that validation across snapshot/correction/public history. No data
-- rewrite, permission changes, outcome calculation, or history backfill.
-- ROLLBACK: restore the four precondition-pinned definitions from the recovery
-- artifact with a forward migration; do not erase any newly recorded hands.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $repair$
DECLARE
  item record;
  function_oid regprocedure;
  definition text;
  before_source text;
  after_definition text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('floor_private.snapshot_tracker_hand_blinds()', 'cde82ba45e43cd86484f41a5756f383f'),
    ('public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,integer,bigint,bigint,bigint,text,text,jsonb)', 'c938ed619ab12922ded44c6baf3420d0'),
    ('public.get_tracker_historical_display_queue_status(uuid)', '9500756b78a1c35eb5d82647b9deb7bd'),
    ('public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamp with time zone,uuid)', '5d65f60488da98956103b4f1a1c2a8f5')
  ) AS definitions(signature, expected_md5)
  LOOP
    function_oid := to_regprocedure(item.signature);
    SELECT prosrc INTO before_source FROM pg_proc WHERE oid = function_oid;
    IF function_oid IS NULL OR md5(before_source) <> item.expected_md5 THEN
      RAISE EXCEPTION 'equal_blinds_definition_drift: %', item.signature;
    END IF;
    definition := pg_get_functiondef(function_oid);
    after_definition := replace(definition, 'v_level.big_blind <= v_level.small_blind', 'v_level.big_blind < v_level.small_blind');
    after_definition := replace(after_definition, 'p_big_blind <= p_small_blind', 'p_big_blind < p_small_blind');
    after_definition := replace(after_definition, 'v_hand.tracker_big_blind > v_hand.tracker_small_blind', 'v_hand.tracker_big_blind >= v_hand.tracker_small_blind');
    after_definition := replace(after_definition, 'h.tracker_big_blind <= h.tracker_small_blind', 'h.tracker_big_blind < h.tracker_small_blind');
    after_definition := replace(after_definition, 'p.tracker_big_blind > p.tracker_small_blind', 'p.tracker_big_blind >= p.tracker_small_blind');
    IF after_definition = definition THEN
      RAISE EXCEPTION 'equal_blinds_validation_seam_missing: %', item.signature;
    END IF;
    -- CREATE OR REPLACE retains each exact ABI, owner and existing ACL.
    EXECUTE after_definition;
  END LOOP;
END;
$repair$;
COMMIT;
