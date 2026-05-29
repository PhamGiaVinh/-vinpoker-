-- Sprint 3: tour_tier, telegram username, pre-announcement foundation

-- 1. tour_tier vào game_tables (thuộc tính bàn, không phải ca)
ALTER TABLE game_tables
  ADD COLUMN IF NOT EXISTS tour_tier TEXT NOT NULL DEFAULT 'MEDIUM'
  CONSTRAINT chk_tour_tier CHECK (tour_tier IN ('HIGH', 'MEDIUM', 'LOW'));

-- 2. pre_announce_minutes vào swing_config
ALTER TABLE swing_config
  ADD COLUMN IF NOT EXISTS pre_announce_minutes INTEGER NOT NULL DEFAULT 10;

-- 3. Các cột mới cho dealer_assignments
ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS swing_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pre_announce_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pre_announced BOOLEAN NOT NULL DEFAULT false;

-- 4. Telegram columns cho dealers
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_username TEXT;

-- 5. Trigger function tính swing_due_at và pre_announce_due_at
CREATE OR REPLACE FUNCTION trg_calc_swing_due_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_swing_duration INTEGER;
  v_pre_announce_min INTEGER;
  v_club_id UUID;
  v_table_type TEXT;
BEGIN
  SELECT club_id, table_type INTO v_club_id, v_table_type
  FROM game_tables WHERE id = NEW.table_id;

  SELECT swing_duration_minutes, COALESCE(pre_announce_minutes, 10)
  INTO v_swing_duration, v_pre_announce_min
  FROM swing_config
  WHERE club_id = v_club_id AND table_type = v_table_type
  LIMIT 1;

  v_swing_duration := COALESCE(v_swing_duration, 45);
  v_pre_announce_min := COALESCE(v_pre_announce_min, 10);

  NEW.swing_due_at := NEW.assigned_at + (v_swing_duration * interval '1 minute');
  NEW.pre_announce_due_at := NEW.swing_due_at - (v_pre_announce_min * interval '1 minute');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealer_assignment_due_at ON dealer_assignments;
CREATE TRIGGER trg_dealer_assignment_due_at
BEFORE INSERT OR UPDATE OF assigned_at ON dealer_assignments
FOR EACH ROW EXECUTE FUNCTION trg_calc_swing_due_at();

-- 6. Indexes cho cron query hiệu quả
CREATE INDEX IF NOT EXISTS idx_assignments_swing_due
  ON dealer_assignments(swing_due_at)
  WHERE status = 'assigned' AND swing_processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_pre_announce_due
  ON dealer_assignments(pre_announce_due_at)
  WHERE status = 'assigned' AND pre_announced = false;

-- 7. Backfill existing assignments (chạy 1 lần)
UPDATE dealer_assignments da
SET
  swing_due_at = da.assigned_at + COALESCE(
    (SELECT swing_duration_minutes FROM swing_config sc
     WHERE sc.club_id = gt.club_id AND sc.table_type = gt.table_type), 45
  ) * interval '1 minute',
  pre_announce_due_at = da.assigned_at + COALESCE(
    (SELECT swing_duration_minutes FROM swing_config sc
     WHERE sc.club_id = gt.club_id AND sc.table_type = gt.table_type), 45
  ) * interval '1 minute' - COALESCE(
    (SELECT pre_announce_minutes FROM swing_config sc
     WHERE sc.club_id = gt.club_id AND sc.table_type = gt.table_type), 10
  ) * interval '1 minute'
FROM game_tables gt
WHERE da.table_id = gt.id AND da.swing_due_at IS NULL;
