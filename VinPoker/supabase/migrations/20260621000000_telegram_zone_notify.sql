-- Migration: Add club_zone and pre_notify_minutes to swing_config
-- for Telegram zone labels and configurable pre-notify timing.

ALTER TABLE swing_config
  ADD COLUMN IF NOT EXISTS club_zone TEXT,
  ADD COLUMN IF NOT EXISTS pre_notify_minutes INT NOT NULL DEFAULT 3;

-- Update Hanoi Royal with zone label
UPDATE swing_config
SET
  club_zone          = 'HANOI ROYAL',
  pre_notify_minutes = 3
WHERE club_id = '22222222-2222-2222-2222-222222222222';
