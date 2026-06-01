-- 20260703000002_cleanup_stale_attendance_dupes.sql
-- Clean up stale duplicate dealer_attendance records that cause:
--   1. pickNextDealer Step 5 false-positive busy marking (now fixed in .ts)
--   2. UI lineup showing dealers in wrong state (duplicate entries)
--
-- Root cause: some dealers have multiple checked_in attendance records
-- where the older record is stuck in 'assigned'/'pre_assigned'/'available'
-- even though the dealer has a newer, correct record for their current shift.
-- Records with shift_id IS NULL are orphaned from prior shifts.

-- Step 1: Identify dealers with duplicate active checked_in records
-- For each dealer, keep the LATEST record (by id or check_in_time)
-- and mark older records as checked_out.
DO $$
DECLARE
  v_records INTEGER := 0;
  v_dealers INTEGER := 0;
  v_orphaned INTEGER := 0;
BEGIN
  -- Count affected records first (for logging)
  SELECT COUNT(*) INTO v_orphaned
  FROM dealer_attendance da1
  WHERE da1.status = 'checked_in'
    AND da1.shift_id IS NULL
    AND EXISTS (
      SELECT 1 FROM dealer_attendance da2
      WHERE da2.dealer_id = da1.dealer_id
        AND da2.status = 'checked_in'
        AND da2.id != da1.id
        AND da2.shift_id IS NOT NULL
    );

  RAISE NOTICE 'Found % orphaned records (checked_in with null shift_id, duplicate exists)', v_orphaned;

  -- Step 2: Fix orphaned records — set them to checked_out
  -- These are attendance records from prior shifts that were never properly closed.
  -- The dealer has a more recent checked_in record (with shift_id) for their real shift.
  UPDATE dealer_attendance da1
  SET status = 'checked_out',
      current_state = 'checked_out'
  WHERE da1.status = 'checked_in'
    AND da1.shift_id IS NULL
    AND EXISTS (
      SELECT 1 FROM dealer_attendance da2
      WHERE da2.dealer_id = da1.dealer_id
        AND da2.status = 'checked_in'
        AND da2.id != da1.id
        AND da2.shift_id IS NOT NULL
    );

  GET DIAGNOSTICS v_records = ROW_COUNT;
  RAISE NOTICE 'Fixed % orphaned records (set to checked_out)', v_records;

  -- Step 3: Fix any remaining stale assigned/pre_assigned records where dealer
  -- has a newer available record (these are the records that blocked Step 5).
  UPDATE dealer_attendance da1
  SET status = 'checked_out',
      current_state = 'checked_out'
  WHERE da1.current_state IN ('assigned', 'pre_assigned')
    AND EXISTS (
      SELECT 1 FROM dealer_attendance da2
      WHERE da2.dealer_id = da1.dealer_id
        AND da2.status = 'checked_in'
        AND da2.current_state = 'available'
        AND da2.id != da1.id
    );

  GET DIAGNOSTICS v_records = ROW_COUNT;
  RAISE NOTICE 'Fixed % stale assigned/pre_assigned records (set to checked_out)', v_records;

  -- Step 4: Log summary of remaining active records per dealer
  SELECT COUNT(*) INTO v_dealers
  FROM (
    SELECT dealer_id
    FROM dealer_attendance
    WHERE status = 'checked_in'
    GROUP BY dealer_id
    HAVING COUNT(*) > 1
  ) dupes;
  IF v_dealers > 0 THEN
    RAISE WARNING 'After cleanup, % dealers still have multiple checked_in records. Manual review needed.', v_dealers;
  ELSE
    RAISE NOTICE 'All dealers now have exactly 1 checked_in record.';
  END IF;
END;
$$;
