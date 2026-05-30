BEGIN;

-- Add overtime_threshold_minutes to swing_config
ALTER TABLE swing_config
ADD COLUMN IF NOT EXISTS overtime_threshold_minutes INT DEFAULT 60;

-- Backfill existing rows
UPDATE swing_config
SET overtime_threshold_minutes = 60
WHERE overtime_threshold_minutes IS NULL;

-- Verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name  = 'swing_config'
    AND   column_name = 'overtime_threshold_minutes'
  ) THEN
    RAISE EXCEPTION 'Column overtime_threshold_minutes missing';
  END IF;
  RAISE NOTICE '✅ overtime_threshold_minutes added';
END $$;

COMMIT;
