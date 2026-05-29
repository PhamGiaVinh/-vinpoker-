ALTER TABLE club_settings 
  ADD COLUMN IF NOT EXISTS auto_swing_enabled BOOLEAN NOT NULL DEFAULT true;
